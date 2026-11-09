import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clock } from '@/core/clock/clock'
import { MINUTE } from '@/core/dates'
import { db } from '@/core/db/db'
import { admin, alice, makeWorld, resetDb } from '@/test/helpers'
import { getItem, verifyLedger } from '../inventory/service'
import { listNotifications } from '../notifications/service'
import { createReservation, getPrinter, reportFailure, startJob } from '../printers/service'
import {
  addPart,
  cancelMaintenance,
  completeMaintenance,
  isTaskOverdue,
  listParts,
  scheduleMaintenance,
  startMaintenance,
} from './service'

const T0 = Date.parse('2026-06-01T10:00:00Z')
const at = (minutes: number) => new Date(T0 + minutes * MINUTE).toISOString()

async function setup() {
  const world = await makeWorld()
  const noz = await world.item('NOZ', { initialStock: 3, unitCost: 2.5 })
  const plan = (o: { from?: number; to?: number; title?: string; type?: 'preventive' | 'corrective' } = {}) =>
    scheduleMaintenance(admin, {
      printerId: world.printer.id,
      type: o.type ?? 'preventive',
      title: o.title ?? 'Lubricación de ejes',
      scheduledStart: at(o.from ?? 60),
      scheduledEnd: at(o.to ?? 180),
    })
  const reserve = (from: number, to: number, user = alice) =>
    createReservation(user, { printerId: world.printer.id, startsAt: at(from), endsAt: at(to), purpose: 'Impresión de prueba' })
  return { ...world, noz, plan, reserve }
}

