import { forbidden } from '../errors'

export type Role = 'admin' | 'user'

/** Quien ejecuta una acción. Todos los servicios lo reciben como primer argumento. */
export interface Actor {
  id: string
  name: string
  role: Role
}

/** Actor interno para el simulador y los procesos automáticos. */
export const SYSTEM_ACTOR: Actor = { id: 'system', name: 'Sistema', role: 'admin' }

export const PERMISSIONS = [
  'inventory:read',
  'inventory:write',
  'inventory:adjust',
  'requests:create',
  'requests:manage',
  'printers:read',
  'printers:manage',
  'reservations:create',
  'reservations:manage',
  'jobs:run',
  'maintenance:read',
  'maintenance:manage',
  'users:manage',
  'notifications:read',
  'alerts:manage',
  'analytics:admin',
  'simulation:control',
  'profile:edit',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const USER_PERMISSIONS: readonly Permission[] = [
  'inventory:read',
  'requests:create',
  'printers:read',
  'reservations:create',
  'jobs:run',
  'maintenance:read',
  'notifications:read',
  'profile:edit',
]

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(PERMISSIONS),
  user: new Set(USER_PERMISSIONS),
}

export function can(actor: Pick<Actor, 'role'> | null | undefined, permission: Permission): boolean {
  return !!actor && ROLE_PERMISSIONS[actor.role].has(permission)
}

/** Lanza ForbiddenError si el actor no tiene el permiso. Se llama al inicio de cada servicio. */
export function assertCan(actor: Actor | null | undefined, permission: Permission): asserts actor is Actor {
  if (!can(actor, permission)) throw forbidden()
}

export const ROLE_LABEL: Record<Role, string> = { admin: 'Administrador', user: 'Usuario' }
