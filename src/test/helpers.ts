import { registerAllHandlers } from '@/app/handlers'
import { clock } from '@/core/clock/clock'
import { localDay } from '@/core/dates'
import { db } from '@/core/db/db'
import { bus } from '@/core/events/bus'
import type { Actor } from '@/core/permissions/roles'
import { createCategory, createItem, type ItemInput } from '@/modules/inventory/service'
import { createPrinter } from '@/modules/printers/service'

export const admin: Actor = { id: 'a1', name: 'Ada Admin', role: 'admin' }
export const alice: Actor = { id: 'u1', name: 'Alice', role: 'user' }
export const bob: Actor = { id: 'u2', name: 'Bob', role: 'user' }

export const today = () => localDay(clock.nowMs())

/** Base de datos limpia, reloj real y manejadores de eventos registrados. */
export async function resetDb(opts: { users?: boolean } = {}): Promise<void> {
  clock.resetToRealTime()
  await db.delete()
  await db.open()
  bus.clear()
  registerAllHandlers()
  if (opts.users !== false) {
    const base = { passwordHash: 'x', status: 'active' as const, area: '', createdAt: new Date().toISOString() }
    await db.users.bulkAdd([
      { ...base, id: admin.id, name: admin.name, email: 'ada@test', role: 'admin' },
      { ...base, id: alice.id, name: alice.name, email: 'alice@test', role: 'user' },
      { ...base, id: bob.id, name: bob.name, email: 'bob@test', role: 'user' },
    ])
  }
}

/** Categoría, una impresora y una fábrica de artículos para armar escenarios rápido. */
export async function makeWorld() {
  const category = await createCategory(admin, 'General')
  const item = (sku: string, overrides: Partial<ItemInput> = {}) =>
    createItem(admin, {
      sku,
      name: `Artículo ${sku}`,
      categoryId: category.id,
      kind: 'consumable',
      unit: 'ud',
      minStock: 2,
      initialStock: 10,
      ...overrides,
    })
  const printer = await createPrinter(admin, { name: 'P1', model: 'Prusa MK4' })
  return { category, item, printer }
}
