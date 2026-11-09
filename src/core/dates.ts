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
