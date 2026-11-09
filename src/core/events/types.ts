/** Eventos de dominio: así se comunican los módulos sin conocerse entre sí. */
type RequestDecision<T extends string> = {
  type: T
  requestId: string
  requesterId: string
  actorId: string
}

type JobEvent<T extends string> = {
  type: T
  jobId: string
  userId: string
  printerId: string
  name: string
}

type MaintenanceEvent<T extends string> = {
  type: T
  taskId: string
  printerId: string
  printerName: string
  title: string
}

export type DomainEvent =
  | { type: 'request.created'; requestId: string; requesterId: string }
  | RequestDecision<'request.approved'>
  | RequestDecision<'request.rejected'>
  | RequestDecision<'request.cancelled'>
  | RequestDecision<'request.delivered'>
  | RequestDecision<'request.closed'>
  | { type: 'stock.low'; itemId: string; name: string; available: number; minStock: number; unit: string }
  | { type: 'stock.out'; itemId: string; name: string }
  | { type: 'reservation.created'; reservationId: string; userId: string; printerId: string }
  | {
      type: 'reservation.affected'
      reservationId: string
      userId: string
      printerId: string
      printerName: string
      taskId: string
    }
  | JobEvent<'job.started'>
  | JobEvent<'job.completed'>
  | {
      type: 'printer.failed'
      printerId: string
      printerName: string
      reason: string
      jobId?: string
      userId?: string
    }
  | { type: 'maintenance.due'; printerId: string; printerName: string; hours: number }
  | MaintenanceEvent<'maintenance.scheduled'>
  | MaintenanceEvent<'maintenance.started'>
  | MaintenanceEvent<'maintenance.completed'>

export type EventType = DomainEvent['type']
export type EventOf<T extends EventType> = Extract<DomainEvent, { type: T }>
