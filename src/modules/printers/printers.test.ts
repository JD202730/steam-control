import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clock } from '@/core/clock/clock'
import { MINUTE } from '@/core/dates'
import { db } from '@/core/db/db'
import { admin, alice, bob, makeWorld, resetDb } from '@/test/helpers'
import { getItem, verifyLedger } from '../inventory/service'
import { listTasks } from '../maintenance/service'
import { listNotifications } from '../notifications/service'
import {
  cancelJob,
  cancelReservation,
  clearPrinterError,
  createReservation,
  expireReservations,
  getPrinter,
  listJobs,
  reportFailure,
  setPrinterOffline,
  startJob,
  syncJobs,
  updatePrinter,
} from './service'

const T0 = Date.parse('2026-06-01T10:00:00Z')
const at = (minutes: number) => new Date(T0 + minutes * MINUTE).toISOString()
const goTo = (minutes: number) => clock.freeze(T0 + minutes * MINUTE)

async function setup() {
  const world = await makeWorld()
  const pla = await world.item('PLA', { kind: 'filament', unit: 'g', initialStock: 5000, minStock: 500 })
  const book = (user = alice, from = 0, to = 180, printerId = world.printer.id) =>
    createReservation(user, { printerId, startsAt: at(from), endsAt: at(to), purpose: 'Prototipo del proyecto' })
  const job = (reservationId: string, o: { grams?: number; minutes?: number; user?: typeof alice } = {}) =>
    startJob(o.user ?? alice, {
      reservationId,
      name: 'Soporte de sensor',
      filamentItemId: pla.id,
      gramsEstimated: o.grams ?? 100,
      estimatedMinutes: o.minutes ?? 120,
    })
  return { ...world, pla, book, job }
}

