import { clock } from '@/core/clock/clock'
import { DAY, MINUTE, dayKey } from '@/core/dates'
import { db } from '@/core/db/db'
import { invalid } from '@/core/errors'
import { assertCan, SYSTEM_ACTOR, type Actor } from '@/core/permissions/roles'
import { createRng, type Rng } from '@/core/random'
import { availableOf, receiveStock } from '../inventory/service'
import { RETURNABLE_KINDS, type InventoryItem } from '../inventory/types'
import { addPart, completeMaintenance, startMaintenance } from '../maintenance/service'
import {
  cancelReservation,
  createReservation,
  reportFailure,
  startJob,
} from '../printers/service'
import {
  approveRequest,
  createRequest,
  deliverRequest,
  getRequest,
  rejectRequest,
  returnLine,
} from '../requests/service'
import { SIM_SPEEDS, type Scenario, type SimCounters, type SimState } from './types'

const SIM_ID = 'main'
const MAX_DT_MINUTES = 6 * 60

const zeroCounters = (): SimCounters => ({
  ticks: 0,
  requests: 0,
  approvals: 0,
  deliveries: 0,
  returns: 0,
  jobs: 0,
  failures: 0,
  restocks: 0,
})

const defaultState = (): SimState => ({
  id: SIM_ID,
  running: false,
  speed: 10,
  scenario: 'normal',
  seed: 20260101,
  rngState: 20260101,
  virtualNow: Date.now(),
  savedAtReal: Date.now(),
  lastTickVirtual: Date.now(),
  counters: zeroCounters(),
})

/* -------------------------------------------------------------------------- */
/*  Estado persistente y control                                               */
/* -------------------------------------------------------------------------- */

export async function getSimState(): Promise<SimState> {
  const existing = await db.sim.get(SIM_ID)
  if (existing) return existing
  const fresh = defaultState()
  await db.sim.add(fresh).catch(() => undefined) // otro llamador pudo crearlo antes
  return (await db.sim.get(SIM_ID)) ?? fresh
}

const patch = (changes: Partial<SimState>) => db.sim.update(SIM_ID, changes)

/** Restaura el reloj al abrir la app. Mientras estuvo cerrada, el tiempo corrió a velocidad real. */
export async function initSimulationClock(): Promise<SimState> {
  const state = await getSimState()
  const virtualNow = state.virtualNow + Math.max(0, Date.now() - state.savedAtReal)
  clock.restore(virtualNow, state.running ? state.speed : 1)
  await patch({ virtualNow, savedAtReal: Date.now(), lastTickVirtual: virtualNow })
  return getSimState()
}

/** Guarda el instante virtual actual (se llama periódicamente). */
export async function saveClock(): Promise<void> {
  await db.sim.update(SIM_ID, { virtualNow: clock.nowMs(), savedAtReal: Date.now() })
}

function assertSpeed(speed: number): void {
  if (!(SIM_SPEEDS as readonly number[]).includes(speed)) throw invalid('Velocidad no válida.')
}

export async function startSimulation(
  actor: Actor | null,
  opts: { speed?: number; scenario?: Scenario } = {},
): Promise<void> {
  assertCan(actor, 'simulation:control')
  const state = await getSimState()
  const speed = opts.speed ?? state.speed
  assertSpeed(speed)
  clock.setSpeed(speed)
  const now = clock.nowMs()
  await patch({
    running: true,
    speed,
    scenario: opts.scenario ?? state.scenario,
    lastTickVirtual: now,
    virtualNow: now,
    savedAtReal: Date.now(),
  })
}

export async function pauseSimulation(actor: Actor | null): Promise<void> {
  assertCan(actor, 'simulation:control')
  clock.setSpeed(1)
  await patch({ running: false, virtualNow: clock.nowMs(), savedAtReal: Date.now() })
}

export async function setSimulationSpeed(actor: Actor | null, speed: number): Promise<void> {
  assertCan(actor, 'simulation:control')
  assertSpeed(speed)
  const state = await getSimState()
  if (state.running) clock.setSpeed(speed)
  await patch({ speed, lastTickVirtual: clock.nowMs() })
}

export async function setScenario(actor: Actor | null, scenario: Scenario): Promise<void> {
  assertCan(actor, 'simulation:control')
  await patch({ scenario })
}

/* -------------------------------------------------------------------------- */
/*  Motor                                                                      */
/* -------------------------------------------------------------------------- */

interface Params {
  requestsPerHour: number
  jobsPerHour: number
  failurePerJobHour: number
  restock: boolean
}

const PARAMS: Record<Scenario, Params> = {
  normal: { requestsPerHour: 0.5, jobsPerHour: 0.6, failurePerJobHour: 0.02, restock: true },
  busy: { requestsPerHour: 1.6, jobsPerHour: 1.4, failurePerJobHour: 0.04, restock: true },
  incidents: { requestsPerHour: 0.5, jobsPerHour: 0.8, failurePerJobHour: 0.35, restock: true },
  shortage: { requestsPerHour: 1.2, jobsPerHour: 0.9, failurePerJobHour: 0.03, restock: false },
}

