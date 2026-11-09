import { Check, ClipboardList, PackageCheck, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import { availableOf } from '@/modules/inventory/service'
import { useAllRequestLines, useAllRequests, useById, useItems, useUsers } from '@/modules/data-hooks'
import { RequestLines } from '@/modules/requests/components/RequestLines'
import { approveRequest, cancelRequest, deliverRequest, isReturnOverdue, rejectRequest, returnLine } from '@/modules/requests/service'
import type { RequestLine, SupplyRequest } from '@/modules/requests/types'
import { useAction, useNow, useRequiredActor } from '@/shared/hooks/hooks'
import { fmtAgo, fmtDay } from '@/shared/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Field, Input, Textarea } from '@/shared/ui/Fields'
import { ConfirmModal, Modal } from '@/shared/ui/Modal'
import { EmptyState, PageHeader, Spinner, Tabs } from '@/shared/ui/Misc'
import { RequestStatusBadge } from '@/shared/ui/StatusBadges'

type Tab = 'pending' | 'approved' | 'delivered' | 'history'

function RejectModal({ request, onClose }: { request: SupplyRequest; onClose: () => void }) {
  const actor = useRequiredActor()
  const { run, pending } = useAction()
  const [note, setNote] = useState('')
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Rechazar solicitud"
      description={request.purpose}
      footer={
        <>
          <Button onClick={onClose}>Volver</Button>
          <Button
            variant="danger"
            loading={pending}
            disabled={note.trim().length < 3}
            onClick={async () => {
              if (await run(() => rejectRequest(actor, request.id, note), 'Solicitud rechazada.')) onClose()
            }}
          >
            Rechazar
          </Button>
        </>
      }
    >
      <Field label="Motivo (lo verá la persona)" hint="Explica qué puede hacer para que se apruebe.">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} autoFocus />
      </Field>
    </Modal>
  )
}

