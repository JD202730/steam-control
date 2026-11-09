import { hashPassword } from '@/core/auth/password'
import { clock } from '@/core/clock/clock'
import { DAY, HOUR, MINUTE, dayKey, addDaysToDay } from '@/core/dates'
import { db } from '@/core/db/db'
import { errorMessage } from '@/core/errors'
import { assertCan, type Actor } from '@/core/permissions/roles'
import { createRng } from '@/core/random'
import { createCategory, createItem, receiveStock } from '@/modules/inventory/service'
import { RETURNABLE_KINDS } from '@/modules/inventory/types'
import { addPart, completeMaintenance, scheduleMaintenance, startMaintenance } from '@/modules/maintenance/service'
import { createPrinter, createReservation, reportFailure, startJob, syncJobs } from '@/modules/printers/service'
import {
  approveRequest,
  cancelRequest,
  createRequest,
  deliverRequest,
  getRequest,
  rejectRequest,
  returnLine,
} from '@/modules/requests/service'
import { CATEGORY_NAMES, DEMO_ACCOUNTS, SEED_ITEMS, SEED_PRINTERS } from './data'

const iso = (ms: number) => new Date(ms).toISOString()
const actorOf = (id: string): Actor => {
  const a = DEMO_ACCOUNTS.find((x) => x.id === id)!
  return { id: a.id, name: a.name, role: a.role }
}
const ADMIN = actorOf('u-admin')
const REGULAR_USERS = ['u-sofia', 'u-andres', 'u-valentina', 'u-mateo', 'u-camila']

const REQUESTABLE = SEED_ITEMS.filter((i) => i.kind !== 'filament' && !i.sku.startsWith('3D-')).map((i) => i.sku)
const PURPOSES = [
  'Proyecto de robótica seguidor de línea',
  'Práctica de circuitos del período',
  'Prototipo para la feria de ciencias',
  'Taller de programación con micro:bit',
  'Maqueta de ciudad inteligente',
  'Brazo robótico para exposición',
  'Proyecto de domótica con sensores',
  'Reparación de equipos del aula',
]
const REJECT_NOTES = ['Material reservado para otra actividad esa fecha.', 'Solicita menos cantidad, el stock es limitado.', 'Falta aprobación del docente a cargo.']
const FAILURES = ['Atasco de filamento en la boquilla', 'Desprendimiento de la pieza de la cama', 'Boquilla obstruida', 'Falla del ventilador de capa']
const JOB_NAMES = ['Engranaje de transmisión', 'Soporte de sensor', 'Carcasa para Arduino', 'Pieza de maqueta', 'Llavero del colegio', 'Chasis de robot', 'Pinza para brazo robótico']

interface Op {
  at: number
  run: () => Promise<void>
}

export interface SeedReport {
  operations: number
  skipped: number
}

let lastReport: SeedReport = { operations: 0, skipped: 0 }
export const getLastSeedReport = (): SeedReport => lastReport

/**
 * Genera el historial de la demostración "viajando en el tiempo": cada paso se ejecuta con el
 * reloj congelado en su fecha, a través de los mismos servicios que usa la interfaz. Así el
 * historial (movimientos, solicitudes, trabajos, mantenimientos) es coherente por construcción.
 */
