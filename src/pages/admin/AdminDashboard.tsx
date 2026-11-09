import { useLiveQuery } from 'dexie-react-hooks'
import { Boxes, CalendarClock, Check, ClipboardList, FlaskConical, PackageCheck, Pause, Play, Printer, Siren, Undo2, Wrench } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { db } from '@/core/db/db'
import { useSnapshot } from '@/modules/analytics/hooks'
import { adminKpis, consumptionByDay, stockByCategory } from '@/modules/analytics/metrics'
import { loadAlerts } from '@/modules/notifications/alerts'
import { PrinterCard } from '@/modules/printers/components/PrinterCard'
import { approveRequest } from '@/modules/requests/service'
import { pauseSimulation, startSimulation } from '@/modules/simulation/engine'
import { RequestLines } from '@/modules/requests/components/RequestLines'
import { Columns, ChartFrame, SERIES, type SeriesDef } from '@/shared/charts/Charts'
import { useAction, useNow, useRequiredActor } from '@/shared/hooks/hooks'
import { fmtAgo } from '@/shared/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader } from '@/shared/ui/Card'
import { EmptyState, Kpi, PageHeader, Spinner } from '@/shared/ui/Misc'
import { SEVERITY_LABEL, SEVERITY_TONE } from '@/shared/ui/StatusBadges'

