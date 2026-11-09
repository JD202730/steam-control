import { useState } from 'react'
import { MINUTE } from '@/core/dates'
import type { Actor } from '@/core/permissions/roles'
import { useAction } from '@/shared/hooks/hooks'
import { fmtNumber, fmtTime } from '@/shared/format'
import { Button } from '@/shared/ui/Button'
import { Field, Input, Select, toNumber } from '@/shared/ui/Fields'
import { Modal } from '@/shared/ui/Modal'
import { availableOf } from '../../inventory/service'
import type { InventoryItem } from '../../inventory/types'
import { startJob } from '../service'
import type { Printer, Reservation } from '../types'

/** Inicia un trabajo de impresión dentro de una reserva confirmada. */
export function StartJobModal({
  actor,
  reservation,
  printer,
  filaments,
  nowMs,
  onClose,
}: {
  actor: Actor
  reservation: Reservation
  printer?: Printer
  filaments: InventoryItem[]
  nowMs: number
  onClose: () => void
}) {
  const { run, pending } = useAction()
  const usable = filaments.filter((f) => f.active && availableOf(f) > 0)
  const [name, setName] = useState('')
  const [filamentId, setFilamentId] = useState('')
  const [grams, setGrams] = useState('40')
  const [minutes, setMinutes] = useState('60')

  const left = Math.max(0, Math.floor((Date.parse(reservation.endsAt) - Math.max(nowMs, Date.parse(reservation.startsAt))) / MINUTE))
  const selected = usable.find((f) => f.id === (filamentId || usable[0]?.id))

  const submit = async () => {
    if (!selected) return
    const job = await run(
      () => startJob(actor, { reservationId: reservation.id, name, filamentItemId: selected.id, gramsEstimated: toNumber(grams), estimatedMinutes: toNumber(minutes) }),
      'Impresión iniciada.',
    )
    if (job) onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Iniciar impresión"
      description={`${printer?.name ?? 'Impresora'} · tu reserva termina a las ${fmtTime(reservation.endsAt)} (quedan ${left} min).`}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={pending} onClick={submit} disabled={!selected || name.trim().length < 2}>
            Iniciar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre del trabajo" className="sm:col-span-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: carcasa del sensor" maxLength={80} autoFocus />
        </Field>
        <Field label="Filamento" className="sm:col-span-2" hint={selected ? `Disponible: ${fmtNumber(availableOf(selected))} g` : 'No hay filamento disponible.'}>
          <Select value={selected?.id ?? ''} onChange={(e) => setFilamentId(e.target.value)}>
            {usable.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Gramos estimados">
          <Input type="number" min={1} max={2000} value={grams} onChange={(e) => setGrams(e.target.value)} />
        </Field>
        <Field label="Duración estimada (min)" hint={`Máximo ${left} min`}>
          <Input type="number" min={5} max={left || undefined} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
      </div>
      <p className="mt-4 text-xs text-muted">El filamento se reserva al iniciar y se descuenta del inventario a medida que avanza la impresión.</p>
    </Modal>
  )
}
