import type { ReactNode } from 'react'
import { useSession } from '../auth/session'
import { can, type Permission } from './roles'

/** Muestra su contenido solo si la persona con sesión iniciada tiene el permiso (la UI nunca es la única barrera: los servicios también lo exigen). */
export function Can({ permission, children, fallback = null }: { permission: Permission; children: ReactNode; fallback?: ReactNode }) {
  const user = useSession((s) => s.user)
  return <>{can(user, permission) ? children : fallback}</>
}
