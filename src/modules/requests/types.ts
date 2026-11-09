export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'delivered' | 'closed'

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
  delivered: 'Entregada',
  closed: 'Cerrada',
}

/**
 * Transiciones permitidas (máquina de estados):
 *  pending  -> approved | rejected | cancelled
 *  approved -> delivered | closed | cancelled
 *  delivered -> closed
 */
export const REQUEST_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['delivered', 'closed', 'cancelled'],
  delivered: ['closed'],
  rejected: [],
  cancelled: [],
  closed: [],
}

export interface SupplyRequest {
  id: string
  requesterId: string
  purpose: string
  /** 'YYYY-MM-DD' */
  neededBy: string
  /** 'YYYY-MM-DD': fecha límite de devolución de lo prestado. */
  returnBy: string
  status: RequestStatus
  createdAt: string
  updatedAt: string
  decidedBy?: string
  decidedAt?: string
  decisionNote?: string
  deliveredAt?: string
  closedAt?: string
}

export interface RequestLine {
  id: string
  requestId: string
  itemId: string
  qty: number
  qtyDelivered: number
  qtyReturned: number
  /** Se fija al crear la solicitud según el tipo de artículo. */
  returnable: boolean
}
