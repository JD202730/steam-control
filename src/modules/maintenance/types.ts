export type MaintenanceType = 'preventive' | 'corrective'
export type MaintenanceStatus = 'scheduled' | 'in_progress' | 'done' | 'cancelled'
/** Qué originó la tarea: la creó una persona, las horas de uso o una falla. */
export type MaintenanceTrigger = 'manual' | 'hours' | 'failure'

export const MAINTENANCE_TYPE_LABEL: Record<MaintenanceType, string> = {
  preventive: 'Preventivo',
  corrective: 'Correctivo',
}

export const MAINTENANCE_STATUS_LABEL: Record<MaintenanceStatus, string> = {
  scheduled: 'Programado',
  in_progress: 'En curso',
  done: 'Completado',
  cancelled: 'Cancelado',
}

export const ACTIVE_MAINTENANCE_STATUSES: readonly MaintenanceStatus[] = ['scheduled', 'in_progress']

export interface MaintenanceTask {
  id: string
  printerId: string
  type: MaintenanceType
  status: MaintenanceStatus
  trigger: MaintenanceTrigger
  title: string
  description: string
  scheduledStart: string
  scheduledEnd: string
  startedAt?: string
  completedAt?: string
  partsCost: number
  laborCost: number
  notes?: string
  createdBy: string
  createdAt: string
}

export interface PartUse {
  id: string
  taskId: string
  itemId: string
  qty: number
  /** Costo unitario al momento del uso. */
  unitCost: number
  at: string
}
