import { z } from 'zod'
import { hashPassword, verifyPassword } from '@/core/auth/password'
import { clock } from '@/core/clock/clock'
import { writeAudit } from '@/core/db/audit'
import { db } from '@/core/db/db'
import { runTx } from '@/core/db/tx'
import { conflict, invalid, isConstraintError, notFound } from '@/core/errors'
import { newId } from '@/core/ids'
import { assertCan, type Actor } from '@/core/permissions/roles'
import { parseInput } from '@/core/validation'
import type { PublicUser, User } from './types'

const toPublic = ({ passwordHash: _hash, ...rest }: User): PublicUser => rest

export async function listUsers(): Promise<PublicUser[]> {
  const users = await db.users.toArray()
  return users.map(toPublic).sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export async function getUser(id: string): Promise<PublicUser | undefined> {
  const user = await db.users.get(id)
  return user && toPublic(user)
}

const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres.')
  .max(72, 'La contraseña es demasiado larga.')

const createSchema = z.object({
  name: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres.').max(80),
  email: z
    .string()
    .trim()
    .pipe(z.email('El correo no es válido.'))
    .transform((s) => s.toLowerCase()),
  password: passwordSchema,
  role: z.enum(['admin', 'user']),
  area: z.string().trim().max(60).default(''),
})

export type CreateUserInput = z.input<typeof createSchema>

export async function createUser(actor: Actor | null, input: CreateUserInput): Promise<PublicUser> {
  assertCan(actor, 'users:manage')
  const data = parseInput(createSchema, input)
  const passwordHash = await hashPassword(data.password) // fuera de la transacción
  try {
    return await runTx([db.users], async () => {
      const user: User = {
        id: newId(),
        name: data.name,
        email: data.email,
        passwordHash,
        role: data.role,
        status: 'active',
        area: data.area,
        createdAt: clock.iso(),
      }
      await db.users.add(user)
      await writeAudit(actor, 'users.create', 'user', user.id, `${user.email} (${user.role})`)
      return toPublic(user)
    })
  } catch (e) {
    if (isConstraintError(e)) throw conflict('Ya existe un usuario con ese correo.')
    throw e
  }
}

const updateSchema = z.object({
  name: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres.').max(80).optional(),
  area: z.string().trim().max(60).optional(),
  role: z.enum(['admin', 'user']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
})

export type UpdateUserInput = z.input<typeof updateSchema>

/** Siempre debe quedar al menos un administrador activo. */
async function activeAdminCount(): Promise<number> {
  return db.users.filter((u) => u.role === 'admin' && u.status === 'active').count()
}

export async function updateUser(actor: Actor | null, id: string, patch: UpdateUserInput): Promise<PublicUser> {
  assertCan(actor, 'users:manage')
  const data = parseInput(updateSchema, patch)
  return runTx([db.users], async () => {
    const user = await db.users.get(id)
    if (!user) throw notFound('Usuario no encontrado.')
    const losesAdmin =
      user.role === 'admin' &&
      user.status === 'active' &&
      ((data.role && data.role !== 'admin') || (data.status && data.status !== 'active'))
    if (losesAdmin && (await activeAdminCount()) <= 1) {
      throw conflict('No se puede quitar al último administrador activo.')
    }
    await db.users.update(id, data)
    await writeAudit(actor, 'users.update', 'user', id, JSON.stringify(data))
    return toPublic((await db.users.get(id))!)
  })
}

/** El usuario edita su propio perfil (nombre y área). */
export async function updateOwnProfile(
  actor: Actor | null,
  patch: { name?: string; area?: string },
): Promise<PublicUser> {
  assertCan(actor, 'profile:edit')
  const data = parseInput(updateSchema.pick({ name: true, area: true }), patch)
  return runTx([db.users], async () => {
    if (!(await db.users.get(actor.id))) throw notFound('Usuario no encontrado.')
    await db.users.update(actor.id, data)
    await writeAudit(actor, 'users.profile', 'user', actor.id)
    return toPublic((await db.users.get(actor.id))!)
  })
}

export async function changeOwnPassword(actor: Actor | null, current: string, next: string): Promise<void> {
  assertCan(actor, 'profile:edit')
  const newPassword = parseInput(passwordSchema, next)
  const user = await db.users.get(actor.id)
  if (!user) throw notFound('Usuario no encontrado.')
  if (!(await verifyPassword(current, user.passwordHash))) throw invalid('La contraseña actual no es correcta.')
  const passwordHash = await hashPassword(newPassword)
  await runTx([db.users], async () => {
    await db.users.update(actor.id, { passwordHash })
    await writeAudit(actor, 'users.password.change', 'user', actor.id)
  })
}

export async function resetUserPassword(actor: Actor | null, id: string, next: string): Promise<void> {
  assertCan(actor, 'users:manage')
  const newPassword = parseInput(passwordSchema, next)
  const passwordHash = await hashPassword(newPassword)
  await runTx([db.users], async () => {
    if (!(await db.users.get(id))) throw notFound('Usuario no encontrado.')
    await db.users.update(id, { passwordHash })
    await writeAudit(actor, 'users.password.reset', 'user', id)
  })
}
