import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarPlus, Check, CirclePlay, Gauge, Hammer, Wrench, X } from 'lucide-react'
import { useState } from 'react'
import { clock } from '@/core/clock/clock'
import { availableOf } from '@/modules/inventory/service'
import { addPart, cancelMaintenance, completeMaintenance, isTaskOverdue, listParts, scheduleMaintenance, startMaintenance } from '@/modules/maintenance/service'
import type { MaintenanceTask, MaintenanceType } from '@/modules/maintenance/types'
import { ACTIVE_MAINTENANCE_STATUSES } from '@/modules/maintenance/types'
import { useById, useItems, usePrinters, useTasks } from '@/modules/data-hooks'
import { useAction, useNow, useRequiredActor } from '@/shared/hooks/hooks'
import { fmtDateTime, fmtMoney, fmtNumber, fromLocalInput, toLocalInput } from '@/shared/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader } from '@/shared/ui/Card'
import { Field, Input, Select, Textarea, toNumber } from '@/shared/ui/Fields'
import { Modal } from '@/shared/ui/Modal'
import { EmptyState, Kpi, PageHeader, ProgressBar, Spinner, Tabs, tableCls } from '@/shared/ui/Misc'
import { MaintenanceStatusBadge, MaintenanceTypeBadge } from '@/shared/ui/StatusBadges'

function ScheduleModal({ onClose }: { onClose: () => void }) {
  const actor = useRequiredActor()
  const printers = usePrinters() ?? []
  const { run, pending } = useAction()
  const [base] = useState(() => Math.ceil(clock.nowMs() / 3_600_000) * 3_600_000)
  const [printerId, setPrinterId] = useState(printers[0]?.id ?? '')
  const [type, setType] = useState<MaintenanceType>('preventive')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [start, setStart] = useState(toLocalInput(base + 3_600_000))
  const [end, setEnd] = useState(toLocalInput(base + 3 * 3_600_000))
  return (
    <Modal
      open
      onClose={onClose}
      title="Programar mantenimiento"
      description="Las reservas que choquen con este horario se marcarán como afectadas y se avisará a sus dueños."
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!printerId || title.trim().length < 3 || !start || !end}
            onClick={async () => {
              const done = await run(
                () => scheduleMaintenance(actor, { printerId, type, title, description, scheduledStart: fromLocalInput(start), scheduledEnd: fromLocalInput(end) }),
                'Mantenimiento programado.',
              )
              if (done) onClose()
            }}
          >
            Programar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Impresora">
          <Select value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tipo">
          <Select value={type} onChange={(e) => setType(e.target.value as MaintenanceType)}>
            <option value="preventive">Preventivo</option>
            <option value="corrective">Correctivo</option>
          </Select>
        </Field>
        <Field label="Título" className="sm:col-span-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="Ej.: lubricación de ejes" />
        </Field>
        <Field label="Inicio">
          <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Fin">
          <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="Detalle (opcional)" className="sm:col-span-2">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} />
        </Field>
      </div>
    </Modal>
  )
}

