import { z } from 'zod'
import { clock } from '@/core/clock/clock'
import { writeAudit } from '@/core/db/audit'
import { db, INVENTORY_TABLES } from '@/core/db/db'
import { runTx, type TxContext } from '@/core/db/tx'
import { conflict, invalid, isConstraintError, notFound } from '@/core/errors'
import { newId } from '@/core/ids'
import { assertCan, type Actor } from '@/core/permissions/roles'
import { parseInput } from '@/core/validation'
import type { Category, InventoryItem, MovementRef, MovementType, StockMovement } from './types'

/* -------------------------------------------------------------------------- */
/*  Lectura                                                                    */
/* -------------------------------------------------------------------------- */

export const availableOf = (item: Pick<InventoryItem, 'onHand' | 'reserved'>): number =>
  item.onHand - item.reserved

export const isLowStock = (item: InventoryItem): boolean =>
  item.active && availableOf(item) <= item.minStock

export async function listItems(): Promise<InventoryItem[]> {
  const items = await db.items.toArray()
  return items.sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export const getItem = (id: string) => db.items.get(id)

export async function listCategories(): Promise<Category[]> {
  const cats = await db.categories.toArray()
  return cats.sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export async function listMovements(itemId?: string, limit = 100): Promise<StockMovement[]> {
  const rows = itemId
    ? await db.movements.where('itemId').equals(itemId).toArray()
    : await db.movements.toArray()
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}

/* -------------------------------------------------------------------------- */
/*  Libro de movimientos: ÚNICO punto que modifica existencias                 */
/* -------------------------------------------------------------------------- */

export interface MovementInput {
  itemId: string
  type: MovementType
  /** Entero positivo; en 'adjust' es la diferencia con signo (distinta de 0). */
  qty: number
  reason: string
  refType?: MovementRef
  refId?: string
}

function deltasOf(type: MovementType, qty: number): { onHand: number; reserved: number } {
  switch (type) {
    case 'in':
    case 'return':
    case 'adjust':
      return { onHand: qty, reserved: 0 }
    case 'out':
      return { onHand: -qty, reserved: 0 }
    case 'reserve':
      return { onHand: 0, reserved: qty }
    case 'release':
      return { onHand: 0, reserved: -qty }
    case 'issue':
      return { onHand: -qty, reserved: -qty }
  }
}

/**
 * Aplica un movimiento de stock. Debe ejecutarse dentro de runTx con las tablas de inventario.
 * Garantiza las invariantes: onHand >= 0, 0 <= reserved <= onHand. Si no se cumplen, lanza
 * y la transacción completa se revierte.
 */
export async function applyMovement(
  ctx: TxContext,
  actorId: string,
  input: MovementInput,
): Promise<StockMovement> {
  const { itemId, type, qty } = input
  if (!Number.isInteger(qty) || qty === 0 || (type !== 'adjust' && qty < 0)) {
    throw invalid('La cantidad debe ser un número entero positivo.')
  }
  const item = await db.items.get(itemId)
  if (!item) throw notFound('Artículo no encontrado.')
  if (!item.active && (type === 'reserve' || type === 'in')) {
    throw conflict(`"${item.name}" está desactivado.`)
  }

  const d = deltasOf(type, qty)
  const onHand = item.onHand + d.onHand
  const reserved = item.reserved + d.reserved
  const availableBefore = availableOf(item)

  if (reserved < 0) throw conflict(`La reserva de "${item.name}" no puede ser negativa.`)
  if (onHand < 0 || reserved > onHand) {
    throw conflict(
      type === 'adjust' && onHand >= 0
        ? `No se puede ajustar "${item.name}" por debajo de lo reservado (${item.reserved} ${item.unit}).`
        : `Stock insuficiente de "${item.name}": disponible ${availableBefore} ${item.unit}, se necesitan ${Math.abs(qty)}.`,
    )
  }

  const at = clock.iso()
  await db.items.update(itemId, { onHand, reserved, updatedAt: at })
  const movement: StockMovement = {
    id: newId(),
    itemId,
    type,
    qty,
    deltaOnHand: d.onHand,
    deltaReserved: d.reserved,
    balanceOnHand: onHand,
    balanceReserved: reserved,
    reason: input.reason,
    refType: input.refType,
    refId: input.refId,
    actorId,
    at,
  }
  await db.movements.add(movement)

  const availableAfter = onHand - reserved
  if (item.active) {
    if (availableAfter <= 0 && availableBefore > 0) {
      ctx.emit({ type: 'stock.out', itemId, name: item.name })
    } else if (availableAfter > 0 && availableAfter <= item.minStock && availableBefore > item.minStock) {
      ctx.emit({
        type: 'stock.low',
        itemId,
        name: item.name,
        available: availableAfter,
        minStock: item.minStock,
        unit: item.unit,
      })
    }
  }
  return movement
}

/* -------------------------------------------------------------------------- */
/*  Escritura (con permisos y validación)                                      */
/* -------------------------------------------------------------------------- */

const itemSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(2, 'El SKU debe tener al menos 2 caracteres.')
    .max(24, 'El SKU es demasiado largo.')
    .transform((s) => s.toUpperCase()),
  name: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres.').max(80),
  categoryId: z.string().min(1, 'Selecciona una categoría.'),
  kind: z.enum(['consumable', 'tool', 'equipment', 'filament']),
  unit: z.string().trim().min(1, 'Indica la unidad de medida.').max(12),
  minStock: z
    .number('El stock mínimo debe ser un número.')
    .int('El stock mínimo debe ser un entero.')
    .min(0, 'El stock mínimo no puede ser negativo.'),
  location: z.string().trim().max(60).default(''),
  unitCost: z.number('El costo debe ser un número.').min(0, 'El costo no puede ser negativo.').default(0),
  initialStock: z
    .number('El stock inicial debe ser un número.')
    .int('El stock inicial debe ser un entero.')
    .min(0, 'El stock inicial no puede ser negativo.')
    .default(0),
})

