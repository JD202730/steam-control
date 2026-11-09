import { MAINTENANCE_STATUS_LABEL, MAINTENANCE_TYPE_LABEL, type MaintenanceStatus, type MaintenanceType } from '@/modules/maintenance/types'
import { JOB_STATUS_LABEL, PRINTER_STATUS_LABEL, RESERVATION_STATUS_LABEL, type JobStatus, type PrinterStatus, type ReservationStatus } from '@/modules/printers/types'
import { REQUEST_STATUS_LABEL, type RequestStatus } from '@/modules/requests/types'
import type { Severity } from '@/modules/notifications/types'
import { Badge, type Tone } from './Badge'

const REQUEST_TONE: Record<RequestStatus, Tone> = { pending: 'warn', approved: 'info', rejected: 'bad', cancelled: 'neutral', delivered: 'brand', closed: 'ok' }
const PRINTER_TONE: Record<PrinterStatus, Tone> = { idle: 'ok', printing: 'info', maintenance: 'warn', error: 'bad', offline: 'neutral' }
const RESERVATION_TONE: Record<ReservationStatus, Tone> = { confirmed: 'info', in_progress: 'brand', completed: 'ok', cancelled: 'neutral', expired: 'neutral', affected: 'warn' }
const JOB_TONE: Record<JobStatus, Tone> = { printing: 'info', completed: 'ok', failed: 'bad', cancelled: 'neutral' }
const MAINTENANCE_TONE: Record<MaintenanceStatus, Tone> = { scheduled: 'info', in_progress: 'warn', done: 'ok', cancelled: 'neutral' }

export const RequestStatusBadge = ({ status }: { status: RequestStatus }) => <Badge tone={REQUEST_TONE[status]}>{REQUEST_STATUS_LABEL[status]}</Badge>
export const PrinterStatusBadge = ({ status }: { status: PrinterStatus }) => <Badge tone={PRINTER_TONE[status]}>{PRINTER_STATUS_LABEL[status]}</Badge>
export const ReservationStatusBadge = ({ status }: { status: ReservationStatus }) => <Badge tone={RESERVATION_TONE[status]}>{RESERVATION_STATUS_LABEL[status]}</Badge>
export const JobStatusBadge = ({ status }: { status: JobStatus }) => <Badge tone={JOB_TONE[status]}>{JOB_STATUS_LABEL[status]}</Badge>
export const MaintenanceStatusBadge = ({ status }: { status: MaintenanceStatus }) => <Badge tone={MAINTENANCE_TONE[status]}>{MAINTENANCE_STATUS_LABEL[status]}</Badge>
export const MaintenanceTypeBadge = ({ type }: { type: MaintenanceType }) => <Badge tone={type === 'corrective' ? 'bad' : 'brand'}>{MAINTENANCE_TYPE_LABEL[type]}</Badge>

export const SEVERITY_TONE: Record<Severity, Tone> = { info: 'info', success: 'ok', warning: 'warn', danger: 'bad' }
export const SEVERITY_LABEL: Record<Severity, string> = { info: 'Info', success: 'Listo', warning: 'Atención', danger: 'Urgente' }
