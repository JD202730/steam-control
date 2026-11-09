import { authError } from '../errors'
import { db } from '../db/db'
import type { Role } from '../permissions/roles'
import { verifyPassword } from './password'

export interface SessionUser {
  id: string
  name: string
  email: string
  role: Role
}

/** Valida correo y contraseña contra la base de datos local. */
export async function authenticate(email: string, password: string): Promise<SessionUser> {
  const user = await db.users.where('email').equals(email.trim().toLowerCase()).first()
  if (!user) throw authError()
  if (!(await verifyPassword(password, user.passwordHash))) throw authError()
  if (user.status !== 'active') throw authError('Tu cuenta está desactivada. Contacta al administrador.')
  return { id: user.id, name: user.name, email: user.email, role: user.role }
}