export type ItemInput = z.input<typeof itemSchema>

const updateSchema = itemSchema
  .pick({ name: true, categoryId: true, minStock: true, location: true, unitCost: true })
  .partial()

export type ItemPatch = z.input<typeof updateSchema>

export async function createItem(actor: Actor | null, input: ItemInput): Promise<InventoryItem> {
  assertCan(actor, 'inventory:write')
  const data = parseInput(itemSchema, input)
  try {
    return await runTx([...INVENTORY_TABLES, db.categories], async (ctx) => {
      if (!(await db.categories.get(data.categoryId))) throw notFound('La categoría no existe.')
      const at = clock.iso()
      const item: InventoryItem = {
        id: newId(),
        sku: data.sku,
        name: data.name,
        categoryId: data.categoryId,
        kind: data.kind,
        unit: data.unit,
        onHand: 0,
        reserved: 0,
        minStock: data.minStock,
        location: data.location,
        unitCost: data.unitCost,
        active: true,
        createdAt: at,
        updatedAt: at,
      }
      await db.items.add(item)
      if (data.initialStock > 0) {
        await applyMovement(ctx, actor.id, {
          itemId: item.id,
          type: 'in',
          qty: data.initialStock,
          reason: 'Stock inicial',
          refType: 'manual',
        })
      }
      await writeAudit(actor, 'inventory.item.create', 'item', item.id, item.name)
      return (await db.items.get(item.id))!
    })
  } catch (e) {
    if (isConstraintError(e)) throw conflict(`Ya existe un artículo con el SKU "${data.sku}".`)
    throw e
  }
}

export async function updateItem(actor: Actor | null, id: string, patch: ItemPatch): Promise<InventoryItem> {
  assertCan(actor, 'inventory:write')
  const data = parseInput(updateSchema, patch)
  return runTx([db.items, db.categories], async () => {
    const item = await db.items.get(id)
    if (!item) throw notFound('Artículo no encontrado.')
    if (data.categoryId && !(await db.categories.get(data.categoryId))) {
      throw notFound('La categoría no existe.')
    }
    await db.items.update(id, { ...data, updatedAt: clock.iso() })
    await writeAudit(actor, 'inventory.item.update', 'item', id, item.name)
    return (await db.items.get(id))!
  })
}

/** Los artículos con historial no se borran: se desactivan (y no pueden tener reservas abiertas). */
export async function setItemActive(actor: Actor | null, id: string, active: boolean): Promise<void> {
  assertCan(actor, 'inventory:write')
  await runTx([db.items], async () => {
    const item = await db.items.get(id)
    if (!item) throw notFound('Artículo no encontrado.')
    if (!active && item.reserved > 0) {
      throw conflict(`"${item.name}" tiene ${item.reserved} ${item.unit} reservados; no se puede desactivar.`)
    }
    await db.items.update(id, { active, updatedAt: clock.iso() })
    await writeAudit(actor, active ? 'inventory.item.activate' : 'inventory.item.deactivate', 'item', id, item.name)
  })
}