describe('mantenimiento', () => {
  beforeEach(async () => {
    await resetDb()
    clock.freeze(T0)
  })
  afterEach(() => clock.resetToRealTime())

  it('programar marca las reservas que chocan como "afectadas" y avisa a sus dueños', async () => {
    const { plan, reserve } = await setup()
    const inside = await reserve(90, 120)
    const outside = await reserve(300, 360)
    const task = await plan({ from: 60, to: 180 })

    expect(task).toMatchObject({ status: 'scheduled', trigger: 'manual' })
    expect((await db.reservations.get(inside.id))!.status).toBe('affected')
    expect((await db.reservations.get(outside.id))!.status).toBe('confirmed')
    expect((await listNotifications(alice.id)).map((n) => n.kind)).toContain('reservation.affected')
  })

  it('una franja afectada sigue ocupada: no se puede reservar encima (ni durante el mantenimiento)', async () => {
    const { plan, reserve } = await setup()
    const inside = await reserve(90, 120)
    await plan({ from: 60, to: 180 })
    expect((await db.reservations.get(inside.id))!.status).toBe('affected')
    await expect(reserve(95, 110)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(reserve(150, 170)).rejects.toMatchObject({ code: 'CONFLICT' }) // dentro de la ventana de mantenimiento
  })

  it('no permite mantenimientos solapados en la misma impresora, ni fechas inválidas ni usuarios comunes', async () => {
    const { plan, printer } = await setup()
    await plan({ from: 60, to: 180 })
    await expect(plan({ from: 120, to: 240, title: 'Otro mantenimiento' })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(plan({ from: 300, to: 250 })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(plan({ from: -300, to: -240 })).rejects.toMatchObject({ code: 'VALIDATION' }) // terminó en el pasado
    await expect(
      scheduleMaintenance(alice, { printerId: printer.id, type: 'preventive', title: 'Intento', scheduledStart: at(500), scheduledEnd: at(560) }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('cancelar la tarea devuelve las reservas afectadas a "confirmada"', async () => {
    const { plan, reserve } = await setup()
    const r = await reserve(90, 120)
    const task = await plan({ from: 60, to: 180 })
    expect((await db.reservations.get(r.id))!.status).toBe('affected')
    await cancelMaintenance(admin, task.id)
    expect((await db.reservations.get(r.id))!.status).toBe('confirmed')
    expect((await db.maintenance.get(task.id))!.status).toBe('cancelled')
    await expect(cancelMaintenance(admin, task.id)).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('ciclo completo: iniciar (impresora en mantenimiento) → repuesto (descuenta stock) → completar (impresora disponible y horas en cero)', async () => {
    const { plan, noz, printer } = await setup()
    await db.printers.update(printer.id, { hoursSinceMaintenance: 95 })
    const task = await plan()

    await startMaintenance(admin, task.id)
    expect((await getPrinter(printer.id))!.status).toBe('maintenance')
    await expect(startMaintenance(admin, task.id)).rejects.toMatchObject({ code: 'CONFLICT' }) // ya iniciada

    const withPart = await addPart(admin, task.id, noz.id, 2)
    expect(withPart.partsCost).toBe(5)
    expect(await getItem(noz.id)).toMatchObject({ onHand: 1, reserved: 0 })
    expect(await listParts(task.id)).toHaveLength(1)
    await expect(addPart(admin, task.id, noz.id, 5)).rejects.toMatchObject({ code: 'CONFLICT' }) // solo queda 1
    expect(await getItem(noz.id)).toMatchObject({ onHand: 1 }) // el intento fallido no cambió nada

    clock.freeze(T0 + 150 * MINUTE)
    const done = await completeMaintenance(admin, task.id, { laborCost: 12, notes: 'Todo en orden' })
    expect(done).toMatchObject({ status: 'done', laborCost: 12, partsCost: 5 })
    expect(done.completedAt).toBeDefined()
    const printerAfter = (await getPrinter(printer.id))!
    expect(printerAfter).toMatchObject({ status: 'idle', hoursSinceMaintenance: 0 })
    expect(printerAfter.lastMaintenanceAt).toBeDefined()
    await expect(addPart(admin, task.id, noz.id, 1)).rejects.toMatchObject({ code: 'CONFLICT' }) // ya completada
    await expect(completeMaintenance(admin, task.id)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect((await listNotifications(admin.id)).map((n) => n.kind)).toEqual(expect.arrayContaining(['maintenance.started', 'maintenance.completed']))
    expect((await verifyLedger()).ok).toBe(true)
  })

  it('no se puede iniciar mientras la impresora está imprimiendo', async () => {
    const { plan, printer, item } = await setup()
    const pla = await item('PLA', { kind: 'filament', unit: 'g', initialStock: 1000, minStock: 100 })
    const r = await createReservation(alice, { printerId: printer.id, startsAt: at(0), endsAt: at(50), purpose: 'Imprimir algo' })
    await startJob(alice, { reservationId: r.id, name: 'Pieza', filamentItemId: pla.id, gramsEstimated: 20, estimatedMinutes: 40 })
    const task = await plan({ from: 60, to: 120 })
    await expect(startMaintenance(admin, task.id)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect((await getPrinter(printer.id))!.status).toBe('printing')
    expect((await db.maintenance.get(task.id))!.status).toBe('scheduled')
  })

  it('reparación tras una falla: la tarea correctiva automática lleva la impresora de "con falla" a "disponible"', async () => {
    const { printer } = await setup()
    await reportFailure(admin, printer.id, 'Ventilador dañado')
    expect((await getPrinter(printer.id))!.status).toBe('error')
    const [task] = await db.maintenance.where('printerId').equals(printer.id).toArray()
    expect(task).toMatchObject({ type: 'corrective', trigger: 'failure' })

    await startMaintenance(admin, task.id)
    expect((await getPrinter(printer.id))!.status).toBe('maintenance')
    await completeMaintenance(admin, task.id, { laborCost: 20 })
    expect((await getPrinter(printer.id))!.status).toBe('idle')
  })

  it('detecta tareas vencidas (programadas cuyo horario ya pasó sin iniciarse)', async () => {
    const { plan } = await setup()
    const task = await plan({ from: 30, to: 90 })
    expect(isTaskOverdue(task, T0 + 60 * MINUTE)).toBe(false)
    expect(isTaskOverdue(task, T0 + 100 * MINUTE)).toBe(true)
  })
})
