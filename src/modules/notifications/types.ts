export type Severity = 'info' | 'success' | 'warning' | 'danger'

export interface Notification {
  id: string
  userId: string
  kind: string
  title: string
  body: string
  severity: Severity
  refType?: 'request' | 'item' | 'printer' | 'job' | 'maintenance' | 'reservation'
  refId?: string
  createdAt: string
  readAt?: string
}

export type AlertKind =
  | 'stock_out'
  | 'stock_low'
  | 'request_pending'
  | 'return_overdue'
  | 'printer_error'
  | 'maintenance_due'
  | 'maintenance_overdue'
  | 'reservation_affected'

/** Reconocimiento de una alerta por parte de un administrador. */
export interface AlertAck {
  key: string
  ackedAt: string
  ackedBy: string
}

/** Las alertas se CALCULAN a partir de los datos; solo se guarda su reconocimiento. */
export interface Alert {
  key: string
  kind: AlertKind
  severity: Severity
  title: string
  detail: string
  refType: 'item' | 'request' | 'printer' | 'maintenance' | 'reservation'
  refId: string
  since?: string
  acked: boolean
}
