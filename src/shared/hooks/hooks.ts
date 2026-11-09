import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '@/core/auth/session'
import { clock } from '@/core/clock/clock'
import { errorMessage } from '@/core/errors'
import type { Actor } from '@/core/permissions/roles'
import { useToast } from '../ui/Toast'

/** Hora del sistema (puede ir acelerada por el simulador), refrescada cada `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => clock.nowMs())
  useEffect(() => {
    const id = window.setInterval(() => setNow(clock.nowMs()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

/** Quien ha iniciado sesión, como "actor" para los servicios. */
export function useActor(): Actor | null {
  const user = useSession((s) => s.user)
  return useMemo(() => (user ? { id: user.id, name: user.name, role: user.role } : null), [user])
}

/** Igual que useActor, para páginas que solo se muestran con sesión iniciada. */
export function useRequiredActor(): Actor {
  const actor = useActor()
  if (!actor) throw new Error('Se necesita una sesión iniciada.')
  return actor
}

/** Ejecuta una acción de un servicio mostrando un aviso de éxito o el error legible. */
export function useAction() {
  const toast = useToast()
  const [pending, setPending] = useState(false)
  const run = useCallback(
    async <T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setPending(true)
      try {
        const result = await fn()
        if (success) toast.success(success)
        return result
      } catch (error) {
        toast.error(errorMessage(error))
        return undefined
      } finally {
        setPending(false)
      }
    },
    [toast],
  )
  return { run, pending }
}

const THEME_KEY = 'steam-theme'

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem(THEME_KEY, next ? 'dark' : 'light')
    } catch {
      /* sin almacenamiento: el tema solo dura esta visita */
    }
    setDark(next)
  }, [])
  return { dark, toggle }
}
