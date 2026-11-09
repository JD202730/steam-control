export type ItemKind = 'consumable' | 'tool' | 'equipment' | 'filament'

export const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  consumable: 'Consumible',
  tool: 'Herramienta',
  equipment: 'Equipo',
  filament: 'Filamento 3D',
}

/** Herramientas y equipos se prestan y deben devolverse; el resto se consume. */
export const RETURNABLE_KINDS: readonly ItemKind[] = ['tool', 'equipment']

export interface Category {
  id: string
  name: string
}

export interface InventoryItem {
  id: string
  sku: string
  name: string
  categoryId: string
  kind: ItemKind
  unit: string
  /** Existencias físicas. */
  onHand: number
  /** Parte de las existencias comprometida (solicitudes aprobadas, trabajos en curso). */
  reserved: number
  minStock: number
  location: string
  unitCost: number
  active: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Tipos de movimiento del libro de inventario:
 *  in       entrada de stock (compra, donación)           onHand +q
 *  out      salida directa (consumo, repuesto)             onHand -q
 *  reserve  compromete stock para una solicitud/trabajo    reserved +q
 *  release  libera una reserva                             reserved -q
 *  issue    entrega lo reservado (sale del almacén)        onHand -q, reserved -q
 *  return   devolución de herramientas/equipos             onHand +q
 *  adjust   corrección por conteo físico (con signo)       onHand ±q
 */
export type MovementType = 'in' | 'out' | 'reserve' | 'release' | 'issue' | 'return' | 'adjust'

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  in: 'Entrada',
  out: 'Salida',
  reserve: 'Reserva',
  release: 'Liberación',
  issue: 'Entrega',
  return: 'Devolución',
  adjust: 'Ajuste',
}

export type MovementRef = 'request' | 'job' | 'maintenance' | 'manual' | 'seed'

export interface StockMovement {
  id: string
  itemId: string
  type: MovementType
  /** Cantidad absoluta (en 'adjust' conserva el signo). */
  qty: number
  deltaOnHand: number
  deltaReserved: number
  balanceOnHand: number
  balanceReserved: number
  reason: string
  refType?: MovementRef
  refId?: string
  actorId: string
  at: string
}
