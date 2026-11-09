import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clock } from '@/core/clock/clock'
import { DAY, HOUR, MINUTE } from '@/core/dates'
import { db } from '@/core/db/db'
import { admin, alice, bob, makeWorld, resetDb, today } from '@/test/helpers'
import { adjustStock, receiveStock } from '../inventory/service'
import { scheduleMaintenance } from '../maintenance/service'
import { reportFailure } from '../printers/service'
import { approveRequest, createRequest, deliverRequest } from '../requests/service'
import { acknowledgeAlert, computeAlerts, loadAlerts, pruneAlertAcks } from './alerts'
import { countUnread, listNotifications, markAllRead, markRead } from './service'

const T0 = Date.parse('2026-06-01T10:00:00Z')

describe('notificaciones', () => {
  beforeEach(() => resetDb())

  it('cada usuario recibe solo las suyas; marcar como leída es personal', async () => {
    const { item } = await makeWorld()
    const a = await item('NOT')
    await createRequest(alice, { purpose: 'Pedido de Alice', neededBy: today(), lines: [{ itemId: a.id, qty: 1 }] })
    await createRequest(bob, { purpose: 'Pedido de Bob', neededBy: today(), lines: [{ itemId: a.id, qty: 1 }] })

    const forAdmin = await listNotifications(admin.id)
    expect(forAdmin).toHaveLength(2) // una por cada solicitud nueva
    expect(await listNotifications(alice.id)).toHaveLength(0)
    expect(await countUnread(admin.id)).toBe(2)

    await expect(markRead(alice, forAdmin[0].id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await markRead(admin, forAdmin[0].id)
    expect(await countUnread(admin.id)).toBe(1)
    await markAllRead(admin)
    expect(await countUnread(admin.id)).toBe(0)
    await expect(markRead(null, forAdmin[0].id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('avisa al administrador del stock bajo y agotado', async () => {
    const { item } = await makeWorld()
    const a = await item('LOW', { initialStock: 5, minStock: 3 })
    await adjustStock(admin, a.id, -2, 'consumo') // 3: bajo
    await adjustStock(admin, a.id, -3, 'consumo') // 0: agotado
    const kinds = (await listNotifications(admin.id)).map((n) => n.kind)
    expect(kinds).toEqual(expect.arrayContaining(['stock.low', 'stock.out']))
  })

  it('el solicitante recibe aviso al aprobar, entregar y devolver', async () => {
    const { item } = await makeWorld()
    const tool = await item('TOOL', { kind: 'tool' })
    const req = await createRequest(alice, { purpose: 'Préstamo de herramienta', neededBy: today(), lines: [{ itemId: tool.id, qty: 1 }] })
    await approveRequest(admin, req.id)
    await deliverRequest(admin, req.id)
    const kinds = (await listNotifications(alice.id)).map((n) => n.kind)
    expect(kinds).toEqual(expect.arrayContaining(['request.approved', 'request.delivered']))
  })
})

describe('alertas (se calculan a partir de los datos)', () => {
  beforeEach(async () => {
    await resetDb()
    clock.freeze(T0)
  })
  afterEach(() => clock.resetToRealTime())

  it('stock bajo y agotado aparecen y desaparecen al reponer', async () => {
    const { item } = await makeWorld()
    const a = await item('STK', { initialStock: 6, minStock: 3 })
    expect(await loadAlerts()).toHaveLength(0)

    await adjustStock(admin, a.id, -3, 'consumo')
    expect((await loadAlerts()).map((x) => x.kind)).toEqual(['stock_low'])
    await adjustStock(admin, a.id, -3, 'consumo')
    expect((await loadAlerts()).map((x) => x.kind)).toEqual(['stock_out']) // el agotado reemplaza al bajo

    await receiveStock(admin, a.id, 20, 'Compra')
    expect(await loadAlerts()).toHaveLength(0)
  })

  it('reconocer una alerta la marca como atendida; al resolverse el problema se limpia el reconocimiento', async () => {
    const { item } = await makeWorld()
    const a = await item('ACK', { initialStock: 4, minStock: 3 })
    await adjustStock(admin, a.id, -2, 'consumo')
    const [alert] = await loadAlerts()
    expect(alert).toMatchObject({ key: `stock_low:${a.id}`, acked: false })

    await expect(acknowledgeAlert(alice, alert.key)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await acknowledgeAlert(admin, alert.key)
    expect((await loadAlerts())[0].acked).toBe(true)

    await receiveStock(admin, a.id, 20, 'Compra')
    expect(await pruneAlertAcks()).toBe(1)
    expect(await db.alertAcks.count()).toBe(0)
    await adjustStock(admin, a.id, -20, 'consumo') // el problema vuelve: la alerta reaparece sin reconocer
    expect((await loadAlerts())[0].acked).toBe(false)
  })

  it('solicitudes sin atender más de 24 h y devoluciones vencidas', async () => {
    const { item } = await makeWorld()
    const a = await item('REQ')
    const tool = await item('HER', { kind: 'tool' })
    await createRequest(alice, { purpose: 'Sin respuesta', neededBy: today(), lines: [{ itemId: a.id, qty: 1 }] })
    const loan = await createRequest(bob, {
      purpose: 'Préstamo largo',
      neededBy: today(),
      returnBy: today(),
      lines: [{ itemId: tool.id, qty: 1 }],
    })
    await approveRequest(admin, loan.id)
    await deliverRequest(admin, loan.id)
    expect(await loadAlerts()).toHaveLength(0)

    clock.freeze(T0 + 25 * HOUR)
    const kinds = (await loadAlerts()).map((x) => x.kind).sort()
    expect(kinds).toEqual(['request_pending', 'return_overdue'])
  })

  it('impresora con falla, mantenimiento requerido y mantenimiento vencido', async () => {
    const { printer } = await makeWorld()
    await db.printers.update(printer.id, { hoursSinceMaintenance: printer.maintenanceIntervalHours + 5 })
    expect((await loadAlerts()).map((x) => x.kind)).toEqual(['maintenance_due'])

    await reportFailure(admin, printer.id, 'Atasco')
    const afterFailure = (await loadAlerts()).map((x) => x.kind).sort()
    expect(afterFailure).toEqual(['maintenance_due', 'printer_error'])

    // Una tarea programada que nadie inició se vuelve "vencida".
    await db.maintenance.clear()
    await scheduleMaintenance(admin, {
      printerId: printer.id,
      type: 'preventive',
      title: 'Revisión general',
      scheduledStart: new Date(T0 + 10 * MINUTE).toISOString(),
      scheduledEnd: new Date(T0 + 60 * MINUTE).toISOString(),
    })
    clock.freeze(T0 + 2 * DAY)
    const kinds = (await loadAlerts()).map((x) => x.kind)
    expect(kinds).toContain('maintenance_overdue')
  })

  it('computeAlerts es una función pura y ordena por gravedad', () => {
    const base = { items: [], requests: [], printers: [], tasks: [], reservations: [], acks: [], nowMs: T0 }
    expect(computeAlerts(base)).toEqual([])
    const item = (id: string, onHand: number) => ({
      id,
      sku: id,
      name: id,
      categoryId: 'c',
      kind: 'consumable' as const,
      unit: 'ud',
      onHand,
      reserved: 0,
      minStock: 5,
      location: '',
      unitCost: 0,
      active: true,
      createdAt: '',
      updatedAt: '',
    })
    const alerts = computeAlerts({ ...base, items: [item('bajo', 3), item('agotado', 0), item('bien', 50)] })
    expect(alerts.map((x) => [x.kind, x.severity])).toEqual([
      ['stock_out', 'danger'],
      ['stock_low', 'warning'],
    ])
  })
})
