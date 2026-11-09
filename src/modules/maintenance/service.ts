import { z } from 'zod'
import { clock } from '@/core/clock/clock'
import { HOUR, overlaps, toIso } from '@/core/dates'
import { writeAudit } from '@/core/db/audit'
import { db, INVENTORY_TABLES } from '@/core/db/db'
import { runTx } from '@/core/db/tx'
import { bus } from '@/core/events/bus'
import { conflict, invalid, notFound } from '@/core/errors'
import { newId } from '@/core/ids'
import { assertCan, SYSTEM_ACTOR, type Actor } from '@/core/permissions/roles'
import { parseInput } from '@/core/validation'
import { applyMovement } from '../inventory/service'
import { flagReservationsInWindow, restoreReservations } from '../printers/service'
import type { Printer } from '../printers/types'
import {
  ACTIVE_MAINTENANCE_STATUSES,
  type MaintenanceTask,
  type MaintenanceTrigger,
  type MaintenanceType,
  type PartUse,
} from './types'

const MAINT_TABLES = [db.maintenance, db.partUses, db.printers, db.reservations, ...INVENTORY_TABLES] as const

/* -------------------------------------------------------------------------- */
/*  Lectura                                                                    */
/* -------------------------------------------------------------------------- */

export async function listTasks(filter: { printerId?: string } = {}): Promise<MaintenanceTask[]> {
  const rows = filter.printerId
    ? await db.maintenance.where('printerId').equals(filter.printerId).toArray()
    : await db.maintenance.toArray()
  return rows.sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart))
}

export const listParts = (taskId: string): Promise<PartUse[]> => db.partUses.where('taskId').equals(taskId).toArray()

/** Programado cuyo horario ya terminó sin iniciarse. */
export const isTaskOverdue = (task: MaintenanceTask, nowMs: number): boolean =>
  task.status === 'scheduled' && Date.parse(task.scheduledEnd) < nowMs

/* -------------------------------------------------------------------------- */
/*  Programación                                                               */
/* -------------------------------------------------------------------------- */

const scheduleSchema = z.object({
  printerId: z.string().min(1, 'Selecciona una impresora.'),
  type: z.enum(['preventive', 'corrective']),
  title: z.string().trim().min(3, 'El título debe tener al menos 3 caracteres.').max(100),
  description: z.string().trim().max(400).default(''),
  scheduledStart: z.string().min(1, 'Indica el inicio.'),
  scheduledEnd: z.string().min(1, 'Indica el fin.'),
})

export type ScheduleInput = z.input<typeof scheduleSchema>

/** Valida los datos y arma la tarea. Solo lee de Dexie (ver el aviso en core/db/tx). */
async function buildTask(
  actor: Actor,
  data: z.output<typeof scheduleSchema>,
  trigger: MaintenanceTrigger,
): Promise<{ task: MaintenanceTask; printer: Printer }> {
  let start: string
  let end: string
  try {
    start = toIso(data.scheduledStart)
    end = toIso(data.scheduledEnd)
  } catch {
    throw invalid('Las fechas del mantenimiento no son válidas.')
  }
  if (end <= start) throw invalid('El fin debe ser posterior al inicio.')
  if (Date.parse(end) < clock.nowMs()) throw invalid('El mantenimiento no puede terminar en el pasado.')

  const printer = await db.printers.get(data.printerId)
  if (!printer || !printer.active) throw notFound('Impresora no encontrada.')

  const clash = await db.maintenance
    .where('printerId')
    .equals(printer.id)
    .filter((t) => ACTIVE_MAINTENANCE_STATUSES.includes(t.status) && overlaps(t.scheduledStart, t.scheduledEnd, start, end))
    .first()
  if (clash) throw conflict(`${printer.name} ya tiene un mantenimiento programado que se cruza con ese horario ("${clash.title}").`)

  const task: MaintenanceTask = {
    id: newId(),
    printerId: printer.id,
    type: data.type,
    status: 'scheduled',
    trigger,
    title: data.title,
    description: data.description,
    scheduledStart: start,
    scheduledEnd: end,
    partsCost: 0,
    laborCost: 0,
    createdBy: actor.id,
    createdAt: clock.iso(),
  }
  return { task, printer }
}

