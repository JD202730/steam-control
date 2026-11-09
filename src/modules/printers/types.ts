export type PrinterStatus = 'idle' | 'printing' | 'maintenance' | 'error' | 'offline'

export const PRINTER_STATUS_LABEL: Record<PrinterStatus, string> = {
  idle: 'Disponible',
  printing: 'Imprimiendo',
  maintenance: 'En mantenimiento',
  error: 'Con falla',
  offline: 'Fuera de servicio',
}

export interface Printer {
  id: string
  name: string
  model: string
  location: string
  status: PrinterStatus
  currentJobId?: string
  totalPrintHours: number
  hoursSinceMaintenance: number
  /** Cada cuántas horas de impresión se requiere mantenimiento preventivo. */
  maintenanceIntervalHours: number
  lastMaintenanceAt?: string
  active: boolean
  createdAt: string
}

export type ReservationStatus =
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'affected'

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  confirmed: 'Confirmada',
  in_progress: 'En curso',
  completed: 'Completada',
  cancelled: 'Cancelada',
  expired: 'Vencida',
  affected: 'Afectada por mantenimiento',
}

/** Estados que ocupan la franja horaria de la impresora. */
export const OCCUPYING_STATUSES: readonly ReservationStatus[] = ['confirmed', 'in_progress', 'affected']

export interface Reservation {
  id: string
  printerId: string
  userId: string
  startsAt: string
  endsAt: string
  purpose: string
  status: ReservationStatus
  jobId?: string
  createdAt: string
}

export type JobStatus = 'printing' | 'completed' | 'failed' | 'cancelled'

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  printing: 'Imprimiendo',
  completed: 'Completado',
  failed: 'Fallido',
  cancelled: 'Cancelado',
}

export interface PrintJob {
  id: string
  reservationId: string
  printerId: string
  userId: string
  name: string
  filamentItemId: string
  gramsEstimated: number
  gramsUsed: number
  estimatedMinutes: number
  /** 0-100 */
  progress: number
  status: JobStatus
  startedAt: string
  lastSyncAt: string
  finishedAt?: string
  failureReason?: string
}
