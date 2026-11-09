import type { z, ZodType } from 'zod'
import { invalid } from './errors'

/** Valida datos de entrada en la frontera de cada servicio y devuelve el resultado tipado. */
export function parseInput<S extends ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw invalid(result.error.issues[0]?.message ?? 'Datos no válidos.')
  }
  return result.data
}
