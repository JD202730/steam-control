import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { useNow } from '@/shared/hooks/hooks'
import type { Snapshot } from './metrics'
import { loadSnapshot } from './snapshot'

/**
 * Foto viva de los datos: se recalcula sola cuando cambia cualquier tabla (liveQuery) y su
 * "ahora" avanza con el reloj del sistema. Es lo que mantiene las gráficas y alertas al día.
 */
export function useSnapshot(): Snapshot | undefined {
  const snapshot = useLiveQuery(loadSnapshot, [])
  const now = useNow(5000)
  return useMemo(() => (snapshot ? { ...snapshot, nowMs: now } : undefined), [snapshot, now])
}