/**
 * Programa un mantenimiento: valida el horario, lo guarda y marca como "afectadas" las reservas
 * que chocan con él. `skipIf` permite no duplicar tareas automáticas ya abiertas (devuelve null).
 */
async function schedule(
  actor: Actor,
  data: z.output<typeof scheduleSchema>,
  trigger: MaintenanceTrigger,
  skipIf?: (open: MaintenanceTask) => boolean,
): Promise<MaintenanceTask | null> {
  return runTx([...MAINT_TABLES], async (ctx) => {
    if (skipIf) {
      const open = await db.maintenance
        .where('printerId')
        .equals(data.printerId)
        .filter((t) => ACTIVE_MAINTENANCE_STATUSES.includes(t.status) && skipIf(t))
        .first()
      if (open) return null
    }
    const { task, printer } = await buildTask(actor, data, trigger)
    await db.maintenance.add(task)
    await flagReservationsInWindow(ctx, printer, task.scheduledStart, task.scheduledEnd, task.id)
    await writeAudit(actor, 'maintenance.schedule', 'maintenance', task.id, task.title)
    ctx.emit({ type: 'maintenance.scheduled', taskId: task.id, printerId: printer.id, printerName: printer.name, title: task.title })
    return task
  })
}

export async function scheduleMaintenance(actor: Actor | null, input: ScheduleInput): Promise<MaintenanceTask> {
  assertCan(actor, 'maintenance:manage')
  const data = parseInput(scheduleSchema, input)
  return (await schedule(actor, data, 'manual'))!
}

/* -------------------------------------------------------------------------- */
/*  Ciclo de vida                                                              */
/* -------------------------------------------------------------------------- */

export async function startMaintenance(actor: Actor | null, taskId: string): Promise<MaintenanceTask> {
  assertCan(actor, 'maintenance:manage')
  return runTx([...MAINT_TABLES], async (ctx) => {
    const task = await db.maintenance.get(taskId)
    if (!task) throw notFound('Tarea no encontrada.')
    if (task.status !== 'scheduled') throw conflict('Solo se pueden iniciar tareas programadas.')
    const printer = await db.printers.get(task.printerId)
    if (!printer) throw notFound('Impresora no encontrada.')
    if (printer.status === 'printing') {
      throw conflict(`${printer.name} está imprimiendo. Espera a que termine o cancela el trabajo antes de iniciar el mantenimiento.`)
    }
    if (printer.status === 'maintenance') throw conflict(`${printer.name} ya está en mantenimiento.`)
    await db.printers.update(printer.id, { status: 'maintenance', currentJobId: undefined })
    await db.maintenance.update(taskId, { status: 'in_progress', startedAt: clock.iso() })
    await writeAudit(actor, 'maintenance.start', 'maintenance', taskId)
    ctx.emit({ type: 'maintenance.started', taskId, printerId: printer.id, printerName: printer.name, title: task.title })
    return (await db.maintenance.get(taskId))!
  })
}

/** Registra un repuesto usado: descuenta el stock por el mismo servicio de inventario. */
export async function addPart(actor: Actor | null, taskId: string, itemId: string, qty: number): Promise<MaintenanceTask> {
  assertCan(actor, 'maintenance:manage')
  const amount = parseInput(z.number('La cantidad debe ser un número.').int('La cantidad debe ser un entero.').min(1, 'La cantidad mínima es 1.'), qty)
  return runTx([...MAINT_TABLES], async (ctx) => {
    const task = await db.maintenance.get(taskId)
    if (!task) throw notFound('Tarea no encontrada.')
    if (task.status !== 'in_progress') throw conflict('Solo se pueden registrar repuestos en un mantenimiento en curso.')
    const item = await db.items.get(itemId)
    if (!item) throw notFound('Artículo no encontrado.')
    await applyMovement(ctx, actor.id, {
      itemId,
      type: 'out',
      qty: amount,
      reason: `Repuesto para mantenimiento: ${task.title}`,
      refType: 'maintenance',
      refId: taskId,
    })
    await db.partUses.add({ id: newId(), taskId, itemId, qty: amount, unitCost: item.unitCost, at: clock.iso() })
    await db.maintenance.update(taskId, { partsCost: task.partsCost + amount * item.unitCost })
    await writeAudit(actor, 'maintenance.part', 'maintenance', taskId, `${item.name} x${amount}`)
    return (await db.maintenance.get(taskId))!
  })
}

