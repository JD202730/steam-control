import { useLiveQuery } from 'dexie-react-hooks'
import { BellOff, Check, ChevronRight, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router'
import { acknowledgeAlert, loadAlerts } from '@/modules/notifications/alerts'
import type { Alert } from '@/modules/notifications/types'
import { useAction, useNow, useRequiredActor } from '@/shared/hooks/hooks'
import { fmtAgo } from '@/shared/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader } from '@/shared/ui/Card'
import { EmptyState, PageHeader, Spinner } from '@/shared/ui/Misc'
import { SEVERITY_LABEL, SEVERITY_TONE } from '@/shared/ui/StatusBadges'

const TARGET: Record<Alert['refType'], { to: string; label: string }> = {
  item: { to: '/admin/inventario', label: 'Ver inventario' },
  request: { to: '/admin/solicitudes', label: 'Ver solicitudes' },
  printer: { to: '/admin/impresoras', label: 'Ver impresoras' },
  maintenance: { to: '/admin/mantenimiento', label: 'Ver mantenimiento' },
  reservation: { to: '/admin/impresoras', label: 'Ver reservas' },
}

export default function AlertsPage() {
  const actor = useRequiredActor()
  const navigate = useNavigate()
  const minute = Math.floor(useNow(30_000) / 60_000)
  const alerts = useLiveQuery(loadAlerts, [minute])
  const { run } = useAction()

  if (!alerts) return <Spinner />
  const active = alerts.filter((a) => !a.acked)
  const acked = alerts.filter((a) => a.acked)

  const row = (a: Alert) => (
    <li key={a.key} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={SEVERITY_TONE[a.severity]}>{SEVERITY_LABEL[a.severity]}</Badge>
          <p className="font-medium">{a.title}</p>
        </div>
        <p className="mt-1 text-sm text-ink-2">{a.detail}</p>
        {a.since && <p className="mt-0.5 text-xs text-muted">Desde {fmtAgo(a.since)}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => navigate(TARGET[a.refType].to)} icon={<ChevronRight className="size-3.5" />}>
          {TARGET[a.refType].label}
        </Button>
        {!a.acked && (
          <Button size="sm" onClick={() => run(() => acknowledgeAlert(actor, a.key), 'Alerta marcada como vista.')} icon={<Check className="size-3.5" />}>
            Ya la vi
          </Button>
        )}
      </div>
    </li>
  )

  return (
    <>
      <PageHeader title="Alertas" subtitle="Se calculan a partir del estado real de la sala: si el problema se resuelve, la alerta desaparece sola." />
      <div className="space-y-6">
        <Card>
          <CardHeader title={`Por atender (${active.length})`} />
          {active.length === 0 ? <EmptyState icon={ShieldCheck} title="Todo en orden" text="No hay alertas pendientes en este momento." /> : <ul className="divide-y divide-line">{active.map(row)}</ul>}
        </Card>
        {acked.length > 0 && (
          <Card>
            <CardHeader title={`Ya vistas (${acked.length})`} subtitle="Siguen activas, pero ya las revisaste." />
            <ul className="divide-y divide-line">{acked.map(row)}</ul>
          </Card>
        )}
        {active.length === 0 && acked.length === 0 && <EmptyState icon={BellOff} title="Sin alertas" />}
      </div>
    </>
  )
}
