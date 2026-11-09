import { useSession } from '@/core/auth/session'
import { initSimulationClock } from '@/modules/simulation/engine'
import { ensureSeeded } from '@/seed/seed'
import { registerAllHandlers } from './handlers'

let booting: Promise<void> | null = null

/** Arranque único: conecta los módulos, carga los datos de demostración y restaura el reloj y la sesión. */
export function bootstrap(): Promise<void> {
  booting ??= (async () => {
    registerAllHandlers()
    await ensureSeeded()
    await initSimulationClock()
    await useSession.getState().refresh()
  })()
  return booting
}
