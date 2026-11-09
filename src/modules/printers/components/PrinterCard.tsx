import clsx from 'clsx'
import { Gauge, Timer, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { MINUTE } from '@/core/dates'
import { fmtDuration, fmtNumber } from '@/shared/format'
import { Card } from '@/shared/ui/Card'
import { ProgressBar } from '@/shared/ui/Misc'
import { PrinterStatusBadge } from '@/shared/ui/StatusBadges'
import type { PrintJob, Printer } from '../types'

/** Tarjeta de una impresora: estado, trabajo en curso con su avance y desgaste hasta el próximo mantenimiento. */
export function PrinterCard({
  printer,
  job,
  ownerName,
  nowMs,
  actions,
  compact,
}: {
  printer: Printer
  job?: PrintJob
  ownerName?: string
  nowMs: number
  actions?: ReactNode
  compact?: boolean
}) {
  const wear = printer.maintenanceIntervalHours ? (printer.hoursSinceMaintenance / printer.maintenanceIntervalHours) * 100 : 0
  const remaining = job ? Math.max(0, (Date.parse(job.startedAt) + job.estimatedMinutes * MINUTE - nowMs) / MINUTE) : 0
  const livePct = job ? Math.min(100, Math.max(0, ((nowMs - Date.parse(job.startedAt)) / (job.estimatedMinutes * MINUTE)) * 100)) : 0

  return (
    <Card className={clsx('flex flex-col', printer.status === 'error' && 'border-bad/50')}>
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="min-w-0">
          <h3 className="truncate text-[17px] font-semibold leading-tight">{printer.name}</h3>
          <p className="truncate text-xs text-muted">
            {printer.model} · {printer.location || 'Sin ubicación'}
          </p>
        </div>
        <PrinterStatusBadge status={printer.status} />
      </div>

      <div className="flex-1 space-y-3 px-4 pb-4">
        {job ? (
          <div className="rounded-lg bg-surface-2 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-sm font-medium">{job.name}</p>
              <span className="num text-sm font-semibold text-brand">{Math.floor(livePct)}%</span>
            </div>
            <ProgressBar value={livePct} className="my-2" label={`Avance de ${job.name}`} />
            <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
              <span className="flex items-center gap-1">
                <Timer className="size-3.5" aria-hidden /> Quedan {fmtDuration(remaining)}
              </span>
              <span className="num">
                {fmtNumber(Math.round((job.gramsEstimated * livePct) / 100))} / {fmtNumber(job.gramsEstimated)} g
              </span>
              {ownerName && <span>{ownerName}</span>}
            </p>
          </div>
        ) : printer.status === 'error' ? (
          <p className="flex items-start gap-2 rounded-lg bg-bad-soft p-3 text-sm text-bad">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> Detenida por una falla. Espera su reparación.
          </p>
        ) : (
          !compact && <p className="rounded-lg bg-surface-2 p-3 text-sm text-muted">{printer.status === 'idle' ? 'Lista para usar.' : 'No disponible por ahora.'}</p>
        )}

        {!compact && (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-muted">
              <span className="flex items-center gap-1">
                <Gauge className="size-3.5" aria-hidden /> Uso desde el mantenimiento
              </span>
              <span className="num whitespace-nowrap">
                {fmtNumber(printer.hoursSinceMaintenance, 0)} / {printer.maintenanceIntervalHours} h
              </span>
            </div>
            <ProgressBar value={wear} tone={wear >= 100 ? 'bad' : wear >= 85 ? 'warn' : 'brand'} label="Horas de uso desde el último mantenimiento" />
          </div>
        )}
      </div>

      {actions && <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">{actions}</div>}
    </Card>
  )
}
