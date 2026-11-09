import { ChevronLeft, ChevronRight, CirclePlay, OctagonAlert, Plus, Power, PowerOff, Square, Wrench, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { clock } from '@/core/clock/clock'
import { AgendaTimeline, BookingForm } from '@/modules/printers/components/Agenda'
import { PrinterCard } from '@/modules/printers/components/PrinterCard'
import { cancelJob, cancelReservation, clearPrinterError, createPrinter, reportFailure, setPrinterOffline } from '@/modules/printers/service'
import { OCCUPYING_STATUSES, type Printer } from '@/modules/printers/types'
import { useAllJobs, useAllReservations, useById, usePrinters, useTasks, useUsers } from '@/modules/data-hooks'
import { useAction, useNow, useRequiredActor } from '@/shared/hooks/hooks'
import { fmtDateTime, fmtNumber, fmtTime, toLocalInput } from '@/shared/format'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader } from '@/shared/ui/Card'
import { Field, Input, toNumber } from '@/shared/ui/Fields'
import { Modal } from '@/shared/ui/Modal'
import { EmptyState, PageHeader, Spinner, tableCls } from '@/shared/ui/Misc'
import { JobStatusBadge, ReservationStatusBadge } from '@/shared/ui/StatusBadges'

const shiftDay = (day: string, delta: number) => {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + delta)
  return toLocalInput(d.getTime()).slice(0, 10)
}