const REQUEST_PURPOSES = [
  'Proyecto de robótica seguidor de línea',
  'Práctica de circuitos en el laboratorio',
  'Prototipo para la feria de ciencias',
  'Taller de programación con micro:bit',
  'Maqueta de ciudad inteligente',
  'Brazo robótico para exposición',
  'Reparación de equipos del aula',
  'Proyecto de domótica con sensores',
]
const JOB_NAMES = ['Engranaje de transmisión', 'Soporte de sensor', 'Carcasa para Arduino', 'Pieza de maqueta', 'Llavero del colegio', 'Chasis de robot', 'Rueda omnidireccional', 'Pinza para brazo']
const FAILURES = ['Atasco de filamento en la boquilla', 'Desprendimiento de la cama de impresión', 'Falla del ventilador de capa', 'Boquilla obstruida', 'Fallo de calibración del eje Z']

/** Probabilidad de que ocurra al menos un evento de tasa `rate` por hora en `dtMin` minutos. */
const prob = (ratePerHour: number, dtMin: number) => 1 - Math.exp((-ratePerHour * dtMin) / 60)

async function regularUsers(): Promise<Actor[]> {
  const users = await db.users.filter((u) => u.role === 'user' && u.status === 'active').toArray()
  return users.map((u) => ({ id: u.id, name: u.name, role: u.role }))
}

async function createRandomRequest(rng: Rng, users: Actor[], counters: SimCounters): Promise<void> {
  const pool = (await db.items.toArray()).filter((i) => i.active && i.kind !== 'filament' && availableOf(i) > 0)
  if (!pool.length || !users.length) return
  const user = rng.pick(users)
  const chosen = new Map<string, InventoryItem>()
  for (let n = rng.int(1, 3); n > 0; n--) {
    const item = rng.pick(pool)
    chosen.set(item.id, item)
  }
  const lines = [...chosen.values()].map((item) => ({
    itemId: item.id,
    qty: RETURNABLE_KINDS.includes(item.kind) ? 1 : rng.int(1, Math.max(1, Math.min(6, Math.floor(item.onHand / 2)))),
  }))
  try {
    await createRequest(user, {
      purpose: rng.pick(REQUEST_PURPOSES),
      neededBy: dayKey(clock.nowMs() + rng.int(0, 2) * DAY),
      lines,
    })
    counters.requests++
  } catch {
    /* sin stock suficiente en este momento: se intentará más tarde */
  }
}

/** El "administrador simulado" atiende la cola: aprueba, entrega y recibe devoluciones. */
async function processRequests(rng: Rng, counters: SimCounters): Promise<void> {
  const now = clock.nowMs()
  const open = await db.requests.where('status').anyOf('pending', 'approved', 'delivered').toArray()
  for (const r of open) {
    if (r.status === 'pending' && now - Date.parse(r.createdAt) >= 20 * MINUTE && rng.chance(0.45)) {
      try {
        await approveRequest(SYSTEM_ACTOR, r.id, 'Aprobada automáticamente (simulación).')
        counters.approvals++
      } catch {
        await rejectRequest(SYSTEM_ACTOR, r.id, 'No hay existencias suficientes para atender la solicitud.').catch(() => undefined)
      }
    } else if (r.status === 'approved' && now - Date.parse(r.decidedAt ?? r.createdAt) >= 30 * MINUTE && rng.chance(0.45)) {
      await deliverRequest(SYSTEM_ACTOR, r.id)
        .then(() => {
          counters.deliveries++
        })
        .catch(() => undefined)
    } else if (r.status === 'delivered' && now - Date.parse(r.deliveredAt ?? r.updatedAt) >= 90 * MINUTE && rng.chance(0.3)) {
      const found = await getRequest(r.id)
      for (const line of found?.lines ?? []) {
        const pending = line.qtyDelivered - line.qtyReturned
        if (line.returnable && pending > 0) await returnLine(SYSTEM_ACTOR, r.id, line.id, pending).catch(() => undefined)
      }
      counters.returns++
    }
  }
}

