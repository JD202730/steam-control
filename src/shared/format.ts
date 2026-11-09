import { format, formatDistanceStrict } from 'date-fns'
import { es } from 'date-fns/locale'
import { clock } from '@/core/clock/clock'

/** Formatos de fecha y número para la interfaz (siempre en español). */
export const fmtDateTime = (iso: string) => format(new Date(iso), "d MMM, HH:mm", { locale: es })
export const fmtDate = (iso: string) => format(new Date(iso), 'd MMM yyyy', { locale: es })
export const fmtTime = (iso: string) => format(new Date(iso), 'HH:mm')
/** 'YYYY-MM-DD' -> '3 jun 2026' */
export const fmtDay = (day: string) => format(new Date(`${day}T12:00:00`), 'd MMM yyyy', { locale: es })
/** "hace 3 horas" respecto al reloj del sistema (que puede ir acelerado). */
export const fmtAgo = (iso: string) => formatDistanceStrict(new Date(iso), clock.now(), { locale: es, addSuffix: true })

export function fmtDuration(minutes: number): string {
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} h ${rest} min` : `${h} h`
}

export const fmtNumber = (n: number, digits = 0) => n.toLocaleString('es', { maximumFractionDigits: digits })

export const fmtMoney = (n: number) =>
  `$${n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Valor para un <input type="datetime-local"> en hora local. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Valor de un <input type="datetime-local"> -> ISO (UTC). */
export const fromLocalInput = (value: string): string => new Date(value).toISOString()