async function populate(): Promise<void> {
  clock.resetToRealTime()
  const realNow = Date.now()
  const today0 = Math.floor(realNow / DAY) * DAY
  const cutoff = realNow - 45 * MINUTE
  const at = (daysAgo: number, hour: number, minute = 0) => today0 - daysAgo * DAY + hour * HOUR + minute * MINUTE
  const rng = createRng(20260101)

  /* 1. Base: usuarios, categorías, artículos con stock inicial e impresoras ---------------- */
  clock.freeze(at(35, 12))
  const hashes = await Promise.all(DEMO_ACCOUNTS.map((a) => hashPassword(a.password)))
  await db.users.bulkAdd(
    DEMO_ACCOUNTS.map((a, i) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      passwordHash: hashes[i],
      role: a.role,
      status: a.status ?? 'active',
      area: a.area,
      createdAt: clock.iso(),
    })),
  )
  const categoryId = new Map<string, string>()
  for (const name of CATEGORY_NAMES) categoryId.set(name, (await createCategory(ADMIN, name)).id)
  const itemId = new Map<string, string>()
  for (const it of SEED_ITEMS) {
    const created = await createItem(ADMIN, {
      sku: it.sku,
      name: it.name,
      categoryId: categoryId.get(it.category)!,
      kind: it.kind,
      unit: it.unit,
      minStock: it.min,
      location: it.location,
      unitCost: it.cost,
      initialStock: it.stock,
    })
    itemId.set(it.sku, created.id)
  }
  const printerId = new Map<string, string>()
  for (const p of SEED_PRINTERS) {
    const created = await createPrinter(ADMIN, {
      name: p.name,
      model: p.model,
      location: p.location,
      maintenanceIntervalHours: p.intervalHours,
    })
    printerId.set(p.key, created.id)
  }
  const kindOf = new Map(SEED_ITEMS.map((i) => [i.sku, i.kind]))

  /* 2. Historial: lista de operaciones con su fecha -------------------------------------- */
  const ops: Op[] = []
  const add = (atMs: number, run: () => Promise<void>) => {
    if (atMs <= cutoff) ops.push({ at: atMs, run })
  }

  const qtyFor = (sku: string): number => {
    if (['ELE-LED', 'ELE-RES', 'ELE-JMP'].includes(sku)) return rng.int(10, 40)
    if (RETURNABLE_KINDS.includes(kindOf.get(sku)!)) return rng.int(1, 2)
    return rng.int(1, 4)
  }

  type Outcome = 'closed' | 'rejected' | 'cancelled' | 'delivered' | 'approved' | 'pending'
  interface ChainOptions {
    returnBy?: string
    /** Artículos fijos (si no, se eligen al azar). */
    skus?: string[]
    /** Minutos hasta la decisión y hasta la entrega (si no, al azar). */
    decideAfter?: number
    deliverAfter?: number
  }
  const requestChain = (createAt: number, userKey: string, outcome: Outcome, opts: ChainOptions = {}) => {
    const user = actorOf(userKey)
    const skus = new Set<string>(opts.skus ?? [])
    if (!opts.skus) for (let n = rng.int(1, 3); n > 0; n--) skus.add(rng.pick(REQUESTABLE))
    const lines = [...skus].map((sku) => ({ itemId: itemId.get(sku)!, qty: qtyFor(sku) }))
    const neededBy = dayKey(createAt)
    let reqId = ''
    add(createAt, async () => {
      const r = await createRequest(user, {
        purpose: rng.pick(PURPOSES),
        neededBy,
        returnBy: opts.returnBy ?? addDaysToDay(neededBy, rng.int(3, 6)),
        lines,
      })
      reqId = r.id
    })
    if (outcome === 'pending') return
    if (outcome === 'cancelled') return add(createAt + rng.int(30, 300) * MINUTE, () => cancelRequest(user, reqId).then(() => undefined))
    const decideAt = createAt + (opts.decideAfter ?? rng.int(60, 18 * 60)) * MINUTE
    if (outcome === 'rejected') return add(decideAt, () => rejectRequest(ADMIN, reqId, rng.pick(REJECT_NOTES)).then(() => undefined))
    add(decideAt, () => approveRequest(ADMIN, reqId, 'Aprobada.').then(() => undefined))
    if (outcome === 'approved') return
    const deliverAt = decideAt + (opts.deliverAfter ?? rng.int(120, 30 * 60)) * MINUTE
    add(deliverAt, () => deliverRequest(ADMIN, reqId).then(() => undefined))
    if (outcome === 'delivered') return
    add(deliverAt + rng.int(1, 4) * DAY + rng.int(0, 5) * HOUR, async () => {
      const found = await getRequest(reqId)
      for (const line of found?.lines ?? []) {
        const pending = line.qtyDelivered - line.qtyReturned
        if (line.returnable && pending > 0) await returnLine(ADMIN, reqId, line.id, pending)
      }
    })
  }

  // Solicitudes históricas (la mayoría ya cerradas).
  for (let i = 0; i < 18; i++) {
    const roll = rng.next()
    const outcome: Outcome = roll < 0.78 ? 'closed' : roll < 0.88 ? 'rejected' : 'cancelled'
    requestChain(at(rng.int(6, 33), rng.int(13, 20), rng.int(0, 59)), rng.pick(REGULAR_USERS), outcome)
  }
  // Solicitudes recientes en distintos estados (para que los paneles no estén vacíos).
  requestChain(realNow - 30 * HOUR, 'u-camila', 'pending') // lleva más de 24 h sin respuesta: genera alerta
  requestChain(realNow - 6 * HOUR, 'u-andres', 'pending')
  requestChain(realNow - 2 * HOUR, 'u-valentina', 'pending')
  requestChain(realNow - 8 * HOUR, 'u-mateo', 'approved', { decideAfter: 90 })
  requestChain(realNow - 26 * HOUR, 'u-sofia', 'delivered', {
    returnBy: dayKey(realNow + 2 * DAY),
    skus: ['HER-MULT', 'ELE-ARD-UNO', 'ELE-LED'],
    decideAfter: 60,
    deliverAfter: 180,
  })
  requestChain(at(9, 14), 'u-mateo', 'delivered', {
    returnBy: addDaysToDay(dayKey(at(9, 14)), 3), // devolución vencida
    skus: ['HER-SOLD', 'SEG-GAF'],
    decideAfter: 120,
    deliverAfter: 240,
  })

  // Trabajos de impresión históricos (dos terminan en falla y generan mantenimiento correctivo).
  const printerKeys = SEED_PRINTERS.map((p) => p.key)
  const filaments = ['3D-PLA-BLN', '3D-PLA-NGR', '3D-PLA-AZL', '3D-PETG-TRA']
  const repairTask = async (key: string, status: 'scheduled' | 'in_progress') =>
    db.maintenance
      .where('printerId')
      .equals(printerId.get(key)!)
      .filter((t) => t.status === status)
      .first()
  for (let i = 0; i < 16; i++) {
    const key = printerKeys[i % printerKeys.length]
    const user = actorOf(rng.pick(REGULAR_USERS))
    const start = at(rng.int(1, 30), rng.int(13, 19), rng.pick([0, 15, 30, 45]))
    const minutes = rng.int(25, 170)
    const grams = rng.int(15, 140)
    const failure = i === 3 || i === 11
    let reservationId = ''
    add(start, async () => {
      const r = await createReservation(user, {
        printerId: printerId.get(key)!,
        startsAt: iso(start),
        endsAt: iso(start + (minutes + 20) * MINUTE),
        purpose: 'Impresión 3D para proyecto',
      })
      reservationId = r.id
      await startJob(user, {
        reservationId,
        name: rng.pick(JOB_NAMES),
        filamentItemId: itemId.get(rng.pick(filaments))!,
        gramsEstimated: grams,
        estimatedMinutes: minutes,
      })
    })
    if (failure) {
      const failAt = start + Math.floor(minutes / 2) * MINUTE
      add(failAt, () => reportFailure(ADMIN, printerId.get(key)!, rng.pick(FAILURES)))
      add(failAt + 60 * MINUTE, async () => {
        const task = await repairTask(key, 'scheduled')
        if (task) await startMaintenance(ADMIN, task.id)
      })
      add(failAt + 150 * MINUTE, async () => {
        const task = await repairTask(key, 'in_progress')
        if (!task) return
        await addPart(ADMIN, task.id, itemId.get('3D-NOZ')!, 1)
        await completeMaintenance(ADMIN, task.id, { laborCost: 15, notes: 'Boquilla reemplazada y calibración de cama.' })
      })
    } else {
      add(start + minutes * MINUTE + MINUTE, () => syncJobs().then(() => undefined))
    }
  }

  // Mantenimientos preventivos ya realizados.
  for (const [key, daysAgo, title] of [
    ['prusa', 20, 'Lubricación de ejes y revisión de correas'],
    ['bambu', 12, 'Limpieza de extrusor y calibración'],
  ] as const) {
    let taskId = ''
    add(at(daysAgo + 1, 15), async () => {
      const task = await scheduleMaintenance(ADMIN, {
        printerId: printerId.get(key)!,
        type: 'preventive',
        title,
        scheduledStart: iso(at(daysAgo, 18)),
        scheduledEnd: iso(at(daysAgo, 20)),
      })
      taskId = task.id
    })
    add(at(daysAgo, 18, 5), () => startMaintenance(ADMIN, taskId).then(() => undefined))
    add(at(daysAgo, 19, 40), async () => {
      await addPart(ADMIN, taskId, itemId.get('3D-BELT')!, 1)
      await completeMaintenance(ADMIN, taskId, { laborCost: 12, notes: 'Sin novedades.' })
    })
  }

  // Compras de reposición.
  add(at(25, 15), () => receiveStock(ADMIN, itemId.get('3D-PLA-BLN')!, 3000, 'Compra de filamento').then(() => undefined))
  add(at(15, 16), () => receiveStock(ADMIN, itemId.get('ELE-RES')!, 400, 'Compra de resistencias').then(() => undefined))
  add(at(8, 14), () => receiveStock(ADMIN, itemId.get('3D-PLA-AZL')!, 2000, 'Compra de filamento').then(() => undefined))

  let skipped = 0
  ops.sort((a, b) => a.at - b.at)
  for (const op of ops) {
    clock.freeze(op.at)
    try {
      await op.run()
    } catch (error) {
      skipped++
      console.debug('[seed] paso omitido:', errorMessage(error))
    }
  }
  lastReport = { operations: ops.length, skipped }

  /* 3. Estado presente: un trabajo en curso, reservas futuras y un mantenimiento programado -- */
  clock.freeze(realNow - 35 * MINUTE)
  const sofia = actorOf('u-sofia')
  const running = await createReservation(sofia, {
    printerId: printerId.get('bambu')!,
    startsAt: iso(realNow - 35 * MINUTE),
    endsAt: iso(realNow + 95 * MINUTE),
    purpose: 'Piezas para el prototipo de la feria',
  })
  await startJob(sofia, {
    reservationId: running.id,
    name: 'Soportes de sensores (lote 2)',
    filamentItemId: itemId.get('3D-PLA-BLN')!,
    gramsEstimated: 60,
    estimatedMinutes: 110,
  })
  clock.resetToRealTime()

  const future = async (key: string, userKey: string, startMs: number, hours: number, purpose: string) =>
    createReservation(actorOf(userKey), {
      printerId: printerId.get(key)!,
      startsAt: iso(startMs),
      endsAt: iso(startMs + hours * HOUR),
      purpose,
    })
  await future('prusa', 'u-andres', today0 + DAY + 14 * HOUR, 2, 'Prototipo de engranajes')
  await future('k1', 'u-valentina', today0 + DAY + 16 * HOUR, 3, 'Carcasa del proyecto final')
  await future('ender', 'u-mateo', today0 + 2 * DAY + 13 * HOUR, 2, 'Piezas del brazo robótico')
  // Este mantenimiento se cruza con la reserva de Mateo y la marca como "afectada".
  await scheduleMaintenance(ADMIN, {
    printerId: printerId.get('ender')!,
    type: 'preventive',
    title: 'Revisión de ejes y lubricación',
    description: 'Mantenimiento programado por acumulación de horas.',
    scheduledStart: iso(today0 + 2 * DAY + 12 * HOUR),
    scheduledEnd: iso(today0 + 2 * DAY + 14 * HOUR),
  })

  /* 4. Retoques finales ------------------------------------------------------------------- */
  for (const p of SEED_PRINTERS) {
    await db.printers.update(printerId.get(p.key)!, {
      totalPrintHours: p.totalHours,
      hoursSinceMaintenance: p.hoursSinceMaintenance,
    })
  }
  // Las notificaciones de más de un día se muestran como leídas.
  const unreadCutoff = iso(realNow - DAY)
  await db.notifications
    .filter((n) => !n.readAt && n.createdAt < unreadCutoff)
    .modify((n) => {
      n.readAt = n.createdAt
    })

  await db.sim.put({
    id: 'main',
    running: false,
    speed: 10,
    scenario: 'normal',
    seed: 20260101,
    rngState: 20260101,
    virtualNow: Date.now(),
    savedAtReal: Date.now(),
    lastTickVirtual: Date.now(),
    counters: { ticks: 0, requests: 0, approvals: 0, deliveries: 0, returns: 0, jobs: 0, failures: 0, restocks: 0 },
  })
  await db.meta.put({ key: 'seeded', value: true })
}

let seeding: Promise<void> | null = null

/** Carga los datos de demostración la primera vez que se abre la app. */
export function ensureSeeded(): Promise<void> {
  seeding ??= (async () => {
    if (!(await db.meta.get('seeded'))) await populate()
  })().finally(() => {
    seeding = null
  })
  return seeding
}

/** Borra TODO y vuelve a generar la demostración (solo administradores). */
export async function resetDemoData(actor: Actor | null): Promise<void> {
  assertCan(actor, 'simulation:control')
  clock.resetToRealTime()
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })
  await populate()
}
