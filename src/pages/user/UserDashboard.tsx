import { useLiveQuery } from 'dexie-react-hooks'
import { Boxes, CalendarClock, ClipboardList, PackageOpen, Printer } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { useRequiredActor } from '@/shared/hooks/hooks'
import { useSnapshot } from '@/modules/analytics/hooks'
import { userSummary } from '@/modules/analytics/metrics'
import { listNotifications } from '@/modules/notifications/service'
import { PrinterCard } from '@/modules/printers/components/PrinterCard'
import { RequestLines } from '@/modules/requests/components/RequestLines'
import { fmtAgo, fmtDateTime, fmtDay } from '@/shared/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader } from '@/shared/ui/Card'
import { EmptyState, Kpi, PageHeader, Spinner } from '@/shared/ui/Misc'
import { ReservationStatusBadge, RequestStatusBadge, SEVERITY_TONE } from '@/shared/ui/StatusBadges'
import { OCCUPYING_STATUSES } from '@/modules/printers/types'

export default function UserDashboard() {
  const actor = useRequiredActor()
  const navigate = useNavigate()
  const snap = useSnapshot()
  const notifications = useLiveQuery(() => listNotifications(actor.id, 4), [actor.id])
  if (!snap) return <Spinner />

  const summary = userSummary(snap, actor.id)
  const items = new Map(snap.items.map((i) => [i.id, i]))
  const printers = snap.printers.filter((p) => p.active)
  const nowIso = new Date(snap.nowMs).toISOString()
  const myRequests = snap.requests.filter((r) => r.requesterId === actor.id).slice(0, 4)
  const myReservations = snap.reservations
    .filter((r) => r.userId === actor.id && OCCUPYING_STATUSES.includes(r.status) && r.endsAt > nowIso)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 4)
  const jobByPrinter = new Map(snap.jobs.filter((j) => j.status === 'printing').map((j) => [j.printerId, j]))
  const printerName = new Map(printers.map((p) => [p.id, p.name]))

  return (
    <>
      <PageHeader
        title={`Hola, ${actor.name.split(' ')[0]}`}
        subtitle="Esto es lo que está pasando con tus solicitudes y reservas en la Sala STEAM."
        actions={
          <>
            <Button onClick={() => navigate('/user/impresoras')} icon={<Printer className="size-4" />}>
              Reservar impresora
            </Button>
            <Button variant="primary" onClick={() => navigate('/user/catalogo')} icon={<Boxes className="size-4" />}>
              Nueva solicitud
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={ClipboardList} label="Solicitudes abiertas" value={summary.openRequests} hint={summary.pendingRequests ? `${summary.pendingRequests} esperando respuesta` : 'Ninguna esperando respuesta'} onClick={() => navigate('/user/solicitudes')} />
        <Kpi icon={CalendarClock} tone="info" label="Reservas próximas" value={summary.upcomingReservations} onClick={() => navigate('/user/impresoras')} />
        <Kpi icon={Printer} tone="ok" label="Impresiones en curso" value={summary.runningJobs} onClick={() => navigate('/user/impresoras')} />
        <Kpi icon={PackageOpen} tone={summary.itemsOnLoan ? 'warn' : 'brand'} label="Piezas en préstamo" value={summary.itemsOnLoan} hint="Herramientas y equipos por devolver" onClick={() => navigate('/user/solicitudes')} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Mis solicitudes recientes" actions={<Link to="/user/solicitudes" className="text-sm font-medium text-brand hover:underline">Ver todas</Link>} />
            {myRequests.length === 0 ? (
              <EmptyState icon={ClipboardList} title="Aún no has pedido material" text="Explora el catálogo y arma tu primera solicitud." action={<Button variant="primary" onClick={() => navigate('/user/catalogo')}>Ir al catálogo</Button>} />
            ) : (
              <ul className="divide-y divide-line">
                {myRequests.map((r) => (
                  <li key={r.id} className="space-y-2 px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{r.purpose}</p>
                      <RequestStatusBadge status={r.status} />
                    </div>
                    <RequestLines lines={snap.lines.filter((l) => l.requestId === r.id)} items={items} />
                    <p className="text-xs text-muted">
                      Creada {fmtAgo(r.createdAt)}
                      {r.status === 'delivered' && ` · devuélvelo antes del ${fmtDay(r.returnBy)}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Mis próximas reservas" actions={<Link to="/user/impresoras" className="text-sm font-medium text-brand hover:underline">Agenda de impresoras</Link>} />
            {myReservations.length === 0 ? (
              <EmptyState icon={CalendarClock} title="No tienes reservas próximas" text="Reserva una franja para imprimir tus piezas." />
            ) : (
              <ul className="divide-y divide-line">
                {myReservations.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
                    <div>
                      <p className="font-medium">{printerName.get(r.printerId) ?? 'Impresora'}</p>
                      <p className="text-sm text-muted">
                        {fmtDateTime(r.startsAt)} → {fmtDateTime(r.endsAt)} · {r.purpose}
                      </p>
                    </div>
                    <ReservationStatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="mb-3 text-[17px] font-semibold">Impresoras ahora</h2>
            <div className="space-y-3">
              {printers.map((p) => (
                <PrinterCard key={p.id} printer={p} job={jobByPrinter.get(p.id)} ownerName={jobByPrinter.get(p.id)?.userId === actor.id ? 'Es tuya' : undefined} nowMs={snap.nowMs} compact />
              ))}
            </div>
          </div>

          <Card>
            <CardHeader title="Avisos recientes" actions={<Link to="/user/notificaciones" className="text-sm font-medium text-brand hover:underline">Ver todos</Link>} />
            {!notifications?.length ? (
              <p className="px-5 py-6 text-sm text-muted">Todo tranquilo por ahora.</p>
            ) : (
              <ul className="divide-y divide-line">
                {notifications.map((n) => (
                  <li key={n.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{n.title}</p>
                      <Badge tone={SEVERITY_TONE[n.severity]}>{n.readAt ? 'Leído' : 'Nuevo'}</Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-ink-2">{n.body}</p>
                    <p className="mt-1 text-xs text-muted">{fmtAgo(n.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
