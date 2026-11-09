import { clock } from '@/core/clock/clock'
import { DAY, HOUR } from '@/core/dates'
import { db } from '@/core/db/db'
import { assertCan, type Actor } from '@/core/permissions/roles'
import { availableOf } from '../inventory/service'
import type { InventoryItem } from '../inventory/types'
import { ACTIVE_MAINTENANCE_STATUSES, type MaintenanceTask } from '../maintenance/types'
import type { Printer, Reservation } from '../printers/types'
import type { SupplyRequest } from '../requests/types'
import type { Alert, AlertAck, Severity } from './types'

export interface AlertSnapshot {
  items: InventoryItem[]
  requests: SupplyRequest[]
  printers: Printer[]
  tasks: MaintenanceTask[]
  reservations: Reservation[]
  acks: AlertAck[]
  nowMs: number
}

/** Horas que una solicitud puede esperar respuesta antes de avisar. */
export const PENDING_REQUEST_ALERT_HOURS = 24

const SEVERITY_ORDER: Record<Severity, number> = { danger: 0, warning: 1, info: 2, success: 3 }

/**
 * Calcula las alertas ACTIVAS a partir del estado actual de los datos (función pura).
 * Como no se guardan, siempre reflejan la realidad: si el stock se repone, la alerta desaparece.
 */
export function computeAlerts(s: AlertSnapshot): Alert[] {
  const acked = new Set(s.acks.map((a) => a.key))
  const alerts: Alert[] = []
  const add = (a: Omit<Alert, 'acked'>) => alerts.push({ ...a, acked: acked.has(a.key) })
  const today = new Date(s.nowMs).toISOString().slice(0, 10)

  for (const item of s.items) {
    if (!item.active) continue
    const available = availableOf(item)
    if (available <= 0) {
      add({
        key: `stock_out:${item.id}`,
        kind: 'stock_out',
        severity: 'danger',
        title: `Agotado: ${item.name}`,
        detail: `Existencias ${item.onHand} ${item.unit}, reservado ${item.reserved}.`,
        refType: 'item',
        refId: item.id,
      })
    } else if (available <= item.minStock) {
      add({
        key: `stock_low:${item.id}`,
        kind: 'stock_low',
        severity: 'warning',
        title: `Stock bajo: ${item.name}`,
        detail: `Disponible ${available} ${item.unit} (mínimo ${item.minStock}).`,
        refType: 'item',
        refId: item.id,
      })
    }
  }

  for (const r of s.requests) {
    if (r.status === 'pending' && s.nowMs - Date.parse(r.createdAt) > PENDING_REQUEST_ALERT_HOURS * HOUR) {
      add({
        key: `request_pending:${r.id}`,
        kind: 'request_pending',
        severity: 'warning',
        title: 'Solicitud sin atender',
        detail: `"${r.purpose}" espera respuesta hace más de ${PENDING_REQUEST_ALERT_HOURS} h.`,
        refType: 'request',
        refId: r.id,
        since: r.createdAt,
      })
    }
    if (r.status === 'delivered' && r.returnBy < today) {
      add({
        key: `return_overdue:${r.id}`,
        kind: 'return_overdue',
        severity: 'danger',
        title: 'Devolución vencida',
        detail: `"${r.purpose}" debía devolverse el ${r.returnBy}.`,
        refType: 'request',
        refId: r.id,
        since: r.returnBy,
      })
    }
  }

  const hasActivePreventive = (printerId: string) =>
    s.tasks.some((t) => t.printerId === printerId && t.type === 'preventive' && ACTIVE_MAINTENANCE_STATUSES.includes(t.status))

  for (const p of s.printers) {
    if (!p.active) continue
    if (p.status === 'error') {
      add({
        key: `printer_error:${p.id}`,
        kind: 'printer_error',
        severity: 'danger',
        title: `${p.name} con falla`,
        detail: 'El equipo está detenido hasta que se repare.',
        refType: 'printer',
        refId: p.id,
      })
    }
    if (p.hoursSinceMaintenance >= p.maintenanceIntervalHours && !hasActivePreventive(p.id)) {
      add({
        key: `maintenance_due:${p.id}`,
        kind: 'maintenance_due',
        severity: 'warning',
        title: `${p.name} requiere mantenimiento`,
        detail: `${Math.round(p.hoursSinceMaintenance)} h de uso (intervalo ${p.maintenanceIntervalHours} h).`,
        refType: 'printer',
        refId: p.id,
      })
    }
  }

  for (const t of s.tasks) {
    if (t.status === 'scheduled' && Date.parse(t.scheduledEnd) < s.nowMs) {
      add({
        key: `maintenance_overdue:${t.id}`,
        kind: 'maintenance_overdue',
        severity: 'danger',
        title: 'Mantenimiento vencido',
        detail: `"${t.title}" no se realizó en el horario programado.`,
        refType: 'maintenance',
        refId: t.id,
        since: t.scheduledEnd,
      })
    }
  }

  const nowIso = new Date(s.nowMs).toISOString()
  for (const r of s.reservations) {
    if (r.status === 'affected' && r.endsAt > nowIso && Date.parse(r.startsAt) < s.nowMs + 7 * DAY) {
      add({
        key: `reservation_affected:${r.id}`,
        kind: 'reservation_affected',
        severity: 'warning',
        title: 'Reserva afectada por mantenimiento',
        detail: `Una reserva del ${r.startsAt.slice(0, 10)} choca con un mantenimiento.`,
        refType: 'reservation',
        refId: r.id,
        since: r.startsAt,
      })
    }
  }

  return alerts.sort(
    (a, b) =>
      Number(a.acked) - Number(b.acked) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.title.localeCompare(b.title, 'es'),
  )
}

export async function loadAlertSnapshot(): Promise<AlertSnapshot> {
  const [items, requests, printers, tasks, reservations, acks] = await Promise.all([
    db.items.toArray(),
    db.requests.toArray(),
    db.printers.toArray(),
    db.maintenance.toArray(),
    db.reservations.toArray(),
    db.alertAcks.toArray(),
  ])
  return { items, requests, printers, tasks, reservations, acks, nowMs: clock.nowMs() }
}

export async function loadAlerts(): Promise<Alert[]> {
  return computeAlerts(await loadAlertSnapshot())
}

/** Un administrador marca la alerta como vista (sigue visible, pero deja de contar como pendiente). */
export async function acknowledgeAlert(actor: Actor | null, key: string): Promise<void> {
  assertCan(actor, 'alerts:manage')
  await db.alertAcks.put({ key, ackedAt: clock.iso(), ackedBy: actor.id })
}

/** Borra los reconocimientos de alertas que ya no existen, para que reaparezcan si el problema vuelve. */
export async function pruneAlertAcks(): Promise<number> {
  const snapshot = await loadAlertSnapshot()
  const active = new Set(computeAlerts({ ...snapshot, acks: [] }).map((a) => a.key))
  const stale = snapshot.acks.filter((a) => !active.has(a.key)).map((a) => a.key)
  if (stale.length) await db.alertAcks.bulkDelete(stale)
  return stale.length
}
