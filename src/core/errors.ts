/** Errores de dominio con código, para que la UI pueda reaccionar según el tipo. */
export type ErrorCode = 'FORBIDDEN' | 'VALIDATION' | 'CONFLICT' | 'NOT_FOUND' | 'AUTH'

export class DomainError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}

export const forbidden = (message = 'No tienes permiso para realizar esta acción.') =>
  new DomainError('FORBIDDEN', message)
export const invalid = (message: string) => new DomainError('VALIDATION', message)
export const conflict = (message: string) => new DomainError('CONFLICT', message)
export const notFound = (message: string) => new DomainError('NOT_FOUND', message)
export const authError = (message = 'Credenciales incorrectas.') =>
  new DomainError('AUTH', message)

export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  return 'Ha ocurrido un error inesperado.'
}

/** Dexie lanza ConstraintError al violar un índice único (p. ej. SKU o correo duplicado). */
export function isConstraintError(e: unknown): boolean {
  return e instanceof Error && e.name === 'ConstraintError'
}