function ReturnModal({ request, lines, itemName, onClose }: { request: SupplyRequest; lines: RequestLine[]; itemName: (id: string) => string; onClose: () => void }) {
  const actor = useRequiredActor()
  const { run, pending } = useAction()
  const open = lines.filter((l) => l.returnable && l.qtyDelivered - l.qtyReturned > 0)
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(open.map((l) => [l.id, String(l.qtyDelivered - l.qtyReturned)])))

  const submit = async () => {
    const done = await run(async () => {
      for (const l of open) {
        const n = Number(qty[l.id] || 0)
        if (n > 0) await returnLine(actor, request.id, l.id, n)
      }
      return true
    }, 'Devolución registrada.')
    if (done) onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Registrar devolución"
      description={`${request.purpose} · límite ${fmtDay(request.returnBy)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            Registrar
          </Button>
        </>
      }
    >
      <ul className="space-y-3">
        {open.map((l) => {
          const pendingQty = l.qtyDelivered - l.qtyReturned
          return (
            <li key={l.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{itemName(l.itemId)}</p>
                <p className="text-xs text-muted">Faltan {pendingQty} por devolver</p>
              </div>
              <Input type="number" className="w-24" min={0} max={pendingQty} value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} aria-label={`Cantidad devuelta de ${itemName(l.itemId)}`} />
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}

export default function AdminRequestsPage() {
  const actor = useRequiredActor()
  const requests = useAllRequests()
  const lines = useAllRequestLines()
  const items = useItems()
  const users = useUsers()
  const itemById = useById(items)
  const userById = useById(users)
  const now = useNow(30_000)
  const { run, pending } = useAction()
  const [tab, setTab] = useState<Tab>('pending')
  const [reject, setReject] = useState<SupplyRequest | null>(null)
  const [returning, setReturning] = useState<SupplyRequest | null>(null)
  const [cancelling, setCancelling] = useState<SupplyRequest | null>(null)

  if (!requests || !lines || !items || !users) return <Spinner />

  const byTab: Record<Tab, SupplyRequest[]> = {
    pending: requests.filter((r) => r.status === 'pending').reverse(),
    approved: requests.filter((r) => r.status === 'approved'),
    delivered: requests.filter((r) => r.status === 'delivered'),
    history: requests.filter((r) => ['closed', 'rejected', 'cancelled'].includes(r.status)),
  }
  const shown = byTab[tab]

  return (
    <>
      <PageHeader title="Solicitudes" subtitle="Aprueba (esto reserva el stock), entrega el material y registra las devoluciones." />
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'pending', label: 'Por revisar', count: byTab.pending.length },
            { value: 'approved', label: 'Por entregar', count: byTab.approved.length },
            { value: 'delivered', label: 'Por devolver', count: byTab.delivered.length },
            { value: 'history', label: 'Historial', count: byTab.history.length },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardList} title="No hay solicitudes en esta lista" text="Cuando alguien envíe una, aparecerá aquí." />
        </Card>
      ) : (
        <div className="space-y-4">
          {shown.map((r) => {
            const rl = lines.filter((l) => l.requestId === r.id)
            const requester = userById.get(r.requesterId)
            const short = r.status === 'pending' ? rl.filter((l) => { const it = itemById.get(l.itemId); return it && l.qty > availableOf(it) }) : []
            return (
              <Card key={r.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{r.purpose}</h2>
                    <p className="mt-0.5 text-sm text-ink-2">
                      {requester?.name ?? 'Usuario'} <span className="text-muted">· {requester?.area}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      Enviada {fmtAgo(r.createdAt)} · la necesita el {fmtDay(r.neededBy)}
                      {rl.some((l) => l.returnable) && ` · devolución hasta el ${fmtDay(r.returnBy)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isReturnOverdue(r, now) && <Badge tone="bad">Devolución vencida</Badge>}
                    <RequestStatusBadge status={r.status} />
                  </div>
                </div>

                <div className="mt-3">
                  <RequestLines lines={rl} items={itemById} showReturn={r.status === 'delivered'} />
                </div>
                {short.length > 0 && (
                  <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                    No hay stock disponible para aprobar completa: {short.map((l) => `${itemById.get(l.itemId)?.name} (disponible ${availableOf(itemById.get(l.itemId)!)}, pide ${l.qty})`).join('; ')}.
                  </p>
                )}
                {r.decisionNote && <p className="mt-3 text-sm text-ink-2"><span className="font-medium">Nota:</span> {r.decisionNote}</p>}

                {(r.status === 'pending' || r.status === 'approved' || r.status === 'delivered') && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                    {r.status === 'pending' && (
                      <>
                        <Button size="sm" variant="primary" loading={pending} onClick={() => run(() => approveRequest(actor, r.id), 'Solicitud aprobada: el material quedó reservado.')} icon={<Check className="size-4" />}>
                          Aprobar y reservar
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setReject(r)} icon={<X className="size-4" />}>
                          Rechazar
                        </Button>
                      </>
                    )}
                    {r.status === 'approved' && (
                      <>
                        <Button size="sm" variant="primary" loading={pending} onClick={() => run(() => deliverRequest(actor, r.id), 'Material entregado.')} icon={<PackageCheck className="size-4" />}>
                          Entregar material
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(r)}>
                          Cancelar y liberar stock
                        </Button>
                      </>
                    )}
                    {r.status === 'delivered' && (
                      <Button size="sm" variant="primary" onClick={() => setReturning(r)} icon={<Undo2 className="size-4" />}>
                        Registrar devolución
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {reject && <RejectModal key={reject.id} request={reject} onClose={() => setReject(null)} />}
      {returning && <ReturnModal key={returning.id} request={returning} lines={lines.filter((l) => l.requestId === returning.id)} itemName={(id) => itemById.get(id)?.name ?? 'Artículo'} onClose={() => setReturning(null)} />}
      <ConfirmModal
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        title="¿Cancelar esta solicitud aprobada?"
        message="El material reservado volverá a estar disponible y se avisará a la persona."
        confirmLabel="Cancelar solicitud"
        danger
        loading={pending}
        onConfirm={async () => {
          if (!cancelling) return
          await run(() => cancelRequest(actor, cancelling.id), 'Solicitud cancelada y stock liberado.')
          setCancelling(null)
        }}
      />
    </>
  )
}