export default function AdminDashboard() {
  const actor = useRequiredActor()
  const navigate = useNavigate()
  const snap = useSnapshot()
  const minute = Math.floor(useNow(30_000) / 60_000)
  const alerts = useLiveQuery(loadAlerts, [minute])
  const sim = useLiveQuery(() => db.sim.get('main'), [])
  const users = useLiveQuery(() => db.users.toArray(), [])
  const { run, pending } = useAction()

  if (!snap || !alerts) return <Spinner />

  const k = adminKpis(snap)
  const items = new Map(snap.items.map((i) => [i.id, i]))
  const userName = new Map((users ?? []).map((u) => [u.id, u.name]))
  const pendingReqs = snap.requests.filter((r) => r.status === 'pending').reverse().slice(0, 4)
  const activeAlerts = alerts.filter((a) => !a.acked)
  const jobByPrinter = new Map(snap.jobs.filter((j) => j.status === 'printing').map((j) => [j.printerId, j]))
  const materials = consumptionByDay(snap, { days: 14, kinds: ['consumable', 'tool', 'equipment'] })
  const stock = stockByCategory(snap)
  const stockSeries: SeriesDef[] = [
    { key: 'ok', label: 'Stock suficiente', color: SERIES.blue },
    { key: 'low', label: 'Stock bajo o agotado', color: SERIES.orange },
  ]

  return (
    <>
      <PageHeader title="Panel de administración" subtitle="Lo que necesita tu atención hoy en la Sala STEAM." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={ClipboardList} tone={k.pendingRequests ? 'warn' : 'ok'} label="Solicitudes por revisar" value={k.pendingRequests} hint={`${k.awaitingDelivery} aprobadas por entregar`} onClick={() => navigate('/admin/solicitudes')} />
        <Kpi icon={Boxes} tone={k.outOfStock ? 'bad' : k.lowStock ? 'warn' : 'ok'} label="Artículos con stock bajo" value={k.lowStock + k.outOfStock} hint={k.outOfStock ? `${k.outOfStock} agotados` : 'Ninguno agotado'} onClick={() => navigate('/admin/inventario')} />
        <Kpi icon={Printer} tone={k.printersDown ? 'warn' : 'ok'} label="Impresoras operativas" value={`${k.printersTotal - k.printersDown}/${k.printersTotal}`} hint={`${k.printersPrinting} imprimiendo ahora`} onClick={() => navigate('/admin/impresoras')} />
        <Kpi icon={Undo2} tone={k.overdueReturns ? 'bad' : 'ok'} label="Devoluciones vencidas" value={k.overdueReturns} onClick={() => navigate('/admin/solicitudes')} />
        <Kpi icon={Wrench} tone="info" label="Mantenimientos abiertos" value={k.maintenanceOpen} onClick={() => navigate('/admin/mantenimiento')} />
        <Kpi icon={CalendarClock} tone="info" label="Reservas de hoy" value={k.reservationsToday} hint={`${k.jobsToday} impresiones hoy`} onClick={() => navigate('/admin/impresoras')} />
        <Kpi icon={Siren} tone={activeAlerts.length ? 'bad' : 'ok'} label="Alertas activas" value={activeAlerts.length} onClick={() => navigate('/admin/alertas')} />
        <Kpi icon={PackageCheck} label="Por entregar" value={k.awaitingDelivery} hint="Material ya reservado" onClick={() => navigate('/admin/solicitudes')} />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Solicitudes por revisar" actions={<Link to="/admin/solicitudes" className="text-sm font-medium text-brand hover:underline">Ver todas</Link>} />
            {pendingReqs.length === 0 ? (
              <EmptyState icon={ClipboardList} title="No hay solicitudes pendientes" text="Cuando alguien pida material, aparecerá aquí para aprobarlo." />
            ) : (
              <ul className="divide-y divide-line">
                {pendingReqs.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="font-medium">{r.purpose}</p>
                      <RequestLines lines={snap.lines.filter((l) => l.requestId === r.id)} items={items} />
                      <p className="text-xs text-muted">
                        {userName.get(r.requesterId)} · {fmtAgo(r.createdAt)}
                      </p>
                    </div>
                    <Button size="sm" variant="primary" loading={pending} onClick={() => run(() => approveRequest(actor, r.id), 'Solicitud aprobada: el material quedó reservado.')} icon={<Check className="size-4" />}>
                      Aprobar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold">Impresoras en vivo</h2>
              <Link to="/admin/impresoras" className="text-sm font-medium text-brand hover:underline">Administrar</Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {snap.printers
                .filter((p) => p.active)
                .map((p) => {
                  const job = jobByPrinter.get(p.id)
                  return <PrinterCard key={p.id} printer={p} job={job} ownerName={job ? userName.get(job.userId) : undefined} nowMs={snap.nowMs} compact />
                })}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Alertas" actions={<Link to="/admin/alertas" className="text-sm font-medium text-brand hover:underline">Ver todas</Link>} />
            {activeAlerts.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">Todo en orden: no hay alertas activas.</p>
            ) : (
              <ul className="divide-y divide-line">
                {activeAlerts.slice(0, 5).map((a) => (
                  <li key={a.key} className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Badge tone={SEVERITY_TONE[a.severity]}>{SEVERITY_LABEL[a.severity]}</Badge>
                      <p className="text-sm font-medium">{a.title}</p>
                    </div>
                    <p className="mt-1 text-sm text-ink-2">{a.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Simulación" subtitle={sim?.running ? `En marcha a ×${sim.speed}` : 'En pausa'} />
            <div className="flex flex-wrap gap-2 p-5">
              {sim?.running ? (
                <Button onClick={() => run(() => pauseSimulation(actor), 'Simulación en pausa.')} icon={<Pause className="size-4" />}>
                  Pausar
                </Button>
              ) : (
                <Button variant="primary" onClick={() => run(() => startSimulation(actor), 'Simulación en marcha.')} icon={<Play className="size-4" />}>
                  Iniciar
                </Button>
              )}
              <Button variant="ghost" onClick={() => navigate('/admin/simulacion')} icon={<FlaskConical className="size-4" />}>
                Configurar
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartFrame title="Materiales consumidos por día" subtitle="Últimos 14 días" table={{ columns: ['Día', 'Unidades'], rows: materials.map((d) => [d.label, d.value]) }} empty={materials.every((d) => d.value === 0)}>
          <Columns data={materials} series={[{ key: 'value', label: 'Unidades consumidas', color: SERIES.blue }]} unit="ud" />
        </ChartFrame>
        <ChartFrame
          title="Estado del stock por categoría"
          subtitle="Artículos suficientes frente a los que necesitan reposición"
          legend={stockSeries}
          table={{ columns: ['Categoría', 'Suficiente', 'Bajo o agotado'], rows: stock.map((c) => [c.category, c.ok, c.low]) }}
          empty={stock.length === 0}
        >
          <Columns data={stock} series={stockSeries} stacked categoryKey="category" unit="artículos" />
        </ChartFrame>
      </div>
    </>
  )
}
