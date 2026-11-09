import { useLiveQuery } from 'dexie-react-hooks'
import { ClipboardList, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAllRequestLines, useById, useItems } from '@/modules/data-hooks'
import { RequestLines } from '@/modules/requests/components/RequestLines'
import { cancelRequest, isReturnOverdue, listRequests } from '@/modules/requests/service'
import type { SupplyRequest } from '@/modules/requests/types'
import { useAction, useNow, useRequiredActor } from '@/shared/hooks/hooks'
import { fmtAgo, fmtDay } from '@/shared/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { ConfirmModal } from '@/shared/ui/Modal'
import { EmptyState, PageHeader, Spinner, Tabs } from '@/shared/ui/Misc'
import { RequestStatusBadge } from '@/shared/ui/StatusBadges'

type Filter = 'all' | 'active' | 'done'

export default function MyRequestsPage() {
  const actor = useRequiredActor()
  const navigate = useNavigate()
  const requests = useLiveQuery(() => listRequests({ requesterId: actor.id }), [actor.id])
  const lines = useAllRequestLines()
  const items = useById(useItems())
  const now = useNow(30_000)
  const { run, pending } = useAction()
  const [filter, setFilter] = useState<Filter>('all')
  const [toCancel, setToCancel] = useState<SupplyRequest | null>(null)

  if (!requests || !lines) return <Spinner />
  const isActive = (r: SupplyRequest) => ['pending', 'approved', 'delivered'].includes(r.status)
  const shown = requests.filter((r) => (filter === 'all' ? true : filter === 'active' ? isActive(r) : !isActive(r)))

  return (
    <>
      <PageHeader
        title="Mis solicitudes"
        subtitle="Sigue el estado de tu material, desde que lo pides hasta que lo devuelves."
        actions={
          <Button variant="primary" onClick={() => navigate('/user/catalogo')}>
            Nueva solicitud
          </Button>
        }
      />
      <div className="mb-4">
        <Tabs
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: 'Todas', count: requests.length },
            { value: 'active', label: 'En curso', count: requests.filter(isActive).length },
            { value: 'done', label: 'Finalizadas', count: requests.filter((r) => !isActive(r)).length },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardList} title="No hay solicitudes aquí" text="Cuando hagas una, aparecerá en esta lista." />
        </Card>
      ) : (
        <div className="space-y-4">
          {shown.map((r) => {
            const rl = lines.filter((l) => l.requestId === r.id)
            const overdue = isReturnOverdue(r, now)
            return (
              <Card key={r.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{r.purpose}</h2>
                    <p className="mt-0.5 text-xs text-muted">
                      Enviada {fmtAgo(r.createdAt)} · la necesitas el {fmtDay(r.neededBy)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {overdue && <Badge tone="bad">Devolución vencida</Badge>}
                    <RequestStatusBadge status={r.status} />
                  </div>
                </div>
                <div className="mt-3">
                  <RequestLines lines={rl} items={items} showReturn={r.status === 'delivered'} />
                </div>
                {r.decisionNote && (
                  <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
                    <span className="font-medium">Nota de la coordinación:</span> {r.decisionNote}
                  </p>
                )}
                {r.status === 'delivered' && <p className="mt-3 text-sm text-ink-2">Devuelve las herramientas antes del {fmtDay(r.returnBy)}.</p>}
                {(r.status === 'pending' || r.status === 'approved') && (
                  <div className="mt-4 border-t border-line pt-3">
                    <Button size="sm" variant="danger" onClick={() => setToCancel(r)} icon={<XCircle className="size-4" />}>
                      Cancelar solicitud
                    </Button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <ConfirmModal
        open={!!toCancel}
        onClose={() => setToCancel(null)}
        title="¿Cancelar esta solicitud?"
        message={toCancel?.status === 'approved' ? 'El material que estaba reservado para ti se liberará para otras personas.' : 'La coordinación ya no la verá en su lista de pendientes.'}
        confirmLabel="Cancelar solicitud"
        danger
        loading={pending}
        onConfirm={async () => {
          if (!toCancel) return
          await run(() => cancelRequest(actor, toCancel.id), 'Solicitud cancelada.')
          setToCancel(null)
        }}
      />
    </>
  )
}