function PartsModal({ task, onClose }: { task: MaintenanceTask; onClose: () => void }) {
  const actor = useRequiredActor()
  const items = useItems() ?? []
  const itemById = useById(items)
  const parts = useLiveQuery(() => listParts(task.id), [task.id])
  const live = useLiveQuery(() => listTaskCost(task.id), [task.id])
  const { run, pending } = useAction()
  const candidates = items.filter((i) => i.active && i.kind !== 'filament' && availableOf(i) > 0)
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState('1')
  const selected = candidates.find((i) => i.id === (itemId || candidates.find((c) => c.sku.startsWith('3D-'))?.id || candidates[0]?.id))
  return (
    <Modal open onClose={onClose} title="Repuestos usados" description={`${task.title} · el stock se descuenta del inventario.`} footer={<Button onClick={onClose}>Listo</Button>}>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Repuesto" className="min-w-56 flex-1" hint={selected ? `Disponible: ${fmtNumber(availableOf(selected))} ${selected.unit}` : undefined}>
          <Select value={selected?.id ?? ''} onChange={(e) => setItemId(e.target.value)}>
            {candidates.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cantidad" className="w-24">
          <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Button variant="primary" loading={pending} disabled={!selected} onClick={() => selected && run(() => addPart(actor, task.id, selected.id, toNumber(qty)), 'Repuesto registrado.')}>
          Agregar
        </Button>
      </div>
      {!parts?.length ? (
        <p className="text-sm text-muted">Todavía no se han usado repuestos.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {parts.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>
                {itemById.get(p.itemId)?.name ?? 'Repuesto'} <span className="num text-muted">×{p.qty}</span>
              </span>
              <span className="num">{fmtMoney(p.qty * p.unitCost)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-right text-sm text-ink-2">
        Costo de repuestos: <span className="num font-semibold">{fmtMoney(live ?? task.partsCost)}</span>
      </p>
    </Modal>
  )
}

async function listTaskCost(taskId: string): Promise<number> {
  const parts = await listParts(taskId)
  return parts.reduce((sum, p) => sum + p.qty * p.unitCost, 0)
}

function CompleteModal({ task, onClose }: { task: MaintenanceTask; onClose: () => void }) {
  const actor = useRequiredActor()
  const { run, pending } = useAction()
  const [labor, setLabor] = useState('0')
  const [notes, setNotes] = useState('')
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Completar mantenimiento"
      description="La impresora volverá a estar disponible y su contador de horas se reiniciará."
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            loading={pending}
            onClick={async () => {
              if (await run(() => completeMaintenance(actor, task.id, { laborCost: toNumber(labor), notes: notes || undefined }), 'Mantenimiento completado.')) onClose()
            }}
          >
            Completar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Costo de mano de obra">
          <Input type="number" min={0} step="0.01" value={labor} onChange={(e) => setLabor(e.target.value)} />
        </Field>
        <Field label="Notas (opcional)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={400} />
        </Field>
      </div>
    </Modal>
  )
}

type Tab = 'open' | 'history'
type Dialog = { type: 'schedule' } | { type: 'parts'; task: MaintenanceTask } | { type: 'complete'; task: MaintenanceTask } | null

export default function MaintenancePage() {
  const actor = useRequiredActor()
  const tasks = useTasks()
  const printers = usePrinters()
  const printerById = useById(printers)
  const now = useNow(10_000)
  const { run } = useAction()
  const [tab, setTab] = useState<Tab>('open')
  const [dialog, setDialog] = useState<Dialog>(null)

  if (!tasks || !printers) return <Spinner />
  const open = tasks.filter((t) => ACTIVE_MAINTENANCE_STATUSES.includes(t.status)).sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))
  const history = tasks.filter((t) => !ACTIVE_MAINTENANCE_STATUSES.includes(t.status))
  const overdue = open.filter((t) => isTaskOverdue(t, now)).length
  const done = history.filter((t) => t.status === 'done')
  const totalCost = done.reduce((s, t) => s + t.partsCost + t.laborCost, 0)
  const shown = tab === 'open' ? open : history

  return (
    <>
      <PageHeader
        title="Mantenimiento"
        subtitle="Programa revisiones, atiende fallas y lleva el costo de repuestos y mano de obra."
        actions={
          <Button variant="primary" onClick={() => setDialog({ type: 'schedule' })} icon={<CalendarPlus className="size-4" />}>
            Programar mantenimiento
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Wrench} label="Tareas abiertas" value={open.length} tone="info" />
        <Kpi icon={Gauge} label="Vencidas sin iniciar" value={overdue} tone={overdue ? 'bad' : 'ok'} />
        <Kpi icon={Check} label="Completadas" value={done.length} tone="ok" />
        <Kpi icon={Hammer} label="Costo acumulado" value={fmtMoney(totalCost)} hint="Repuestos + mano de obra" tone="warn" />
      </div>

      <Card className="mb-6">
        <CardHeader title="Desgaste de las impresoras" subtitle="Horas de impresión desde el último mantenimiento" />
        <div className="grid gap-x-8 gap-y-4 p-5 md:grid-cols-2">
          {printers.map((p) => {
            const pct = (p.hoursSinceMaintenance / p.maintenanceIntervalHours) * 100
            return (
              <div key={p.id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="num text-muted">
                    {fmtNumber(p.hoursSinceMaintenance, 0)} / {p.maintenanceIntervalHours} h
                  </span>
                </div>
                <ProgressBar value={pct} tone={pct >= 100 ? 'bad' : pct >= 85 ? 'warn' : 'brand'} label={`Desgaste de ${p.name}`} />
              </div>
            )
          })}
        </div>
      </Card>

      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'open', label: 'Abiertas', count: open.length },
            { value: 'history', label: 'Historial', count: history.length },
          ]}
        />
      </div>

      <Card>
        {shown.length === 0 ? (
          <EmptyState icon={Wrench} title={tab === 'open' ? 'No hay mantenimientos abiertos' : 'Aún no hay historial'} text="Cuando una impresora falle o acumule horas, se creará una tarea automáticamente." />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Tarea</th>
                  <th className={tableCls.th}>Impresora</th>
                  <th className={tableCls.th}>Horario</th>
                  <th className={tableCls.th}>Estado</th>
                  <th className={`${tableCls.th} text-right`}>Costo</th>
                  <th className={tableCls.th}>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id} className={tableCls.row}>
                    <td className={tableCls.td}>
                      <p className="font-medium">{t.title}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <MaintenanceTypeBadge type={t.type} />
                        {t.trigger === 'failure' && <Badge tone="warn">Por falla</Badge>}
                        {t.trigger === 'hours' && <Badge tone="info">Por horas de uso</Badge>}
                      </div>
                    </td>
                    <td className={tableCls.td}>{printerById.get(t.printerId)?.name}</td>
                    <td className={`${tableCls.td} whitespace-nowrap text-sm`}>
                      {fmtDateTime(t.scheduledStart)}
                      <br />
                      <span className="text-muted">hasta {fmtDateTime(t.scheduledEnd)}</span>
                    </td>
                    <td className={tableCls.td}>
                      <MaintenanceStatusBadge status={t.status} />
                      {isTaskOverdue(t, now) && <Badge tone="bad" className="ml-1">Vencida</Badge>}
                    </td>
                    <td className={`${tableCls.td} num text-right`}>{t.partsCost + t.laborCost > 0 ? fmtMoney(t.partsCost + t.laborCost) : '—'}</td>
                    <td className={`${tableCls.td} whitespace-nowrap text-right`}>
                      {t.status === 'scheduled' && (
                        <>
                          <Button size="sm" variant="primary" onClick={() => run(() => startMaintenance(actor, t.id), 'Mantenimiento iniciado.')} icon={<CirclePlay className="size-3.5" />}>
                            Iniciar
                          </Button>{' '}
                          <Button size="sm" variant="ghost" className="px-2" aria-label="Cancelar tarea" onClick={() => run(() => cancelMaintenance(actor, t.id), 'Tarea cancelada.')}>
                            <X className="size-4" />
                          </Button>
                        </>
                      )}
                      {t.status === 'in_progress' && (
                        <>
                          <Button size="sm" onClick={() => setDialog({ type: 'parts', task: t })} icon={<Hammer className="size-3.5" />}>
                            Repuestos
                          </Button>{' '}
                          <Button size="sm" variant="primary" onClick={() => setDialog({ type: 'complete', task: t })} icon={<Check className="size-3.5" />}>
                            Completar
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog?.type === 'schedule' && <ScheduleModal onClose={() => setDialog(null)} />}
      {dialog?.type === 'parts' && <PartsModal key={dialog.task.id} task={dialog.task} onClose={() => setDialog(null)} />}
      {dialog?.type === 'complete' && <CompleteModal key={dialog.task.id} task={dialog.task} onClose={() => setDialog(null)} />}
    </>
  )
}
