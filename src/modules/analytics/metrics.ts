import { DAY, HOUR } from '@/core/dates'
import { availableOf } from '../inventory/service'
import type { Category, InventoryItem, ItemKind, StockMovement } from '../inventory/types'
import { ACTIVE_MAINTENANCE_STATUSES, MAINTENANCE_TYPE_LABEL, type MaintenanceTask } from '../maintenance/types'
import { PRINTER_STATUS_LABEL, type PrintJob, type Printer, type PrinterStatus, type Reservation } from '../printers/types'
import { REQUEST_STATUS_LABEL, type RequestLine, type RequestStatus, type SupplyRequest } from '../requests/types'

/** Foto de los datos que necesitan las métricas. Todas las funciones de este archivo son puras. */
export interface Snapshot {
  categories: Category[]
  items: InventoryItem[]
  movements: StockMovement[]
  requests: SupplyRequest[]
  lines: RequestLine[]
  printers: Printer[]
  reservations: Reservation[]
  jobs: PrintJob[]
  tasks: MaintenanceTask[]
  nowMs: number
}

/* -------------------------------------------------------------------------- */
/*  KPIs                                                                       */
/* -------------------------------------------------------------------------- */

export interface AdminKpis {
  lowStock: number
  outOfStock: number
  pendingRequests: number
  awaitingDelivery: number
  overdueReturns: number
  printersTotal: number
  printersPrinting: number
  printersAvailable: number
  printersDown: number
  maintenanceOpen: number
  reservationsToday: number
  jobsToday: number
}

export function adminKpis(s: Snapshot): AdminKpis {
  const today = new Date(s.nowMs).toISOString().slice(0, 10)
  const active = s.items.filter((i) => i.active)
  const printers = s.printers.filter((p) => p.active)
  const count = (status: PrinterStatus) => printers.filter((p) => p.status === status).length
  return {
    outOfStock: active.filter((i) => availableOf(i) <= 0).length,
    lowStock: active.filter((i) => availableOf(i) > 0 && availableOf(i) <= i.minStock).length,
    pendingRequests: s.requests.filter((r) => r.status === 'pending').length,
    awaitingDelivery: s.requests.filter((r) => r.status === 'approved').length,
    overdueReturns: s.requests.filter((r) => r.status === 'delivered' && r.returnBy < today).length,
    printersTotal: printers.length,
    printersPrinting: count('printing'),
    printersAvailable: count('idle'),
    printersDown: count('error') + count('maintenance') + count('offline'),
    maintenanceOpen: s.tasks.filter((t) => ACTIVE_MAINTENANCE_STATUSES.includes(t.status)).length,
    reservationsToday: s.reservations.filter(
      (r) => (r.status === 'confirmed' || r.status === 'in_progress') && r.startsAt.slice(0, 10) === today,
    ).length,
    jobsToday: s.jobs.filter((j) => j.startedAt.slice(0, 10) === today).length,
  }
}

export interface UserSummary {
  openRequests: number
  pendingRequests: number
  upcomingReservations: number
  runningJobs: number
  itemsOnLoan: number
}

export function userSummary(s: Snapshot, userId: string): UserSummary {
  const nowIso = new Date(s.nowMs).toISOString()
  const mine = s.requests.filter((r) => r.requesterId === userId)
  const myIds = new Set(mine.filter((r) => r.status === 'delivered').map((r) => r.id))
  return {
    openRequests: mine.filter((r) => ['pending', 'approved', 'delivered'].includes(r.status)).length,
    pendingRequests: mine.filter((r) => r.status === 'pending').length,
    upcomingReservations: s.reservations.filter(
      (r) => r.userId === userId && (r.status === 'confirmed' || r.status === 'affected') && r.endsAt > nowIso,
    ).length,
    runningJobs: s.jobs.filter((j) => j.userId === userId && j.status === 'printing').length,
    itemsOnLoan: s.lines
      .filter((l) => l.returnable && myIds.has(l.requestId))
      .reduce((sum, l) => sum + (l.qtyDelivered - l.qtyReturned), 0),
  }
}

/* -------------------------------------------------------------------------- */
/*  Series para gráficas                                                       */
/* -------------------------------------------------------------------------- */

const dayLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`

function lastDays(nowMs: number, days: number): string[] {
  return Array.from({ length: days }, (_, i) => new Date(nowMs - (days - 1 - i) * DAY).toISOString().slice(0, 10))
}

const CONSUMPTION_TYPES = new Set(['issue', 'out'])

/** Unidades consumidas por día (salidas y entregas), filtrando por tipo de artículo. */
export function consumptionByDay(
  s: Snapshot,
  opts: { days: number; kinds: readonly ItemKind[] },
): { day: string; label: string; value: number }[] {
  const kindOf = new Map(s.items.map((i) => [i.id, i.kind]))
  const totals = new Map<string, number>()
  for (const m of s.movements) {
    if (!CONSUMPTION_TYPES.has(m.type)) continue
    const kind = kindOf.get(m.itemId)
    if (!kind || !opts.kinds.includes(kind)) continue
    const day = m.at.slice(0, 10)
    totals.set(day, (totals.get(day) ?? 0) + m.qty)
  }
  return lastDays(s.nowMs, opts.days).map((day) => ({ day, label: dayLabel(day), value: totals.get(day) ?? 0 }))
}

/** Artículos por categoría, separando los que tienen stock suficiente de los que están bajos. */
export function stockByCategory(s: Snapshot): { category: string; ok: number; low: number }[] {
  const rows = s.categories.map((c) => {
    const items = s.items.filter((i) => i.active && i.categoryId === c.id)
    const low = items.filter((i) => availableOf(i) <= i.minStock).length
    return { category: c.name, ok: items.length - low, low }
  })
  return rows.filter((r) => r.ok + r.low > 0).sort((a, b) => b.ok + b.low - (a.ok + a.low))
}

/** Horas de impresión por equipo en los últimos `days` días. */
export function printerUtilization(s: Snapshot, days: number): { name: string; hours: number }[] {
  const from = s.nowMs - days * DAY
  return s.printers
    .filter((p) => p.active)
    .map((p) => {
      let ms = 0
      for (const j of s.jobs) {
        if (j.printerId !== p.id) continue
        const start = Math.max(Date.parse(j.startedAt), from)
        const end = j.finishedAt
          ? Date.parse(j.finishedAt)
          : Math.min(s.nowMs, Date.parse(j.startedAt) + j.estimatedMinutes * 60_000)
        if (end > start) ms += end - start
      }
      return { name: p.name, hours: Math.round((ms / HOUR) * 10) / 10 }
    })
}

export function printerStatusCounts(s: Snapshot): { status: PrinterStatus; label: string; count: number }[] {
  const printers = s.printers.filter((p) => p.active)
  return (Object.keys(PRINTER_STATUS_LABEL) as PrinterStatus[])
    .map((status) => ({ status, label: PRINTER_STATUS_LABEL[status], count: printers.filter((p) => p.status === status).length }))
    .filter((r) => r.count > 0)
}

export function requestFunnel(s: Snapshot): { status: RequestStatus; label: string; count: number }[] {
  const order: RequestStatus[] = ['pending', 'approved', 'delivered', 'closed', 'rejected', 'cancelled']
  return order.map((status) => ({
    status,
    label: REQUEST_STATUS_LABEL[status],
    count: s.requests.filter((r) => r.status === status).length,
  }))
}

export function maintenanceCosts(s: Snapshot): { type: string; parts: number; labor: number; count: number }[] {
  return (['preventive', 'corrective'] as const).map((type) => {
    const done = s.tasks.filter((t) => t.type === type && t.status === 'done')
    return {
      type: MAINTENANCE_TYPE_LABEL[type],
      parts: Math.round(done.reduce((sum, t) => sum + t.partsCost, 0) * 100) / 100,
      labor: Math.round(done.reduce((sum, t) => sum + t.laborCost, 0) * 100) / 100,
      count: done.length,
    }
  })
}

/** Los artículos más consumidos en el periodo (excluye filamento, que se mide aparte). */
export function topConsumed(s: Snapshot, opts: { days: number; limit: number }): { name: string; qty: number; unit: string }[] {
  const from = new Date(s.nowMs - opts.days * DAY).toISOString()
  const byItem = new Map<string, number>()
  for (const m of s.movements) {
    if (!CONSUMPTION_TYPES.has(m.type) || m.at < from) continue
    byItem.set(m.itemId, (byItem.get(m.itemId) ?? 0) + m.qty)
  }
  return s.items
    .filter((i) => i.kind !== 'filament' && byItem.has(i.id))
    .map((i) => ({ name: i.name, qty: byItem.get(i.id)!, unit: i.unit }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, opts.limit)
}

export function filamentUsedGrams(s: Snapshot, days: number): number {
  const from = new Date(s.nowMs - days * DAY).toISOString()
  const filament = new Set(s.items.filter((i) => i.kind === 'filament').map((i) => i.id))
  return s.movements
    .filter((m) => m.type === 'issue' && m.at >= from && filament.has(m.itemId))
    .reduce((sum, m) => sum + m.qty, 0)
}