export async function completeMaintenance(
  actor: Actor | null,
  taskId: string,
  input: { laborCost?: number; notes?: string } = {},
): Promise<MaintenanceTask> {
  assertCan(actor, 'maintenance:manage')
  const data = parseInput(
    z.object({
      laborCost: z.number('El costo debe ser un número.').min(0, 'El costo no puede ser negativo.').default(0),
      notes: z.string().trim().max(400).optional(),
    }),
    input,
  )
  return runTx([...MAINT_TABLES], async (ctx) => {
    const task = await db.maintenance.get(taskId)
    if (!task) throw notFound('Tarea no encontrada.')
    if (task.status !== 'in_progress') throw conflict('Solo se pueden completar mantenimientos en curso.')
    const printer = await db.printers.get(task.printerId)
    if (!printer) throw notFound('Impresora no encontrada.')
    const now = clock.iso()
    await db.maintenance.update(taskId, { status: 'done', completedAt: now, laborCost: data.laborCost, notes: data.notes })
    // El equipo vuelve a estar disponible con el contador de horas en cero.
    await db.printers.update(printer.id, { status: 'idle', hoursSinceMaintenance: 0, lastMaintenanceAt: now })
    await restoreReservations(printer.id)
    await writeAudit(actor, 'maintenance.complete', 'maintenance', taskId)
    ctx.emit({ type: 'maintenance.completed', taskId, printerId: printer.id, printerName: printer.name, title: task.title })
    return (await db.maintenance.get(taskId))!
  })
}

export async function cancelMaintenance(actor: Actor | null, taskId: string): Promise<void> {
  assertCan(actor, 'maintenance:manage')
  await runTx([...MAINT_TABLES], async () => {
    const task = await db.maintenance.get(taskId)
    if (!task) throw notFound('Tarea no encontrada.')
    if (task.status !== 'scheduled') throw conflict('Solo se pueden cancelar tareas programadas.')
    await db.maintenance.update(taskId, { status: 'cancelled' })
    await restoreReservations(task.printerId)
    await writeAudit(actor, 'maintenance.cancel', 'maintenance', taskId)
  })
}

/* -------------------------------------------------------------------------- */
/*  Reacciones automáticas a eventos de otros módulos                          */
/* -------------------------------------------------------------------------- */

async function createSystemTask(
  printerId: string,
  type: MaintenanceType,
  trigger: MaintenanceTrigger,
  title: string,
  description: string,
  startOffsetH: number,
  durationH: number,
): Promise<void> {
  const start = clock.nowMs() + startOffsetH * HOUR
  const data = {
    printerId,
    type,
    title,
    description,
    scheduledStart: new Date(start).toISOString(),
    scheduledEnd: new Date(start + durationH * HOUR).toISOString(),
  }
  try {
    await schedule(SYSTEM_ACTOR, parseInput(scheduleSchema, data), trigger, (t) =>
      trigger === 'hours' ? t.type === 'preventive' : true,
    )
  } catch (error) {
    console.error('[maintenance] no se pudo crear la tarea automática', error)
  }
}

/** Suscribe el módulo a los eventos que le interesan. Devuelve la función para cancelar. */
export function registerMaintenanceHandlers(): () => void {
  const offs = [
    bus.on('printer.failed', (e) =>
      createSystemTask(e.printerId, 'corrective', 'failure', `Reparación: ${e.reason}`, `Falla reportada en ${e.printerName}.`, 0, 4),
    ),
    bus.on('maintenance.due', (e) =>
      createSystemTask(
        e.printerId,
        'preventive',
        'hours',
        'Mantenimiento preventivo por horas de uso',
        `${e.printerName} acumuló ${e.hours} h de impresión desde su último mantenimiento.`,
        2,
        2,
      ),
    ),
  ]
  return () => offs.forEach((off) => off())
}
