import { ChevronLeft, ChevronRight, Play, Printer, X } from 'lucide-react'
import { useState } from 'react'
import { clock } from '@/core/clock/clock'
import { MINUTE } from '@/core/dates'
import { AgendaTimeline, BookingForm } from '@/modules/printers/components/Agenda'
import { PrinterCard } from '@/modules/printers/components/PrinterCard'
import { StartJobModal } from '@/modules/printers/components/StartJobModal'
import { cancelJob, cancelReservation } from '@/modules/printers/service'
import { OCCUPYING_STATUSES, type Reservation } from '@/modules/printers/types'
import { useAllJobs, useAllReservations, useById, useItems, usePrinters, useTasks, useUsers } from '@/modules/data-hooks'
import { useAction, useNow, useRequiredActor } from '@/shared/hooks/hooks'
import { fmtDateTime, fmtNumber, fmtTime, toLocalInput } from '@/shared/format'
import { Button } from '@/shared/ui/Button'
import { Card, CardHeader } from '@/shared/ui/Card'
import { EmptyState, PageHeader, ProgressBar, Spinner, tableCls } from '@/shared/ui/Misc'
import { JobStatusBadge, ReservationStatusBadge } from '@/shared/ui/StatusBadges'

const shiftDay = (day: string, delta: number) => {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + delta)
  return toLocalInput(d.getTime()).slice(0, 10)
}

export default function UserPrintersPage() {
  const actor = useRequiredActor()
  const printers = usePrinters()
  const reservations = useAllReservations()
  const jobs = useAllJobs()
  const tasks = useTasks()
  const items = useItems()
  const users = useUsers()
  const userById = useById(users)
  const now = useNow(1000)
  const { run } = useAction()

  const [printerId, setPrinterId] = useState('')
  const [day, setDay] = useState(() => toLocalInput(clock.nowMs()).slice(0, 10))
  const [startFor, setStartFor] = useState<Reservation | null>(null)

  if (!printers || !reservations || !jobs || !tasks || !items) return <Spinner />
  if (!printers.length) return <EmptyState icon={Printer} title="No hay impresoras registradas" />

  const printerName = new Map(printers.map((p) => [p.id, p]))
  const jobByPrinter = new Map(jobs.filter((j) => j.status === 'printing').map((j) => [j.printerId, j]))
  const nowIso = new Date(now).toISOString()
  const mine = reservations
    .filter((r) => r.userId === actor.id && OCCUPYING_STATUSES.includes(r.status) && r.endsAt > nowIso)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const myJobs = jobs.filter((j) => j.userId === actor.id).slice(0, 6)
  const selected = printers.find((p) => p.id === printerId) ?? printers[0]

  return (
    <>
      <PageHeader title="Impresoras 3D" subtitle="Mira qué impresoras están libres, reserva una franja y sigue tus impresiones." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {printers.map((p) => {
          const job = jobByPrinter.get(p.id)
          return (
            <button key={p.id} type="button" onClick={() => setPrinterId(p.id)} className="rounded-xl text-left outline-offset-2" aria-pressed={selected.id === p.id}>
              <div className={selected.id === p.id ? 'rounded-xl ring-2 ring-brand' : ''}>
                <PrinterCard printer={p} job={job} ownerName={job ? userById.get(job.userId)?.name : undefined} nowMs={now} compact />
              </div>
            </button>
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
            <AgendaTimeline
              day={day}
              reservations={reservations.filter((r) => r.printerId === selected.id)}
              tasks={tasks.filter((t) => t.printerId === selected.id)}
              meId={actor.id}
              nowMs={now}
              userName={(id) => userById.get(id)?.name ?? 'Alguien'}
            />
          </div>
        </Card>
        <BookingForm actor={actor} printers={printers} printerId={selected.id} onPrinterChange={setPrinterId} day={day} onDayChange={setDay} nowMs={now} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Mis reservas" subtitle="Cuando llegue la hora, inicia tu impresión desde aquí." />
          {mine.length === 0 ? (
            <EmptyState icon={Printer} title="No tienes reservas próximas" />
          ) : (
            <ul className="divide-y divide-line">
              {mine.map((r) => {
                const printer = printerName.get(r.printerId)
                const canStart = r.status === 'confirmed' && now >= Date.parse(r.startsAt) - 15 * MINUTE && now < Date.parse(r.endsAt) && printer?.status === 'idle'
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {printer?.name} · {fmtDateTime(r.startsAt)} – {fmtTime(r.endsAt)}
                      </p>
                      <p className="truncate text-sm text-muted">{r.purpose}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <ReservationStatusBadge status={r.status} />
                      {canStart && (
                        <Button size="sm" variant="primary" onClick={() => setStartFor(r)} icon={<Play className="size-4" />}>
                          Iniciar
                        </Button>
                      )}
                      {(r.status === 'confirmed' || r.status === 'affected') && (
                        <Button size="sm" variant="ghost" onClick={() => run(() => cancelReservation(actor, r.id), 'Reserva cancelada.')} icon={<X className="size-4" />}>
                          Cancelar
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Mis impresiones" />
          {myJobs.length === 0 ? (
            <EmptyState icon={Printer} title="Aún no has impreso nada" />
          ) : (
            <div className={tableCls.wrap}>
              <table className={tableCls.table}>
                <thead>
                  <tr>
                    <th className={tableCls.th}>Trabajo</th>
                    <th className={tableCls.th}>Avance</th>
                    <th className={tableCls.th}>Estado</th>
                    <th className={tableCls.th}>
                      <span className="sr-only">Acción</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {myJobs.map((j) => {
                    const live = j.status === 'printing' ? Math.min(100, ((now - Date.parse(j.startedAt)) / (j.estimatedMinutes * MINUTE)) * 100) : j.progress
                    return (
                      <tr key={j.id} className={tableCls.row}>
                        <td className={tableCls.td}>
                          <p className="font-medium">{j.name}</p>
                          <p className="text-xs text-muted">
                            {printerName.get(j.printerId)?.name} · {fmtNumber(j.gramsUsed)} g
                          </p>
                        </td>
                        <td className={`${tableCls.td} w-36`}>
                          <ProgressBar value={live} tone={j.status === 'failed' ? 'bad' : 'brand'} label={`Avance de ${j.name}`} />
                          <span className="num text-xs text-muted">{Math.floor(live)}%</span>
                        </td>
                        <td className={tableCls.td}>
                          <JobStatusBadge status={j.status} />
                        </td>
                        <td className={`${tableCls.td} text-right`}>
                          {j.status === 'printing' && (
                            <Button size="sm" variant="ghost" onClick={() => run(() => cancelJob(actor, j.id), 'Impresión cancelada.')}>
                              Detener
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {startFor && (
        <StartJobModal key={startFor.id} actor={actor} reservation={startFor} printer={printerName.get(startFor.printerId)} filaments={items.filter((i) => i.kind === 'filament')} nowMs={now} onClose={() => setStartFor(null)} />
      )}
    </>
  )
}