function FailureModal({ printer, onClose }: { printer: Printer; onClose: () => void }) {
  const actor = useRequiredActor()
  const { run, pending } = useAction()
  const [reason, setReason] = useState('')
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Reportar falla en ${printer.name}`}
      description={printer.status === 'printing' ? 'El trabajo en curso se marcará como fallido y el filamento no usado volverá al inventario.' : 'Se abrirá un mantenimiento correctivo.'}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="danger"
            loading={pending}
            disabled={reason.trim().length < 3}
            onClick={async () => {
              if (await run(() => reportFailure(actor, printer.id, reason), 'Falla registrada. Se creó un mantenimiento correctivo.')) onClose()
            }}
          >
            Reportar falla
          </Button>
        </>
      }
    >
      <Field label="¿Qué pasó?">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: la boquilla se obstruyó" maxLength={200} autoFocus />
      </Field>
    </Modal>
  )
}

function NewPrinterModal({ onClose }: { onClose: () => void }) {
  const actor = useRequiredActor()
  const { run, pending } = useAction()
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [location, setLocation] = useState('')
  const [interval, setIntervalHours] = useState('100')
  return (
    <Modal
      open
      onClose={onClose}
      title="Nueva impresora"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={name.trim().length < 2 || model.trim().length < 2}
            onClick={async () => {
              if (await run(() => createPrinter(actor, { name, model, location, maintenanceIntervalHours: toNumber(interval) }), 'Impresora agregada.')) onClose()
            }}
          >
            Agregar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
        </Field>
        <Field label="Modelo">
          <Input value={model} onChange={(e) => setModel(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Ubicación">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={60} placeholder="Mesa 3" />
        </Field>
        <Field label="Mantenimiento cada (horas)" hint="Horas de impresión entre mantenimientos.">
          <Input type="number" min={1} value={interval} onChange={(e) => setIntervalHours(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

export default function AdminPrintersPage() {
  const actor = useRequiredActor()
  const navigate = useNavigate()
  const printers = usePrinters()
  const reservations = useAllReservations()
  const jobs = useAllJobs()
  const tasks = useTasks()
  const users = useUsers()
  const userById = useById(users)
  const now = useNow(1000)
  const { run } = useAction()
  const [printerId, setPrinterId] = useState('')
  const [day, setDay] = useState(() => toLocalInput(clock.nowMs()).slice(0, 10))
  const [failing, setFailing] = useState<Printer | null>(null)
  const [adding, setAdding] = useState(false)

  if (!printers || !reservations || !jobs || !tasks || !users) return <Spinner />

  const printerById = new Map(printers.map((p) => [p.id, p]))
  const jobByPrinter = new Map(jobs.filter((j) => j.status === 'printing').map((j) => [j.printerId, j]))
  const selected = printers.find((p) => p.id === printerId) ?? printers[0]
  const nowIso = new Date(now).toISOString()
  const upcoming = reservations.filter((r) => OCCUPYING_STATUSES.includes(r.status) && r.endsAt > nowIso).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 12)

  return (
    <>
      <PageHeader
        title="Impresoras 3D"
        subtitle="Estado en vivo, reservas, trabajos y fallas de cada equipo."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)} icon={<Plus className="size-4" />}>
            Nueva impresora
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {printers.map((p) => {
          const job = jobByPrinter.get(p.id)
          return (
            <PrinterCard
              key={p.id}
              printer={p}
              job={job}
              ownerName={job ? userById.get(job.userId)?.name : undefined}
              nowMs={now}
              actions={
                <>
                  {p.status === 'printing' && job && (
                    <Button size="sm" onClick={() => run(() => cancelJob(actor, job.id), 'Trabajo detenido.')} icon={<Square className="size-3.5" />}>
                      Detener
                    </Button>
                  )}
                  {(p.status === 'idle' || p.status === 'printing') && (
                    <Button size="sm" variant="danger" onClick={() => setFailing(p)} icon={<OctagonAlert className="size-3.5" />}>
                      Falla
                    </Button>
                  )}
                  {p.status === 'idle' && (
                    <Button size="sm" variant="ghost" onClick={() => run(() => setPrinterOffline(actor, p.id, true), 'Impresora fuera de servicio.')} icon={<PowerOff className="size-3.5" />}>
                      Apagar
                    </Button>
                  )}
                  {p.status === 'offline' && (
                    <Button size="sm" variant="primary" onClick={() => run(() => setPrinterOffline(actor, p.id, false), 'Impresora en línea.')} icon={<Power className="size-3.5" />}>
                      Poner en línea
                    </Button>
                  )}
                  {p.status === 'error' && (
                    <>
                      <Button size="sm" variant="primary" onClick={() => navigate('/admin/mantenimiento')} icon={<Wrench className="size-3.5" />}>
                        Ir a reparación
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => run(() => clearPrinterError(actor, p.id), 'Falla descartada.')} icon={<CirclePlay className="size-3.5" />}>
                        Era falsa alarma
                      </Button>
                    </>
                  )}
                  {p.status === 'maintenance' && (
                    <Button size="sm" onClick={() => navigate('/admin/mantenimiento')} icon={<Wrench className="size-3.5" />}>
                      Ver mantenimiento
                    </Button>
                  )}
                </>
              }
            />
          )
        })}
      </div>

      <div className="mb-6 grid items-start gap-6 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader
            title={`Agenda de ${selected.name}`}
            actions={
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="px-2" onClick={() => setDay(shiftDay(day, -1))} aria-label="Día anterior">
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="num min-w-28 text-center text-sm font-medium">{new Date(`${day}T12:00:00`).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <Button size="sm" variant="ghost" className="px-2" onClick={() => setDay(shiftDay(day, 1))} aria-label="Día siguiente">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            }
          />
          <div className="p-5">
            <AgendaTimeline day={day} reservations={reservations.filter((r) => r.printerId === selected.id)} tasks={tasks.filter((t) => t.printerId === selected.id)} meId={actor.id} nowMs={now} userName={(id) => userById.get(id)?.name ?? 'Alguien'} />
          </div>
        </Card>
        <BookingForm actor={actor} printers={printers} printerId={selected.id} onPrinterChange={setPrinterId} day={day} onDayChange={setDay} nowMs={now} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Próximas reservas" subtitle="De todas las impresoras" />
          {upcoming.length === 0 ? (
            <EmptyState icon={ChevronRight} title="No hay reservas próximas" />
          ) : (
            <div className={tableCls.wrap}>
              <table className={tableCls.table}>
                <thead>
                  <tr>
                    <th className={tableCls.th}>Impresora</th>
                    <th className={tableCls.th}>Persona</th>
                    <th className={tableCls.th}>Horario</th>
                    <th className={tableCls.th}>Estado</th>
                    <th className={tableCls.th}>
                      <span className="sr-only">Acción</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((r) => (
                    <tr key={r.id} className={tableCls.row}>
                      <td className={tableCls.td}>{printerById.get(r.printerId)?.name}</td>
                      <td className={tableCls.td}>{userById.get(r.userId)?.name}</td>
                      <td className={`${tableCls.td} whitespace-nowrap`}>
                        {fmtDateTime(r.startsAt)} – {fmtTime(r.endsAt)}
                      </td>
                      <td className={tableCls.td}>
                        <ReservationStatusBadge status={r.status} />
                      </td>
                      <td className={`${tableCls.td} text-right`}>
                        {(r.status === 'confirmed' || r.status === 'affected') && (
                          <Button size="sm" variant="ghost" className="px-2" aria-label="Cancelar reserva" onClick={() => run(() => cancelReservation(actor, r.id), 'Reserva cancelada.')}>
                            <X className="size-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Trabajos recientes" />
          {jobs.length === 0 ? (
            <EmptyState icon={ChevronRight} title="Todavía no hay trabajos" />
          ) : (
            <div className={tableCls.wrap}>
              <table className={tableCls.table}>
                <thead>
                  <tr>
                    <th className={tableCls.th}>Trabajo</th>
                    <th className={tableCls.th}>Impresora</th>
                    <th className={`${tableCls.th} text-right`}>Filamento</th>
                    <th className={tableCls.th}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.slice(0, 10).map((j) => (
                    <tr key={j.id} className={tableCls.row}>
                      <td className={tableCls.td}>
                        <p className="font-medium">{j.name}</p>
                        <p className="text-xs text-muted">{userById.get(j.userId)?.name}</p>
                      </td>
                      <td className={tableCls.td}>{printerById.get(j.printerId)?.name}</td>
                      <td className={`${tableCls.td} num text-right`}>{fmtNumber(j.gramsUsed)} g</td>
                      <td className={tableCls.td}>
                        <JobStatusBadge status={j.status} />
                        {j.failureReason && <p className="mt-1 text-xs text-bad">{j.failureReason}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {failing && <FailureModal key={failing.id} printer={failing} onClose={() => setFailing(null)} />}
      {adding && <NewPrinterModal onClose={() => setAdding(false)} />}
    </>
  )
}
