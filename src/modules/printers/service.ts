import { z } from 'zod'
import { clock } from '@/core/clock/clock'
import { HOUR, MINUTE, overlaps, toIso } from '@/core/dates'
import { writeAudit } from '@/core/db/audit'
import { db, INVENTORY_TABLES } from '@/core/db/db'
import { runTx, type TxContext } from '@/core/db/tx'
import { conflict, forbidden, invalid, notFound } from '@/core/errors'
import { newId } from '@/core/ids'
import { assertCan, can, type Actor } from '@/core/permissions/roles'
import { parseInput } from '@/core/validation'
import { applyMovement, type MovementInput } from '../inventory/service'
import { ACTIVE_MAINTENANCE_STATUSES } from '../maintenance/types'
import {
  OCCUPYING_STATUSES,
  PRINTER_STATUS_LABEL,
  type PrintJob,
  type Printer,
  type Reservation,
} from './types'

const JOB_TABLES = [db.printers, db.reservations, db.jobs, ...INVENTORY_TABLES] as const

export const MIN_RESERVATION_MINUTES = 15
export const MAX_RESERVATION_MINUTES = 8 * 60
export const MAX_ACTIVE_RESERVATIONS_PER_USER = 5
/** Un trabajo puede iniciarse hasta 15 min antes del comienzo de su reserva. */
const EARLY_START_MS = 15 * MINUTE

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false })

/* -------------------------------------------------------------------------- */
/*  Lectura                                                                    */
/* -------------------------------------------------------------------------- */