export async function createCategory(actor: Actor | null, name: string): Promise<Category> {
  assertCan(actor, 'inventory:write')
  const clean = parseInput(z.string().trim().min(2, 'El nombre de la categoría es muy corto.').max(40), name)
  try {
    return await runTx([db.categories], async () => {
      const category: Category = { id: newId(), name: clean }
      await db.categories.add(category)
      await writeAudit(actor, 'inventory.category.create', 'category', category.id, clean)
      return category
    })
  } catch (e) {
    if (isConstraintError(e)) throw conflict('Ya existe una categoría con ese nombre.')
    throw e
  }
}

const quantitySchema = z.object({
  qty: z.number('La cantidad debe ser un número.').int('La cantidad debe ser un entero.').min(1, 'La cantidad mínima es 1.'),
  reason: z.string().trim().min(3, 'Indica el motivo (mín. 3 caracteres).').max(160),
})

/** Entrada de stock (compra, donación). */
export async function receiveStock(
  actor: Actor | null,
  itemId: string,
  qty: number,
  reason: string,
): Promise<StockMovement> {
  assertCan(actor, 'inventory:adjust')
  const data = parseInput(quantitySchema, { qty, reason })
  return runTx([...INVENTORY_TABLES], async (ctx) => {
    const movement = await applyMovement(ctx, actor.id, {
      itemId,
      type: 'in',
      qty: data.qty,
      reason: data.reason,
      refType: 'manual',
    })
    await writeAudit(actor, 'inventory.stock.in', 'item', itemId, `+${data.qty}`)
    return movement
  })
}

/** Ajuste por conteo físico: `delta` puede ser negativo. */
export async function adjustStock(
  actor: Actor | null,
  itemId: string,
  delta: number,
  reason: string,
): Promise<StockMovement> {
  assertCan(actor, 'inventory:adjust')
  const data = parseInput(
    z.object({
      delta: z.number('El ajuste debe ser un número.').int('El ajuste debe ser un entero.').refine((n) => n !== 0, 'El ajuste no puede ser 0.'),
      reason: quantitySchema.shape.reason,
    }),
    { delta, reason },
  )
  return runTx([...INVENTORY_TABLES], async (ctx) => {
    const movement = await applyMovement(ctx, actor.id, {
      itemId,
      type: 'adjust',
      qty: data.delta,
      reason: data.reason,
      refType: 'manual',
    })
    await writeAudit(actor, 'inventory.stock.adjust', 'item', itemId, `${data.delta > 0 ? '+' : ''}${data.delta}`)
    return movement
  })
}

/* -------------------------------------------------------------------------- */
/*  Verificación de coherencia                                                 */
/* -------------------------------------------------------------------------- */

export interface LedgerIssue {
  itemId: string
  name: string
  problem: string
  expectedOnHand: number
  actualOnHand: number
  expectedReserved: number
  actualReserved: number
}

/**
 * Recalcula el stock de cada artículo desde el libro de movimientos y lo compara con el
 * valor guardado. También comprueba las invariantes. Debe devolver siempre ok = true.
 */
export async function verifyLedger(): Promise<{ ok: boolean; checked: number; issues: LedgerIssue[] }> {
  const [items, movements] = await Promise.all([db.items.toArray(), db.movements.toArray()])
  const sums = new Map<string, { onHand: number; reserved: number }>()
  for (const m of movements) {
    const s = sums.get(m.itemId) ?? { onHand: 0, reserved: 0 }
    s.onHand += m.deltaOnHand
    s.reserved += m.deltaReserved
    sums.set(m.itemId, s)
  }
  const issues: LedgerIssue[] = []
  for (const item of items) {
    const s = sums.get(item.id) ?? { onHand: 0, reserved: 0 }
    const problems: string[] = []
    if (s.onHand !== item.onHand) problems.push('existencias distintas al libro')
    if (s.reserved !== item.reserved) problems.push('reservas distintas al libro')
    if (item.onHand < 0) problems.push('existencias negativas')
    if (item.reserved < 0) problems.push('reserva negativa')
    if (item.reserved > item.onHand) problems.push('reservado mayor que existencias')
    if (problems.length) {
      issues.push({
        itemId: item.id,
        name: item.name,
        problem: problems.join('; '),
        expectedOnHand: s.onHand,
        actualOnHand: item.onHand,
        expectedReserved: s.reserved,
        actualReserved: item.reserved,
      })
    }
  }
  return { ok: issues.length === 0, checked: items.length, issues }
}
