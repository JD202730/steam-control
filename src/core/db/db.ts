import Dexie, { type Table } from 'dexie'
import type { Category, InventoryItem, StockMovement } from '@/modules/inventory/types'
import type { MaintenanceTask, PartUse } from '@/modules/maintenance/types'
import type { AlertAck, Notification } from '@/modules/notifications/types'
import type { PrintJob, Printer, Reservation } from '@/modules/printers/types'
import type { RequestLine, SupplyRequest } from '@/modules/requests/types'
import type { SimState } from '@/modules/simulation/types'
import type { User } from '@/modules/users/types'

export interface AuditEntry {
  id: string
  at: string
  actorId: string
  actorName: string
  action: string
  entity: string
  entityId: string
  detail?: string
}

export interface MetaEntry {
  key: string
  value: unknown
}

/**
 * Base de datos local (IndexedDB). Es la única fuente de verdad: los módulos nunca
 * mantienen copias propias, y la interfaz se actualiza sola con liveQuery.
 */
export class SteamDB extends Dexie {
  declare users: Table<User, string>
  declare categories: Table<Category, string>
  declare items: Table<InventoryItem, string>
  declare movements: Table<StockMovement, string>
  declare requests: Table<SupplyRequest, string>
  declare requestLines: Table<RequestLine, string>
  declare printers: Table<Printer, string>
  declare reservations: Table<Reservation, string>
  declare jobs: Table<PrintJob, string>
  declare maintenance: Table<MaintenanceTask, string>
  declare partUses: Table<PartUse, string>
  declare notifications: Table<Notification, string>
  declare alertAcks: Table<AlertAck, string>
  declare audit: Table<AuditEntry, string>
  declare sim: Table<SimState, string>
  declare meta: Table<MetaEntry, string>

  constructor(name = 'steam-control') {
    super(name)
    // Esquema versionado: para cambiar la estructura se añade una versión nueva con su migración.
    this.version(1).stores({
      users: 'id, &email, role, status',
      categories: 'id, &name',
      items: 'id, &sku, categoryId, kind',
      movements: 'id, itemId, type, at, [refType+refId]',
      requests: 'id, requesterId, status, createdAt',
      requestLines: 'id, requestId, itemId',
      printers: 'id, status',
      reservations: 'id, printerId, userId, status, startsAt, endsAt',
      jobs: 'id, printerId, userId, reservationId, status, startedAt',
      maintenance: 'id, printerId, status, type, scheduledStart',
      partUses: 'id, taskId, itemId',
      notifications: 'id, userId, createdAt',
      alertAcks: 'key',
      audit: 'id, at, actorId, entity',
      sim: 'id',
      meta: 'key',
    })
  }
}

export const db = new SteamDB()

/** Tablas que cualquier transacción debe incluir si mueve stock. */
export const INVENTORY_TABLES = [db.items, db.movements] as const