export async function listPrinters(): Promise<Printer[]> {
  const rows = await db.printers.toArray()
  return rows.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export const getPrinter = (id: string) => db.printers.get(id)

export async function listReservations(
  filter: { printerId?: string; userId?: string; from?: string; to?: string } = {},
): Promise<Reservation[]> {
  let rows = filter.printerId
    ? await db.reservations.where('printerId').equals(filter.printerId).toArray()
    : filter.userId
      ? await db.reservations.where('userId').equals(filter.userId).toArray()
      : await db.reservations.toArray()
  if (filter.userId) rows = rows.filter((r) => r.userId === filter.userId)
  if (filter.from) rows = rows.filter((r) => r.endsAt > filter.from!)
  if (filter.to) rows = rows.filter((r) => r.startsAt < filter.to!)
  return rows.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}

export async function listJobs(filter: { userId?: string; printerId?: string } = {}): Promise<PrintJob[]> {
  let rows = await db.jobs.toArray()
  if (filter.userId) rows = rows.filter((j) => j.userId === filter.userId)
  if (filter.printerId) rows = rows.filter((j) => j.printerId === filter.printerId)
  return rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/* -------------------------------------------------------------------------- */
/*  Impresoras                                                                 */
/* -------------------------------------------------------------------------- */

const printerSchema = z.object({
  name: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres.').max(40),
  model: z.string().trim().min(2, 'Indica el modelo.').max(60),
  location: z.string().trim().max(60).default(''),
  maintenanceIntervalHours: z
    .number('El intervalo debe ser un número.')
    .min(1, 'El intervalo mínimo es 1 hora.')
    .max(2000)
    .default(100),
})

export type PrinterInput = z.input<typeof printerSchema>

export async function createPrinter(actor: Actor | null, input: PrinterInput): Promise<Printer> {
  assertCan(actor, 'printers:manage')
  const data = parseInput(printerSchema, input)
  return runTx([db.printers], async () => {
    const printer: Printer = {
      id: newId(),
      ...data,
      status: 'idle',
      totalPrintHours: 0,
      hoursSinceMaintenance: 0,
      active: true,
      createdAt: clock.iso(),
    }
    await db.printers.add(printer)
    await writeAudit(actor, 'printers.create', 'printer', printer.id, printer.name)
    return printer
  })
}

export async function updatePrinter(actor: Actor | null, id: string, patch: Partial<PrinterInput>): Promise<Printer> {
  assertCan(actor, 'printers:manage')
  const data = parseInput(printerSchema.partial(), patch)
  return runTx([db.printers], async () => {
    if (!(await db.printers.get(id))) throw notFound('Impresora no encontrada.')
    await db.printers.update(id, data)
    await writeAudit(actor, 'printers.update', 'printer', id)
    return (await db.printers.get(id))!
  })
}

/** Saca de servicio una impresora disponible o la vuelve a poner en línea. */
export async function setPrinterOffline(actor: Actor | null, id: string, offline: boolean): Promise<void> {
  assertCan(actor, 'printers:manage')
  await runTx([db.printers], async () => {
    const printer = await db.printers.get(id)
    if (!printer) throw notFound('Impresora no encontrada.')
    if (offline) {
      if (printer.status !== 'idle') {
        throw conflict(`Solo se puede sacar de servicio una impresora disponible (ahora: ${PRINTER_STATUS_LABEL[printer.status].toLowerCase()}).`)
      }
      await db.printers.update(id, { status: 'offline' })
    } else {
      if (printer.status !== 'offline') throw conflict('La impresora no está fuera de servicio.')
      await db.printers.update(id, { status: 'idle' })
    }
    await writeAudit(actor, offline ? 'printers.offline' : 'printers.online', 'printer', id)
  })
}

/** Quita el estado de falla sin pasar por mantenimiento (p. ej. fue una falsa alarma). */
export async function clearPrinterError(actor: Actor | null, id: string): Promise<void> {
  assertCan(actor, 'printers:manage')
  await runTx([db.printers], async () => {
    const printer = await db.printers.get(id)
    if (!printer) throw notFound('Impresora no encontrada.')
    if (printer.status !== 'error') throw conflict('La impresora no tiene una falla registrada.')
    await db.printers.update(id, { status: 'idle' })
    await writeAudit(actor, 'printers.clear-error', 'printer', id)
  })
}

/* -------------------------------------------------------------------------- */
/*  Reservas                                                                   */
/* -------------------------------------------------------------------------- */

const reservationSchema = z.object({
  printerId: z.string().min(1, 'Selecciona una impresora.'),
  startsAt: z.string().min(1, 'Indica la hora de inicio.'),
  endsAt: z.string().min(1, 'Indica la hora de fin.'),
  purpose: z.string().trim().min(3, 'Describe el uso (mín. 3 caracteres).').max(160),
})

export type ReservationInput = z.input<typeof reservationSchema>

export async function createReservation(actor: Actor | null, input: ReservationInput): Promise<Reservation> {
  assertCan(actor, 'reservations:create')
  const data = parseInput(reservationSchema, input)
  let startsAt: string
  let endsAt: string
  try {
    startsAt = toIso(data.startsAt)
    endsAt = toIso(data.endsAt)
  } catch {
    throw invalid('Las fechas de la reserva no son válidas.')
  }
  const minutes = (Date.parse(endsAt) - Date.parse(startsAt)) / MINUTE
  if (minutes <= 0) throw invalid('La hora de fin debe ser posterior a la de inicio.')
  if (minutes < MIN_RESERVATION_MINUTES) throw invalid(`La reserva mínima es de ${MIN_RESERVATION_MINUTES} minutos.`)
  if (minutes > MAX_RESERVATION_MINUTES) throw invalid(`La reserva máxima es de ${MAX_RESERVATION_MINUTES / 60} horas.`)
  if (Date.parse(startsAt) < clock.nowMs() - 5 * MINUTE) throw invalid('No se puede reservar en el pasado.')

  return runTx([db.printers, db.reservations, db.maintenance], async (ctx) => {
    const printer = await db.printers.get(data.printerId)
    if (!printer || !printer.active) throw notFound('Impresora no encontrada.')
    if (printer.status === 'offline') throw conflict('Esa impresora está fuera de servicio.')

    const clash = await db.reservations
      .where('printerId')
      .equals(printer.id)
      .filter((r) => OCCUPYING_STATUSES.includes(r.status) && overlaps(r.startsAt, r.endsAt, startsAt, endsAt))
      .first()
    if (clash) {
      throw conflict(`${printer.name} ya está reservada de ${fmtTime(clash.startsAt)} a ${fmtTime(clash.endsAt)}.`)
    }
    const maint = await db.maintenance
      .where('printerId')
      .equals(printer.id)
      .filter((t) => ACTIVE_MAINTENANCE_STATUSES.includes(t.status) && overlaps(t.scheduledStart, t.scheduledEnd, startsAt, endsAt))
      .first()
    if (maint) {
      throw conflict(`${printer.name} estará en mantenimiento de ${fmtTime(maint.scheduledStart)} a ${fmtTime(maint.scheduledEnd)}.`)
    }
    if (actor.role === 'user') {
      const nowIso = clock.iso()
      const mine = await db.reservations
        .where('userId')
        .equals(actor.id)
        .filter((r) => r.status === 'confirmed' && r.endsAt > nowIso)
        .count()
      if (mine >= MAX_ACTIVE_RESERVATIONS_PER_USER) {
        throw conflict(`Ya tienes ${MAX_ACTIVE_RESERVATIONS_PER_USER} reservas activas. Cancela o usa alguna antes de crear otra.`)
      }
    }
    const reservation: Reservation = {
      id: newId(),
      printerId: printer.id,
      userId: actor.id,
      startsAt,
      endsAt,
      purpose: data.purpose,
      status: 'confirmed',
      createdAt: clock.iso(),
    }
    await db.reservations.add(reservation)
    await writeAudit(actor, 'reservations.create', 'reservation', reservation.id, printer.name)
    ctx.emit({ type: 'reservation.created', reservationId: reservation.id, userId: actor.id, printerId: printer.id })
    return reservation
  })
}

export async function cancelReservation(actor: Actor | null, id: string): Promise<void> {
  if (!actor) throw forbidden()
  await runTx([db.reservations], async () => {
    const reservation = await db.reservations.get(id)
    if (!reservation) throw notFound('Reserva no encontrada.')
    if (reservation.userId !== actor.id && !can(actor, 'reservations:manage')) throw forbidden()
    if (reservation.status !== 'confirmed' && reservation.status !== 'affected') {
      throw conflict('Solo se pueden cancelar reservas confirmadas o afectadas por mantenimiento.')
    }
    await db.reservations.update(id, { status: 'cancelled' })
    await writeAudit(actor, 'reservations.cancel', 'reservation', id)
  })
}

/** Marca como vencidas las reservas cuyo horario ya pasó sin usarse. */
export async function expireReservations(): Promise<number> {
  const nowIso = clock.iso()
  const stale = await db.reservations
    .filter((r) => (r.status === 'confirmed' || r.status === 'affected') && r.endsAt <= nowIso)
    .toArray()
  if (!stale.length) return 0
  await db.transaction('rw', db.reservations, async () => {
    for (const r of stale) await db.reservations.update(r.id, { status: 'expired' })
  })
  return stale.length
}

/* -------------------------------------------------------------------------- */
/*  Trabajos de impresión                                                      */
/* -------------------------------------------------------------------------- */

const jobSchema = z.object({
  reservationId: z.string().min(1),
  name: z.string().trim().min(2, 'Ponle un nombre al trabajo.').max(80),
  filamentItemId: z.string().min(1, 'Selecciona el filamento.'),
  gramsEstimated: z
    .number('Los gramos deben ser un número.')
    .int('Los gramos deben ser un entero.')
    .min(1, 'Indica al menos 1 g.')
    .max(2000, 'Máximo 2000 g por trabajo.'),
  estimatedMinutes: z
    .number('La duración debe ser un número.')
    .int('La duración debe ser un entero.')
    .min(5, 'La duración mínima es 5 minutos.')
    .max(MAX_RESERVATION_MINUTES),
})

export type StartJobInput = z.input<typeof jobSchema>

export async function startJob(actor: Actor | null, input: StartJobInput): Promise<PrintJob> {
  assertCan(actor, 'jobs:run')
  const data = parseInput(jobSchema, input)
  return runTx([...JOB_TABLES], async (ctx) => {
    const reservation = await db.reservations.get(data.reservationId)
    if (!reservation) throw notFound('Reserva no encontrada.')
    if (reservation.userId !== actor.id && !can(actor, 'reservations:manage')) throw forbidden()
    if (reservation.status !== 'confirmed') throw conflict('La reserva no está confirmada.')

    const nowMs = clock.nowMs()
    if (nowMs < Date.parse(reservation.startsAt) - EARLY_START_MS) {
      throw conflict(`Aún no es la hora: tu reserva empieza a las ${fmtTime(reservation.startsAt)}.`)
    }
    const remaining = (Date.parse(reservation.endsAt) - nowMs) / MINUTE
    if (remaining <= 0) throw conflict('Tu reserva ya terminó.')
    if (data.estimatedMinutes > Math.ceil(remaining)) {
      throw conflict(`El trabajo (${data.estimatedMinutes} min) no cabe en lo que queda de tu reserva (${Math.floor(remaining)} min).`)
    }

    const printer = await db.printers.get(reservation.printerId)
    if (!printer) throw notFound('Impresora no encontrada.')
    if (printer.status !== 'idle') {
      throw conflict(`${printer.name} no está disponible: ${PRINTER_STATUS_LABEL[printer.status].toLowerCase()}.`)
    }
    const filament = await db.items.get(data.filamentItemId)
    if (!filament || !filament.active || filament.kind !== 'filament') throw invalid('Selecciona un filamento válido.')

    const id = newId()
    // Reserva el filamento; si no alcanza, la transacción completa falla.
    await applyMovement(ctx, reservation.userId, {
      itemId: filament.id,
      type: 'reserve',
      qty: data.gramsEstimated,
      reason: `Filamento para el trabajo "${data.name}"`,
      refType: 'job',
      refId: id,
    })
    const now = clock.iso()
    const job: PrintJob = {
      id,
      reservationId: reservation.id,
      printerId: printer.id,
      userId: reservation.userId,
      name: data.name,
      filamentItemId: filament.id,
      gramsEstimated: data.gramsEstimated,
      gramsUsed: 0,
      estimatedMinutes: data.estimatedMinutes,
      progress: 0,
      status: 'printing',
      startedAt: now,
      lastSyncAt: now,
    }
    await db.jobs.add(job)
    await db.printers.update(printer.id, { status: 'printing', currentJobId: id })
    await db.reservations.update(reservation.id, { status: 'in_progress', jobId: id })
    await writeAudit(actor, 'jobs.start', 'job', id, job.name)
    ctx.emit({ type: 'job.started', jobId: id, userId: job.userId, printerId: printer.id, name: job.name })
    return job
  })
}

/* -------------------------------------------------------------------------- */
/*  Liquidación de trabajos                                                    */
/*  (las funciones auxiliares esperan solo a Dexie: ver el aviso en core/db/tx) */
/* -------------------------------------------------------------------------- */

interface Settlement {
  /** Avance entre 0 y 1 según el reloj. */
  progress: number
  /** Gramos que debería haber consumido ya el trabajo. */
  targetGrams: number
  /** Gramos a entregar ahora (reserva -> salida). */
  delta: number
  /** Horas de uso a sumar al contador de la impresora desde la última liquidación. */
  hours: number
}

/** Calcula, sin tocar la base de datos, cuánto avanzó un trabajo según el reloj. */
function planSettlement(job: PrintJob, nowMs: number): Settlement {
  const startMs = Date.parse(job.startedAt)
  const endMs = startMs + job.estimatedMinutes * MINUTE
  const progress = Math.min(1, Math.max(0, (nowMs - startMs) / (endMs - startMs)))
  const targetGrams = progress >= 1 ? job.gramsEstimated : Math.floor(job.gramsEstimated * progress)
  const lastMs = Date.parse(job.lastSyncAt)
  const hours = Math.max(0, Math.min(nowMs, endMs) - Math.max(lastMs, startMs)) / HOUR
  return { progress, targetGrams, delta: targetGrams - job.gramsUsed, hours }
}

/** Movimientos de stock de una liquidación. Si `closing`, libera además el filamento no usado. */
function settlementMovements(job: PrintJob, plan: Settlement, closing: boolean): MovementInput[] {
  const moves: MovementInput[] = []
  const base = { itemId: job.filamentItemId, refType: 'job' as const, refId: job.id }
  if (plan.delta > 0) {
    moves.push({ ...base, type: 'issue', qty: plan.delta, reason: `Filamento consumido: "${job.name}"` })
  }
  const remaining = job.gramsEstimated - plan.targetGrams
  if (closing && remaining > 0) {
    moves.push({ ...base, type: 'release', qty: remaining, reason: `Filamento sin usar: "${job.name}"` })
  }
  return moves
}

/** Guarda el avance del trabajo y suma las horas de uso a la impresora (avisa si toca mantenimiento). */
async function saveSettlement(ctx: TxContext, job: PrintJob, plan: Settlement, nowMs: number): Promise<void> {
  const printer = await db.printers.get(job.printerId)
  if (printer && plan.hours > 0) {
    const before = printer.hoursSinceMaintenance
    const after = before + plan.hours
    await db.printers.update(printer.id, {
      totalPrintHours: printer.totalPrintHours + plan.hours,
      hoursSinceMaintenance: after,
    })
    if (before < printer.maintenanceIntervalHours && after >= printer.maintenanceIntervalHours) {
      ctx.emit({ type: 'maintenance.due', printerId: printer.id, printerName: printer.name, hours: Math.round(after) })
    }
  }
  job.gramsUsed = plan.targetGrams
  job.progress = Math.round(plan.progress * 100)
  job.lastSyncAt = new Date(Math.max(nowMs, Date.parse(job.lastSyncAt))).toISOString()
  await db.jobs.update(job.id, { gramsUsed: job.gramsUsed, progress: job.progress, lastSyncAt: job.lastSyncAt })
}

async function advanceJob(jobId: string): Promise<void> {
  await runTx([...JOB_TABLES], async (ctx) => {
    const job = await db.jobs.get(jobId)
    if (!job || job.status !== 'printing') return
    const nowMs = clock.nowMs()
    const plan = planSettlement(job, nowMs)
    for (const move of settlementMovements(job, plan, false)) await applyMovement(ctx, job.userId, move)
    await saveSettlement(ctx, job, plan, nowMs)
    if (plan.progress < 1) return

    const finishedAt = new Date(Date.parse(job.startedAt) + job.estimatedMinutes * MINUTE).toISOString()
    await db.jobs.update(job.id, { status: 'completed', progress: 100, finishedAt })
    const printer = await db.printers.get(job.printerId)
    if (printer && printer.status === 'printing' && printer.currentJobId === job.id) {
      await db.printers.update(printer.id, { status: 'idle', currentJobId: undefined })
    }
    await db.reservations.update(job.reservationId, { status: 'completed' })
    ctx.emit({ type: 'job.completed', jobId: job.id, userId: job.userId, printerId: job.printerId, name: job.name })
  })
}

/** Avanza todos los trabajos en curso. Lo llama el proceso en segundo plano cada segundo. */
export async function syncJobs(): Promise<number> {
  const running = await db.jobs.where('status').equals('printing').toArray()
  for (const job of running) await advanceJob(job.id)
  return running.length
}

export async function cancelJob(actor: Actor | null, jobId: string): Promise<void> {
  if (!actor) throw forbidden()
  await runTx([...JOB_TABLES], async (ctx) => {
    const job = await db.jobs.get(jobId)
    if (!job) throw notFound('Trabajo no encontrado.')
    if (job.userId !== actor.id && !can(actor, 'printers:manage')) throw forbidden()
    if (job.status !== 'printing') throw conflict('El trabajo ya terminó.')

    const nowMs = clock.nowMs()
    const plan = planSettlement(job, nowMs)
    // Se cobra lo imprimido hasta ahora y el resto del filamento vuelve al inventario.
    for (const move of settlementMovements(job, plan, true)) await applyMovement(ctx, job.userId, move)
    await saveSettlement(ctx, job, plan, nowMs)
    await db.jobs.update(job.id, { status: 'cancelled', finishedAt: clock.iso() })
    await db.reservations.update(job.reservationId, { status: 'completed' })
    const printer = await db.printers.get(job.printerId)
    if (printer?.currentJobId === job.id) await db.printers.update(printer.id, { status: 'idle', currentJobId: undefined })
    await writeAudit(actor, 'jobs.cancel', 'job', jobId)
  })
}

/**
 * Registra una falla en una impresora. Si estaba imprimiendo, el trabajo se marca como fallido
 * y se libera el filamento no usado. El evento `printer.failed` dispara el mantenimiento correctivo.
 */
export async function reportFailure(actor: Actor | null, printerId: string, reason: string): Promise<void> {
  assertCan(actor, 'printers:manage')
  const why = parseInput(z.string().trim().min(3, 'Describe la falla (mín. 3 caracteres).').max(200), reason)
  await runTx([...JOB_TABLES], async (ctx) => {
    const printer = await db.printers.get(printerId)
    if (!printer) throw notFound('Impresora no encontrada.')
    if (printer.status !== 'idle' && printer.status !== 'printing') {
      throw conflict(`Solo se puede reportar una falla en una impresora disponible o imprimiendo (ahora: ${PRINTER_STATUS_LABEL[printer.status].toLowerCase()}).`)
    }
    let jobId: string | undefined
    let userId: string | undefined
    const job = printer.currentJobId ? await db.jobs.get(printer.currentJobId) : undefined
    if (job && job.status === 'printing') {
      const nowMs = clock.nowMs()
      const plan = planSettlement(job, nowMs)
      for (const move of settlementMovements(job, plan, true)) await applyMovement(ctx, job.userId, move)
      await saveSettlement(ctx, job, plan, nowMs)
      await db.jobs.update(job.id, { status: 'failed', failureReason: why, finishedAt: clock.iso() })
      await db.reservations.update(job.reservationId, { status: 'completed' })
      jobId = job.id
      userId = job.userId
    }
    await db.printers.update(printerId, { status: 'error', currentJobId: undefined })
    await writeAudit(actor, 'printers.failure', 'printer', printerId, why)
    ctx.emit({ type: 'printer.failed', printerId, printerName: printer.name, reason: why, jobId, userId })
  })
}

/* -------------------------------------------------------------------------- */
/*  Utilidades para el módulo de mantenimiento (se usan DENTRO de su transacción) */
/* -------------------------------------------------------------------------- */

/** Marca como "afectadas" las reservas confirmadas que chocan con una ventana de mantenimiento. */
export async function flagReservationsInWindow(
  ctx: TxContext,
  printer: Pick<Printer, 'id' | 'name'>,
  startIso: string,
  endIso: string,
  taskId: string,
): Promise<number> {
  const hit = await db.reservations
    .where('printerId')
    .equals(printer.id)
    .filter((r) => r.status === 'confirmed' && overlaps(r.startsAt, r.endsAt, startIso, endIso))
    .toArray()
  for (const r of hit) {
    await db.reservations.update(r.id, { status: 'affected' })
    ctx.emit({
      type: 'reservation.affected',
      reservationId: r.id,
      userId: r.userId,
      printerId: printer.id,
      printerName: printer.name,
      taskId,
    })
  }
  return hit.length
}

/** Devuelve a "confirmada" las reservas afectadas que ya no chocan con ningún mantenimiento activo. */
export async function restoreReservations(printerId: string): Promise<void> {
  const nowIso = clock.iso()
  const affected = await db.reservations
    .where('printerId')
    .equals(printerId)
    .filter((r) => r.status === 'affected')
    .toArray()
  if (!affected.length) return
  const active = await db.maintenance
    .where('printerId')
    .equals(printerId)
    .filter((t) => ACTIVE_MAINTENANCE_STATUSES.includes(t.status))
    .toArray()
  for (const r of affected) {
    if (active.some((t) => overlaps(t.scheduledStart, t.scheduledEnd, r.startsAt, r.endsAt))) continue
    await db.reservations.update(r.id, { status: r.endsAt <= nowIso ? 'expired' : 'confirmed' })
  }
}
