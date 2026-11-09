import type { Role } from '@/core/permissions/roles'

export type { Role }
export type UserStatus = 'active' | 'disabled'

export interface User {
  id: string
  name: string
  email: string
  passwordHash: string
  role: Role
  status: UserStatus
  /** Grupo o área (p. ej. "Docente de Física", "Grado 10-A"). */
  area: string
  createdAt: string
}

/** Usuario sin datos sensibles, seguro para mostrar en la interfaz. */
export type PublicUser = Omit<User, 'passwordHash'>