async function maybeStartJob(rng: Rng, users: Actor[], counters: SimCounters): Promise<void> {
  const idle = (await db.printers.toArray()).filter((p) => p.active && p.status === 'idle')
  if (!idle.length || !users.length) return
  const printer = rng.pick(idle)
  const minutes = rng.int(20, 150)
  const grams = rng.int(15, 120)
  const filaments = (await db.items.toArray()).filter((i) => i.active && i.kind === 'filament' && availableOf(i) >= grams)
  if (!filaments.length) return
  const user = rng.pick(users)
  const filament = rng.pick(filaments)
  const start = clock.nowMs()
  try {
    const reservation = await createReservation(user, {
      printerId: printer.id,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + (minutes + 15) * MINUTE).toISOString(),
      purpose: 'Impresión 3D de proyecto',
    })
    try {
      await startJob(user, {
        reservationId: reservation.id,
        name: rng.pick(JOB_NAMES),
        filamentItemId: filament.id,
        gramsEstimated: grams,
        estimatedMinutes: minutes,
      })
      counters.jobs++
    } catch (error) {
      await cancelReservation(user, reservation.id).catch(() => undefined)
      throw error
    }
  } catch {
    /* la impresora tiene reservas o mantenimiento próximos: se intentará más tarde */
  }
}

async function maybeFailPrinters(rng: Rng, dtMin: number, params: Params, counters: SimCounters): Promise<void> {
  const printing = (await db.printers.toArray()).filter((p) => p.active && p.status === 'printing')
  for (const printer of printing) {
    if (!rng.chance(prob(params.failurePerJobHour, dtMin))) continue
    await reportFailure(SYSTEM_ACTOR, printer.id, rng.pick(FAILURES))
      .then(() => {
        counters.failures++
      })
      .catch(() => undefined)
  }
}

/** El "técnico simulado" inicia y completa los mantenimientos pendientes. */
async function runTechnician(rng: Rng): Promise<void> {
  const now = clock.nowMs()
  const tasks = await db.maintenance.where('status').anyOf('scheduled', 'in_progress').toArray()
  for (const task of tasks) {
    if (task.status === 'scheduled' && Date.parse(task.scheduledStart) <= now && rng.chance(0.4)) {
      await startMaintenance(SYSTEM_ACTOR, task.id).catch(() => undefined) // si está imprimiendo, espera
    } else if (task.status === 'in_progress' && task.startedAt && now - Date.parse(task.startedAt) >= 75 * MINUTE && rng.chance(0.4)) {
      if (task.type === 'corrective' && rng.chance(0.6)) {
        const parts = (await db.items.toArray()).filter((i) => i.sku.startsWith('3D-') && i.kind === 'consumable' && availableOf(i) > 0)
        if (parts.length) await addPart(SYSTEM_ACTOR, task.id, rng.pick(parts).id, 1).catch(() => undefined)
      }
      await completeMaintenance(SYSTEM_ACTOR, task.id, {
        laborCost: rng.int(8, 40),
        notes: 'Revisión y ajustes completados (simulación).',
      }).catch(() => undefined)
    }
  }
}

async function restock(rng: Rng, dtMin: number, counters: SimCounters): Promise<void> {
  const low = (await db.items.toArray()).filter((i) => i.active && availableOf(i) <= i.minStock).slice(0, 2)
  for (const item of low) {
    if (!rng.chance(prob(0.8, dtMin))) continue
    await receiveStock(SYSTEM_ACTOR, item.id, Math.max(item.minStock * 3, 10), 'Reposición automática (simulación)')
      .then(() => {
        counters.restocks++
      })
      .catch(() => undefined)
  }
}

/**
 * Avanza la simulación `dtMin` minutos virtuales. Todo pasa por los MISMOS servicios que usa la
 * interfaz, así que cada paso respeta (y prueba) las reglas de coherencia del sistema.
 */
export async function stepSimulation(rng: Rng, dtMin: number, scenario: Scenario, counters: SimCounters): Promise<void> {
  const params = PARAMS[scenario]
  const users = await regularUsers()
  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (error) {
      console.error('[simulación] paso con error', error)
    }
  }
  if (rng.chance(prob(params.requestsPerHour, dtMin))) await guard(() => createRandomRequest(rng, users, counters))
  await guard(() => processRequests(rng, counters))
  if (rng.chance(prob(params.jobsPerHour, dtMin))) await guard(() => maybeStartJob(rng, users, counters))
  await guard(() => maybeFailPrinters(rng, dtMin, params, counters))
  await guard(() => runTechnician(rng))
  if (params.restock) await guard(() => restock(rng, dtMin, counters))
}

let ticking = false

/** Un "tick" de simulación. Lo invoca el proceso en segundo plano; ignora llamadas solapadas. */
export async function tickSimulation(): Promise<boolean> {
  if (ticking) return false
  ticking = true
  try {
    const state = await getSimState()
    if (!state.running) return false
    const now = clock.nowMs()
    const dtMin = Math.min((now - state.lastTickVirtual) / MINUTE, MAX_DT_MINUTES)
    if (dtMin <= 0) return false
    const rng = createRng(state.rngState)
    const counters = { ...state.counters }
    await stepSimulation(rng, dtMin, state.scenario, counters)
    counters.ticks += 1
    await patch({ rngState: rng.getState(), lastTickVirtual: now, counters, virtualNow: now, savedAtReal: Date.now() })
    return true
  } finally {
    ticking = false
  }
}
