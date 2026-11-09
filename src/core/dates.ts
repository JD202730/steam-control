/** Utilidades de fechas. Todas las fechas se guardan como ISO 8601 en UTC (ordenables como texto). */

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** Convierte cualquier fecha válida a ISO; lanza si no es válida. */
export function toIso(value: string | number | Date): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) throw new RangeError('Fecha no válida')
  return d.toISOString()
}

/** 'YYYY-MM-DD' de un instante (en UTC). */
export function dayKey(value: string | number | Date): string {
  return new Date(value).toISOString().slice(0, 10)
}

/**
 * 'YYYY-MM-DD' del día en la zona horaria de quien usa la app. Las fechas "de calendario"
 * (cuándo lo necesito, cuándo lo devuelvo, qué cuenta como "hoy") deben usar este día y no el
 * de UTC: de noche en América, el día UTC ya es el de mañana.
 */
export function localDay(value: string | number | Date): string {
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** ¿Es una fecha 'YYYY-MM-DD' real y razonable (años 2000–2100)? Detecta años de 5 o 6 dígitos al teclear. */
export function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  const d = new Date(`${value}T00:00:00Z`)
  return year >= 2000 && year <= 2100 && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** Suma días a un 'YYYY-MM-DD'. */
export function addDaysToDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** ¿Se solapan los intervalos [aStart, aEnd) y [bStart, bEnd)? Acepta ISO. */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart
}
