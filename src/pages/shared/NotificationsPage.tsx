import { useLiveQuery } from 'dexie-react-hooks'
import { Bell, CheckCheck, CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { listNotifications, markAllRead, markRead } from '@/modules/notifications/service'
import type { Notification, Severity } from '@/modules/notifications/types'
import { useAction, useRequiredActor } from '@/shared/hooks/hooks'
import { fmtAgo } from '@/shared/format'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { EmptyState, PageHeader, Spinner, Tabs } from '@/shared/ui/Misc'

const ICON = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert } as const
const TONE: Record<Severity, string> = { info: 'bg-info-soft text-info', success: 'bg-ok-soft text-ok', warning: 'bg-warn-soft text-warn', danger: 'bg-bad-soft text-bad' }

/** Página de destino según lo que originó el aviso. */
function targetOf(n: Notification, isAdmin: boolean): string | null {
  const base = isAdmin ? '/admin' : '/user'
  switch (n.refType) {
    case 'request':
      return `${base}/solicitudes`
    case 'item':
      return isAdmin ? '/admin/inventario' : '/user/catalogo'
    case 'printer':
    case 'job':
    case 'reservation':
      return `${base}/impresoras`
    case 'maintenance':
      return isAdmin ? '/admin/mantenimiento' : null
    default:
      return null
  }
}

export default function NotificationsPage() {
  const actor = useRequiredActor()
  const navigate = useNavigate()
  const notifications = useLiveQuery(() => listNotifications(actor.id), [actor.id])
  const { run } = useAction()
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  if (!notifications) return <Spinner />
  const unread = notifications.filter((n) => !n.readAt).length
  const shown = filter === 'unread' ? notifications.filter((n) => !n.readAt) : notifications

  const open = async (n: Notification) => {
    if (!n.readAt) await run(() => markRead(actor, n.id))
    const target = targetOf(n, actor.role === 'admin')
    if (target) navigate(target)
  }

  return (
    <>
      <PageHeader
        title="Notificaciones"
        subtitle="Avisos sobre tus solicitudes, reservas e impresiones."
        actions={
          <Button onClick={() => run(() => markAllRead(actor), 'Todo marcado como leído.')} disabled={!unread} icon={<CheckCheck className="size-4" />}>
            Marcar todo como leído
          </Button>
        }
      />
      <div className="mb-4">
        <Tabs
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: 'Todas', count: notifications.length },
            { value: 'unread', label: 'Sin leer', count: unread },
          ]}
        />
      </div>
      <Card>
        {shown.length === 0 ? (
          <EmptyState icon={Bell} title={filter === 'unread' ? 'No tienes avisos sin leer' : 'Aún no tienes notificaciones'} text="Aquí aparecerán los cambios que te afecten." />
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((n) => {
              const Icon = ICON[n.severity]
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => open(n)} className="flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-2">
                    <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${TONE[n.severity]}`}>
                      <Icon className="size-[18px]" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={n.readAt ? 'font-medium text-ink-2' : 'font-semibold'}>{n.title}</span>
                        {!n.readAt && <span className="size-2 rounded-full bg-brand" aria-label="Sin leer" />}
                      </span>
                      <span className="mt-0.5 block text-sm text-ink-2">{n.body}</span>
                      <span className="mt-1 block text-xs text-muted">{fmtAgo(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}
