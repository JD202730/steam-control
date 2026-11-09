import clsx from 'clsx'
import { CalendarPlus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { HOUR, MINUTE, isIsoDay } from '@/core/dates'
import type { Actor } from '@/core/permissions/roles'
import { useAction } from '@/shared/hooks/hooks'
import { fmtTime, toLocalInput } from '@/shared/format'
import { Button } from '@/shared/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/ui/Card'
import { Field, Input, Select } from '@/shared/ui/Fields'
import type { MaintenanceTask } from '../../maintenance/types'
import { ACTIVE_MAINTENANCE_STATUSES } from '../../maintenance/types'
import { createReservation } from '../service'
import { OCCUPYING_STATUSES, type Printer, type Reservation } from '../types'

const DAY_START_H = 7
const DAY_END_H = 21

const DURATIONS = [30, 60, 90, 120, 180, 240, 360]
const fmtMinutes = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`)

/** Línea de tiempo de una impresora para un día: reservas (propias y ajenas) y mantenimientos. */
export function AgendaTimeline({
  day,
  reservations,
  tasks,
  meId,
  nowMs,
  userName,
}: {
  day: string
  reservations: Reservation[]
  tasks: MaintenanceTask[]
  meId: string
  nowMs: number
  userName: (id: string) => string
}) {
  const [y, m, d] = day.split('-').map(Number)
  const midnight = new Date(y, m - 1, d).getTime()

  // El rango visible es 07:00–21:00, pero se amplía si hay reservas, mantenimientos o la hora actual fuera de él.
  const marks: number[] = []
  const track = (aIso: string, bIso: string) => {
    const a = Math.max(Date.parse(aIso), midnight)
    const b = Math.min(Date.parse(bIso), midnight + 24 * HOUR)
    if (b > a) marks.push((a - midnight) / HOUR, (b - midnight) / HOUR)
  }
  reservations.filter((r) => OCCUPYING_STATUSES.includes(r.status)).forEach((r) => track(r.startsAt, r.endsAt))
  tasks.filter((t) => ACTIVE_MAINTENANCE_STATUSES.includes(t.status)).forEach((t) => track(t.scheduledStart, t.scheduledEnd))
  if (nowMs >= midnight && nowMs < midnight + 24 * HOUR) marks.push((nowMs - midnight) / HOUR)
  const startH = Math.max(0, Math.min(DAY_START_H, Math.floor(Math.min(...marks, DAY_START_H))))
  const endH = Math.min(24, Math.max(DAY_END_H, Math.ceil(Math.max(...marks, DAY_END_H))))
  const RANGE = (endH - startH) * HOUR
  const start = midnight + startH * HOUR
  const end = start + RANGE

  const pos = (ms: number) => Math.min(100, Math.max(0, ((ms - start) / RANGE) * 100))
  const blocks = (aIso: string, bIso: string) => {
    const a = Date.parse(aIso)
    const b = Date.parse(bIso)
    if (b <= start || a >= end) return null
    return { left: pos(a), width: Math.max(1.2, pos(b) - pos(a)) }
  }
  const step = endH - startH > 14 ? 3 : 2
  const hours = Array.from({ length: Math.floor((endH - startH) / step) + 1 }, (_, i) => startH + i * step)
  const nowPct = nowMs >= start && nowMs <= end ? pos(nowMs) : null

  return (
    <div>
      <div className="relative h-16 overflow-hidden rounded-lg border border-line bg-surface-2">
        {hours.map((h) => (
          <div key={h} className="absolute inset-y-0 border-l border-line" style={{ left: `${((h - startH) / (endH - startH)) * 100}%` }} />
        ))}
        {tasks
          .filter((t) => ACTIVE_MAINTENANCE_STATUSES.includes(t.status))
          .map((t) => {
            const b = blocks(t.scheduledStart, t.scheduledEnd)
            return (
              b && (
                <div
                  key={t.id}
                  title={`Mantenimiento ${fmtTime(t.scheduledStart)}–${fmtTime(t.scheduledEnd)}: ${t.title}`}
                  className="absolute inset-y-1 rounded-md border border-warn/50 bg-warn-soft px-1.5 text-[11px] font-medium leading-[3.4rem] text-warn"
                  style={{ left: `${b.left}%`, width: `${b.width}%`, backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--warn) 18%, transparent) 6px 8px)' }}
                >
                  <span className="truncate">Mantenimiento</span>
                </div>
              )
            )
          })}
        {reservations
          .filter((r) => OCCUPYING_STATUSES.includes(r.status))
          .map((r) => {
            const b = blocks(r.startsAt, r.endsAt)
            if (!b) return null
            const mine = r.userId === meId
            return (
              <div
                key={r.id}
                title={`${userName(r.userId)} · ${fmtTime(r.startsAt)}–${fmtTime(r.endsAt)} · ${r.purpose}`}
                className={clsx(
                  'absolute inset-y-1 overflow-hidden rounded-md px-1.5 text-[11px] font-medium leading-[3.4rem]',
                  r.status === 'affected' ? 'border border-warn bg-warn-soft text-warn' : mine ? 'bg-brand text-brand-ink' : 'bg-line-strong text-ink',
                )}
                style={{ left: `${b.left}%`, width: `${b.width}%` }}
              >
                <span className="truncate">{mine ? 'Tu reserva' : userName(r.userId).split(' ')[0]}</span>
              </div>
            )
          })}
        {nowPct !== null && <div className="absolute inset-y-0 w-0.5 bg-accent" style={{ left: `${nowPct}%` }} title="Ahora" />}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-muted">
        {hours.map((h) => (
          <span key={h} className="num absolute -translate-x-1/2" style={{ left: `${((h - startH) / (endH - startH)) * 100}%` }}>
            {String(h).padStart(2, '0')}:00
          </span>
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Leyenda de la agenda">
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-brand" aria-hidden /> Tus reservas</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-line-strong" aria-hidden /> Otras personas</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] border border-warn bg-warn-soft" aria-hidden /> Mantenimiento o reserva afectada</li>
        <li className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-accent" aria-hidden /> Ahora</li>
      </ul>
    </div>
  )
}

/** Formulario para reservar una franja de una impresora. */
export function BookingForm({
  actor,
  printers,
  printerId,
  onPrinterChange,
  day,
  onDayChange,
  nowMs,
}: {
  actor: Actor
  printers: Printer[]
  printerId: string
  onPrinterChange: (id: string) => void
  day: string
  onDayChange: (day: string) => void
  nowMs: number
}) {
  const { run, pending } = useAction()
  const defaultStart = useMemo(() => {
    const next = Math.ceil(nowMs / (30 * MINUTE)) * 30 * MINUTE
    return toLocalInput(next).slice(11, 16)
  }, [nowMs])
  const [time, setTime] = useState(defaultStart)
  const [minutes, setMinutes] = useState(60)
  const [purpose, setPurpose] = useState('')

  // El día puede cambiar desde fuera (flechas "día anterior/siguiente"): se refleja en el campo.
  const dayInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (dayInput.current && isIsoDay(day) && dayInput.current.value !== day) dayInput.current.value = day
  }, [day])

  const submit = async () => {
    const startsAt = new Date(`${day}T${time}`)
    const valid = !Number.isNaN(startsAt.getTime())
    const ok = await run(
      () =>
        createReservation(actor, {
          printerId,
          startsAt: valid ? startsAt.toISOString() : '',
          endsAt: valid ? new Date(startsAt.getTime() + minutes * MINUTE).toISOString() : '',
          purpose,
        }),
      'Reserva confirmada.',
    )
    if (ok) setPurpose('')
  }

  return (
    <Card>
      <CardHeader title="Reservar una franja" subtitle="Elige la impresora, el día y la hora." />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <Field label="Impresora">
          <Select value={printerId} onChange={(e) => onPrinterChange(e.target.value)}>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Día">
          {/* No controlado: así se puede teclear la fecha por partes sin que se borre lo escrito. */}
          <Input
            ref={dayInput}
            type="date"
            min="2000-01-01"
            max="2100-12-31"
            defaultValue={day}
            onChange={(e) => isIsoDay(e.target.value) && onDayChange(e.target.value)}
          />
        </Field>
        <Field label="Hora de inicio">
          <Input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="Duración">
          <Select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {DURATIONS.map((m) => (
              <option key={m} value={m}>
                {fmtMinutes(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="¿Qué vas a imprimir?" className="sm:col-span-2">
          <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Ej.: soportes para el proyecto de robótica" maxLength={160} />
        </Field>
        <div className="sm:col-span-2">
          <Button variant="primary" onClick={submit} loading={pending} disabled={!time || purpose.trim().length < 3} icon={<CalendarPlus className="size-4" />}>
            Reservar
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
