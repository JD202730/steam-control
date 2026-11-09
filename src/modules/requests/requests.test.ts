import { beforeEach, describe, expect, it } from 'vitest'
import { addDaysToDay } from '@/core/dates'
import { db } from '@/core/db/db'
import { admin, alice, bob, makeWorld, resetDb, today } from '@/test/helpers'
import { getItem, verifyLedger } from '../inventory/service'
import { listNotifications } from '../notifications/service'
import {
  approveRequest,
  cancelRequest,
  createRequest,
  deliverRequest,
  getRequest,
  isReturnOverdue,
  listRequests,
  rejectRequest,
  returnLine,
} from './service'

describe('solicitudes', () => {
  beforeEach(() => resetDb())

  it('flujo completo de un consumible: crear → aprobar (reserva) → entregar (sale del almacén) → cerrada', async () => {
    const { item } = await makeWorld()
    const cables = await item('CAB', { initialStock: 10 })
    const req = await createRequest(alice, { purpose: 'Proyecto de robótica', neededBy: today(), lines: [{ itemId: cables.id, qty: 4 }] })
    expect(req.status).toBe('pending')
    expect(await getItem(cables.id)).toMatchObject({ onHand: 10, reserved: 0 }) // crear no toca el stock

    await approveRequest(admin, req.id, 'ok')
    expect(await getItem(cables.id)).toMatchObject({ onHand: 10, reserved: 4 })

    const delivered = await deliverRequest(admin, req.id)
    expect(delivered.status).toBe('closed') // sin nada que devolver, se cierra al entregar
    expect(await getItem(cables.id)).toMatchObject({ onHand: 6, reserved: 0 })
    expect((await verifyLedger()).ok).toBe(true)
  })

  it('herramientas: se entregan, quedan pendientes de devolución y al devolverlas la solicitud se cierra', async () => {
    const { item } = await makeWorld()
    const sold = await item('SOL', { kind: 'tool', initialStock: 5 })
    const req = await createRequest(alice, { purpose: 'Práctica de soldadura', neededBy: today(), lines: [{ itemId: sold.id, qty: 2 }] })
    await approveRequest(admin, req.id)
    expect((await deliverRequest(admin, req.id)).status).toBe('delivered')
    expect(await getItem(sold.id)).toMatchObject({ onHand: 3, reserved: 0 })

    const { lines } = (await getRequest(req.id))!
    await expect(returnLine(admin, req.id, lines[0].id, 3)).rejects.toMatchObject({ code: 'CONFLICT' }) // más de lo entregado
    expect((await returnLine(admin, req.id, lines[0].id, 1)).status).toBe('delivered') // devolución parcial
    expect((await returnLine(admin, req.id, lines[0].id, 1)).status).toBe('closed')
    expect(await getItem(sold.id)).toMatchObject({ onHand: 5, reserved: 0 })
    expect((await verifyLedger()).ok).toBe(true)
  })

  it('aprobar es todo o nada: si una línea no alcanza, no se reserva ninguna', async () => {
    const { item } = await makeWorld()
    const a = await item('AAA', { initialStock: 10 })
    const b = await item('BBB', { initialStock: 5 })
    const first = await createRequest(alice, { purpose: 'Pedido de Alice', neededBy: today(), lines: [{ itemId: b.id, qty: 4 }] })
    const second = await createRequest(bob, {
      purpose: 'Pedido de Bob',
      neededBy: today(),
      lines: [
        { itemId: a.id, qty: 3 },
        { itemId: b.id, qty: 3 },
      ],
    })
    await approveRequest(admin, first.id) // reserva 4 de B; quedan 1 disponibles
    await expect(approveRequest(admin, second.id)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await getItem(a.id)).toMatchObject({ reserved: 0 }) // la línea de A se revirtió
    expect(await getItem(b.id)).toMatchObject({ reserved: 4 })
    expect((await getRequest(second.id))!.request.status).toBe('pending')
    expect((await verifyLedger()).ok).toBe(true)
  })

  it('cancelar una solicitud aprobada libera el stock reservado', async () => {
    const { item } = await makeWorld()
    const a = await item('CAN', { initialStock: 10 })
    const req = await createRequest(alice, { purpose: 'Se me cruzó otra clase', neededBy: today(), lines: [{ itemId: a.id, qty: 7 }] })
    await approveRequest(admin, req.id)
    expect(await getItem(a.id)).toMatchObject({ reserved: 7 })
    await cancelRequest(alice, req.id)
    expect(await getItem(a.id)).toMatchObject({ onHand: 10, reserved: 0 })
    expect((await getRequest(req.id))!.request.status).toBe('cancelled')
  })

  it('máquina de estados: rechaza transiciones inválidas', async () => {
    const { item } = await makeWorld()
    const a = await item('MAQ', { initialStock: 10 })
    const req = await createRequest(alice, { purpose: 'Prueba de estados', neededBy: today(), lines: [{ itemId: a.id, qty: 1 }] })
    await expect(deliverRequest(admin, req.id)).rejects.toMatchObject({ code: 'CONFLICT' }) // pendiente no se entrega
    await rejectRequest(admin, req.id, 'No hay material')
    await expect(approveRequest(admin, req.id)).rejects.toMatchObject({ code: 'CONFLICT' }) // rechazada no se aprueba
    await expect(cancelRequest(alice, req.id)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(rejectRequest(admin, req.id, '')).rejects.toBeDefined()
  })

  it('permisos: el usuario no gestiona solicitudes ni cancela las ajenas', async () => {
    const { item } = await makeWorld()
    const a = await item('PER', { initialStock: 10 })
    const req = await createRequest(alice, { purpose: 'Solicitud de Alice', neededBy: today(), lines: [{ itemId: a.id, qty: 1 }] })
    await expect(approveRequest(alice, req.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(rejectRequest(alice, req.id, 'no')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(deliverRequest(bob, req.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(cancelRequest(bob, req.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(createRequest(null, { purpose: 'Sin sesión', neededBy: today(), lines: [{ itemId: a.id, qty: 1 }] })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await getRequest(req.id))!.request.status).toBe('pending')
  })

  it('valida la entrada: cantidades, fechas, artículos y existencias', async () => {
    const { item } = await makeWorld()
    const a = await item('VAL', { initialStock: 3 })
    const base = { purpose: 'Validaciones varias', neededBy: today() }
    await expect(createRequest(alice, { ...base, lines: [] })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(createRequest(alice, { ...base, lines: [{ itemId: a.id, qty: 0 }] })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(createRequest(alice, { ...base, lines: [{ itemId: a.id, qty: 1.5 }] })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(createRequest(alice, { ...base, purpose: 'ab', lines: [{ itemId: a.id, qty: 1 }] })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(createRequest(alice, { ...base, neededBy: '2001-01-01', lines: [{ itemId: a.id, qty: 1 }] })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(createRequest(alice, { ...base, returnBy: addDaysToDay(today(), -2), lines: [{ itemId: a.id, qty: 1 }] })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(createRequest(alice, { ...base, lines: [{ itemId: 'no-existe', qty: 1 }] })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(createRequest(alice, { ...base, lines: [{ itemId: a.id, qty: 4 }] })).rejects.toMatchObject({ code: 'CONFLICT' }) // solo hay 3
    expect(await db.requests.count()).toBe(0)
  })

  it('une líneas repetidas del mismo artículo y lista solo las solicitudes pedidas', async () => {
    const { item } = await makeWorld()
    const a = await item('MRG', { initialStock: 10 })
    const req = await createRequest(alice, {
      purpose: 'Líneas repetidas',
      neededBy: today(),
      lines: [
        { itemId: a.id, qty: 2 },
        { itemId: a.id, qty: 3 },
      ],
    })
    expect((await getRequest(req.id))!.lines).toHaveLength(1)
    expect((await getRequest(req.id))!.lines[0].qty).toBe(5)
    await createRequest(bob, { purpose: 'Pedido de Bob', neededBy: today(), lines: [{ itemId: a.id, qty: 1 }] })
    expect(await listRequests({ requesterId: alice.id })).toHaveLength(1)
    expect(await listRequests({ status: 'pending' })).toHaveLength(2)
  })

  it('detecta devoluciones vencidas', async () => {
    const { item } = await makeWorld()
    const t = await item('VEN', { kind: 'tool', initialStock: 2 })
    const req = await createRequest(alice, { purpose: 'Préstamo largo', neededBy: today(), returnBy: today(), lines: [{ itemId: t.id, qty: 1 }] })
    await approveRequest(admin, req.id)
    const delivered = await deliverRequest(admin, req.id)
    expect(isReturnOverdue(delivered, Date.now())).toBe(false)
    expect(isReturnOverdue(delivered, Date.now() + 3 * 86_400_000)).toBe(true)
  })

  it('genera notificaciones: al administrador al crear y al solicitante al decidir', async () => {
    const { item } = await makeWorld()
    const a = await item('NOT', { initialStock: 10 })
    const req = await createRequest(alice, { purpose: 'Para notificar', neededBy: today(), lines: [{ itemId: a.id, qty: 1 }] })
    expect((await listNotifications(admin.id)).some((n) => n.kind === 'request.created')).toBe(true)
    expect(await listNotifications(alice.id)).toHaveLength(0)
    await approveRequest(admin, req.id)
    expect((await listNotifications(alice.id)).map((n) => n.kind)).toContain('request.approved')
    await deliverRequest(admin, req.id)
    expect((await listNotifications(alice.id)).map((n) => n.kind)).toContain('request.delivered')
  })
})