describe('reservas de impresoras', () => {
  beforeEach(async () => {
    await resetDb()
    clock.freeze(T0)
  })
  afterEach(() => clock.resetToRealTime())

  it('crea una reserva y bloquea solapes (pero permite franjas contiguas)', async () => {
    const { book, printer } = await setup()
    const first = await book(alice, 0, 60)
    expect(first).toMatchObject({ status: 'confirmed', userId: alice.id })
    await expect(book(bob, 30, 90)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(book(bob, 0, 60)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(book(bob, 59, 120)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(book(bob, 60, 120)).resolves.toMatchObject({ status: 'confirmed' }) // empieza justo cuando termina la otra
    expect((await db.reservations.where('printerId').equals(printer.id).count())).toBe(2)
  })

  it('valida duración, orden de fechas, pasado y permisos', async () => {
    const { book } = await setup()
    await expect(book(alice, 60, 30)).rejects.toMatchObject({ code: 'VALIDATION' }) // fin antes que inicio
    await expect(book(alice, 0, 10)).rejects.toMatchObject({ code: 'VALIDATION' }) // menos de 15 min
    await expect(book(alice, 0, 9 * 60)).rejects.toMatchObject({ code: 'VALIDATION' }) // más de 8 h
    await expect(book(alice, -120, -60)).rejects.toMatchObject({ code: 'VALIDATION' }) // en el pasado
    await expect(createReservation(alice, { printerId: 'x', startsAt: 'no-fecha', endsAt: at(60), purpose: 'Prueba' })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(createReservation(null, { printerId: 'x', startsAt: at(0), endsAt: at(60), purpose: 'Prueba' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(book(alice, 0, 60, 'no-existe')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('limita a 5 reservas activas por usuario', async () => {
    const { book } = await setup()
    for (let i = 0; i < 5; i++) await book(alice, i * 60, i * 60 + 30)
    await expect(book(alice, 400, 430)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(book(bob, 400, 430)).resolves.toBeDefined() // el límite es por usuario
  })

  it('no permite reservar una impresora fuera de servicio', async () => {
    const { book, printer } = await setup()
    await setPrinterOffline(admin, printer.id, true)
    await expect(book()).rejects.toMatchObject({ code: 'CONFLICT' })
    await setPrinterOffline(admin, printer.id, false)
    await expect(book()).resolves.toBeDefined()
    await expect(setPrinterOffline(alice, printer.id, true)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('solo el dueño o un administrador cancela una reserva; la franja queda libre', async () => {
    const { book } = await setup()
    const r = await book(alice, 0, 60)
    await expect(cancelReservation(bob, r.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await cancelReservation(alice, r.id)
    expect((await db.reservations.get(r.id))!.status).toBe('cancelled')
    await expect(cancelReservation(alice, r.id)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(book(bob, 0, 60)).resolves.toBeDefined() // ya se puede reservar esa franja
  })

  it('marca como vencidas las reservas que nadie usó', async () => {
    const { book } = await setup()
    const r = await book(alice, 0, 60)
    goTo(61)
    expect(await expireReservations()).toBe(1)
    expect((await db.reservations.get(r.id))!.status).toBe('expired')
  })
})

describe('trabajos de impresión', () => {
  beforeEach(async () => {
    await resetDb()
    clock.freeze(T0)
  })
  afterEach(() => clock.resetToRealTime())

  it('ciclo completo: reserva filamento al iniciar, lo consume con el avance y libera la impresora al terminar', async () => {
    const { book, job, pla, printer } = await setup()
    const r = await book(alice, 0, 180)
    const started = await job(r.id, { grams: 100, minutes: 120 })

    expect(started).toMatchObject({ status: 'printing', progress: 0 })
    expect(await getItem(pla.id)).toMatchObject({ onHand: 5000, reserved: 100 })
    expect(await getPrinter(printer.id)).toMatchObject({ status: 'printing', currentJobId: started.id })
    expect((await db.reservations.get(r.id))!.status).toBe('in_progress')

    goTo(60) // mitad del trabajo
    await syncJobs()
    expect(await db.jobs.get(started.id)).toMatchObject({ progress: 50, gramsUsed: 50, status: 'printing' })
    expect(await getItem(pla.id)).toMatchObject({ onHand: 4950, reserved: 50 })

    goTo(121)
    await syncJobs()
    expect(await db.jobs.get(started.id)).toMatchObject({ progress: 100, gramsUsed: 100, status: 'completed' })
    expect(await getItem(pla.id)).toMatchObject({ onHand: 4900, reserved: 0 })
    const done = (await getPrinter(printer.id))!
    expect(done.status).toBe('idle')
    expect(done.currentJobId).toBeUndefined()
    expect(done.hoursSinceMaintenance).toBeCloseTo(2, 3)
    expect((await db.reservations.get(r.id))!.status).toBe('completed')
    expect((await listNotifications(alice.id)).map((n) => n.kind)).toContain('job.completed')
    expect((await verifyLedger()).ok).toBe(true)

    await syncJobs() // ejecutar otra vez no duplica el consumo
    expect(await getItem(pla.id)).toMatchObject({ onHand: 4900, reserved: 0 })
  })

  it('no inicia si falta filamento: nada queda a medias', async () => {
    const { book, item, printer } = await setup()
    const scarce = await item('PLA-POCO', { kind: 'filament', unit: 'g', initialStock: 50, minStock: 10 })
    const r = await book(alice, 0, 180)
    await expect(
      startJob(alice, { reservationId: r.id, name: 'Pieza grande', filamentItemId: scarce.id, gramsEstimated: 100, estimatedMinutes: 60 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await getItem(scarce.id)).toMatchObject({ onHand: 50, reserved: 0 })
    expect((await getPrinter(printer.id))!.status).toBe('idle')
    expect((await db.reservations.get(r.id))!.status).toBe('confirmed')
    expect(await listJobs()).toHaveLength(0)
  })

  it('valida horario, duración, dueño y que la impresora esté libre', async () => {
    const { book, job, pla, printer } = await setup()
    const later = await book(alice, 120, 240)
    await expect(job(later.id)).rejects.toMatchObject({ code: 'CONFLICT' }) // aún no es la hora
    const r = await book(alice, 0, 60)
    await expect(job(r.id, { minutes: 90 })).rejects.toMatchObject({ code: 'CONFLICT' }) // no cabe en la reserva
    await expect(job(r.id, { user: bob })).rejects.toMatchObject({ code: 'FORBIDDEN' }) // reserva ajena
    await expect(startJob(alice, { reservationId: r.id, name: 'X', filamentItemId: pla.id, gramsEstimated: 0, estimatedMinutes: 30 })).rejects.toMatchObject({ code: 'VALIDATION' })
    await db.printers.update(printer.id, { status: 'maintenance' })
    await expect(job(r.id, { minutes: 30 })).rejects.toMatchObject({ code: 'CONFLICT' }) // impresora no disponible
  })

  it('rechaza usar como filamento un artículo que no lo es', async () => {
    const { book, item } = await setup()
    const cable = await item('CAB')
    const r = await book()
    await expect(
      startJob(alice, { reservationId: r.id, name: 'Pieza', filamentItemId: cable.id, gramsEstimated: 10, estimatedMinutes: 30 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('cancelar a la mitad cobra lo imprimido y devuelve el resto del filamento', async () => {
    const { book, job, pla, printer } = await setup()
    const r = await book(alice, 0, 180)
    const started = await job(r.id, { grams: 100, minutes: 120 })
    goTo(30) // 25 %
    await expect(cancelJob(bob, started.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await cancelJob(alice, started.id)
    expect(await db.jobs.get(started.id)).toMatchObject({ status: 'cancelled', gramsUsed: 25 })
    expect(await getItem(pla.id)).toMatchObject({ onHand: 4975, reserved: 0 })
    expect((await getPrinter(printer.id))!.status).toBe('idle')
    expect((await verifyLedger()).ok).toBe(true)
  })

  it('una falla a mitad de trabajo lo marca fallido, libera filamento y abre un mantenimiento correctivo', async () => {
    const { book, job, pla, printer } = await setup()
    const r = await book(alice, 0, 180)
    const started = await job(r.id, { grams: 100, minutes: 120 })
    goTo(60)
    await expect(reportFailure(alice, printer.id, 'La boquilla se tapó')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await reportFailure(admin, printer.id, 'La boquilla se tapó')

    expect(await db.jobs.get(started.id)).toMatchObject({ status: 'failed', gramsUsed: 50, failureReason: 'La boquilla se tapó' })
    expect(await getItem(pla.id)).toMatchObject({ onHand: 4950, reserved: 0 }) // 50 g se perdieron, 50 g volvieron
    expect(await getPrinter(printer.id)).toMatchObject({ status: 'error' })

    const tasks = await listTasks({ printerId: printer.id })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ type: 'corrective', trigger: 'failure', status: 'scheduled' })
    expect((await listNotifications(admin.id)).map((n) => n.kind)).toContain('printer.failed')
    expect((await listNotifications(alice.id)).map((n) => n.kind)).toContain('printer.failed.job')

    await expect(reportFailure(admin, printer.id, 'Otra falla')).rejects.toMatchObject({ code: 'CONFLICT' }) // ya está con falla
    await clearPrinterError(admin, printer.id)
    expect((await getPrinter(printer.id))!.status).toBe('idle')
    expect((await verifyLedger()).ok).toBe(true)
  })

  it('al acumular las horas del intervalo se programa un mantenimiento preventivo (una sola vez)', async () => {
    const { book, job, printer } = await setup()
    await updatePrinter(admin, printer.id, { maintenanceIntervalHours: 1 })
    const r = await book(alice, 0, 180)
    await job(r.id, { minutes: 120 })
    goTo(90) // 1,5 h de uso: supera el intervalo de 1 h
    await syncJobs()
    let tasks = await listTasks({ printerId: printer.id })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ type: 'preventive', trigger: 'hours', status: 'scheduled' })
    expect((await listNotifications(admin.id)).map((n) => n.kind)).toContain('maintenance.due')

    goTo(121)
    await syncJobs()
    tasks = await listTasks({ printerId: printer.id })
    expect(tasks).toHaveLength(1) // no se duplica
  })
})
