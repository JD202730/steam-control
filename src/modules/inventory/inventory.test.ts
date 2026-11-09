import { beforeEach, describe, expect, it } from 'vitest'
import { db, INVENTORY_TABLES } from '@/core/db/db'
import { runTx } from '@/core/db/tx'
import { bus } from '@/core/events/bus'
import type { DomainEvent } from '@/core/events/types'
import { admin, alice, makeWorld, resetDb } from '@/test/helpers'
import {
  adjustStock,
  applyMovement,
  availableOf,
  createItem,
  getItem,
  listMovements,
  receiveStock,
  setItemActive,
  updateItem,
  verifyLedger,
} from './service'

describe('inventario', () => {
  beforeEach(() => resetDb())

  it('crea un artículo con su stock inicial registrado en el libro de movimientos', async () => {
    const { item } = await makeWorld()
    const created = await item('abc-1', { initialStock: 25 })
    expect(created.sku).toBe('ABC-1')
    expect(created.onHand).toBe(25)
    const moves = await listMovements(created.id)
    expect(moves).toHaveLength(1)
    expect(moves[0]).toMatchObject({ type: 'in', qty: 25, balanceOnHand: 25, reason: 'Stock inicial' })
    expect((await verifyLedger()).ok).toBe(true)
  })

  it('rechaza SKU duplicado, datos inválidos y usuarios sin permiso', async () => {
    const { item, category } = await makeWorld()
    await item('DUP')
    await expect(item('dup')).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(item('X', { name: '' })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(item('NEG', { minStock: -1 })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(
      createItem(alice, { sku: 'ZZ', name: 'Zeta', categoryId: category.id, kind: 'consumable', unit: 'ud', minStock: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(createItem(null, { sku: 'ZZ', name: 'Zeta', categoryId: category.id, kind: 'consumable', unit: 'ud', minStock: 1 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('mantiene las invariantes: sin stock negativo y sin reservar más de lo disponible', async () => {
    const { item } = await makeWorld()
    const a = await item('INV', { initialStock: 10 })
    const move = (type: 'reserve' | 'out' | 'release' | 'issue', qty: number) =>
      runTx([...INVENTORY_TABLES], (ctx) => applyMovement(ctx, admin.id, { itemId: a.id, type, qty, reason: 'prueba' }))

    await move('reserve', 6)
    expect(availableOf((await getItem(a.id))!)).toBe(4)
    await expect(move('reserve', 5)).rejects.toMatchObject({ code: 'CONFLICT' }) // solo quedan 4
    await expect(move('out', 5)).rejects.toMatchObject({ code: 'CONFLICT' }) // tocaría lo reservado
    await expect(move('release', 7)).rejects.toMatchObject({ code: 'CONFLICT' }) // reserva negativa
    await move('issue', 6)
    expect(await getItem(a.id)).toMatchObject({ onHand: 4, reserved: 0 })
    await expect(runTx([...INVENTORY_TABLES], (ctx) => applyMovement(ctx, admin.id, { itemId: a.id, type: 'in', qty: 1.5, reason: 'x' }))).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    expect((await verifyLedger()).ok).toBe(true)
  })

  it('un movimiento fallido no deja rastro (todo o nada)', async () => {
    const { item } = await makeWorld()
    const a = await item('AT1', { initialStock: 10 })
    const b = await item('AT2', { initialStock: 1 })
    const before = await db.movements.count()
    await expect(
      runTx([...INVENTORY_TABLES], async (ctx) => {
        await applyMovement(ctx, admin.id, { itemId: a.id, type: 'reserve', qty: 5, reason: 'x' })
        await applyMovement(ctx, admin.id, { itemId: b.id, type: 'reserve', qty: 5, reason: 'x' }) // falla
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await getItem(a.id)).toMatchObject({ reserved: 0 })
    expect(await db.movements.count()).toBe(before)
  })

  it('entradas y ajustes por conteo físico quedan en el libro con su motivo', async () => {
    const { item } = await makeWorld()
    const a = await item('ADJ', { initialStock: 10 })
    await receiveStock(admin, a.id, 5, 'Compra')
    await adjustStock(admin, a.id, -3, 'Conteo físico')
    expect(await getItem(a.id)).toMatchObject({ onHand: 12 })
    const moves = await listMovements(a.id)
    expect(moves.map((m) => m.type).sort()).toEqual(['adjust', 'in', 'in'])
    await expect(adjustStock(admin, a.id, 0, 'nada')).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(adjustStock(admin, a.id, -100, 'mucho')).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(receiveStock(alice, a.id, 1, 'intento')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await verifyLedger()).ok).toBe(true)
  })

  it('verifyLedger detecta una alteración manual del stock', async () => {
    const { item } = await makeWorld()
    const a = await item('TMP', { initialStock: 10 })
    await db.items.update(a.id, { onHand: 99 }) // alteración fuera de los servicios
    const report = await verifyLedger()
    expect(report.ok).toBe(false)
    expect(report.issues[0]).toMatchObject({ itemId: a.id, expectedOnHand: 10, actualOnHand: 99 })
  })

  it('emite stock.low al cruzar el mínimo y stock.out al agotarse', async () => {
    const { item } = await makeWorld()
    const a = await item('EVT', { initialStock: 6, minStock: 3 })
    const events: DomainEvent[] = []
    bus.on('stock.low', (e) => void events.push(e))
    bus.on('stock.out', (e) => void events.push(e))
    await adjustStock(admin, a.id, -2, 'consumo') // 4 > 3: aún no
    expect(events).toHaveLength(0)
    await adjustStock(admin, a.id, -1, 'consumo') // 3 <= 3: stock bajo
    expect(events.map((e) => e.type)).toEqual(['stock.low'])
    await adjustStock(admin, a.id, -3, 'consumo') // 0: agotado
    expect(events.map((e) => e.type)).toEqual(['stock.low', 'stock.out'])
  })

  it('no se desactiva un artículo con reservas abiertas; editar no toca las existencias', async () => {
    const { item } = await makeWorld()
    const a = await item('ACT', { initialStock: 10 })
    await runTx([...INVENTORY_TABLES], (ctx) => applyMovement(ctx, admin.id, { itemId: a.id, type: 'reserve', qty: 2, reason: 'x' }))
    await expect(setItemActive(admin, a.id, false)).rejects.toMatchObject({ code: 'CONFLICT' })
    const updated = await updateItem(admin, a.id, { name: 'Nuevo nombre', minStock: 4 })
    expect(updated).toMatchObject({ name: 'Nuevo nombre', minStock: 4, onHand: 10, reserved: 2 })
  })
})
