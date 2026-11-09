import { clock } from '@/core/clock/clock'
import { pruneAlertAcks } from '@/modules/notifications/alerts'
import { expireReservations, syncJobs } from '@/modules/printers/service'
import { getSimState, saveClock, tickSimulation } from '@/modules/simulation/engine'

/**
 * Proceso en segundo plano (cada segundo): avanza los trabajos de impresión según el reloj,
 * vence reservas, ejecuta un paso de la simulación y limpia reconocimientos de alertas.
 *
 * Con varias pestañas abiertas solo UNA lo ejecuta (la que obtiene el bloqueo "steam-runtime");
 * las demás solo sincronizan su reloj con el estado guardado, así todas ven la misma hora.
 */
export function startRuntime(): () => void {
  let stopped = false
  let busy = false
  let ticks = 0
  let leader = !('locks' in navigator)
  let releaseLock: (() => void) | undefined

  if (!leader) {
    void navigator.locks.request(
      'steam-runtime',
      () =>
        new Promise<void>((resolve) => {
          leader = true
          releaseLock = resolve
        }),
    )
  }

  const followClock = async () => {
    const sim = await getSimState()
    const speed = sim.running ? sim.speed : 1
    const expected = sim.virtualNow + (Date.now() - sim.savedAtReal) * speed
    if (Math.abs(expected - clock.nowMs()) > 2500 || clock.speed() !== speed) clock.restore(expected, speed)
  }

  const run = async () => {
    if (busy || stopped) return
    busy = true
    try {
      if (leader) {
        await syncJobs()
        await expireReservations()
        await tickSimulation()
        ticks++
        if (ticks % 5 === 0) {
          await saveClock()
          await pruneAlertAcks()
        }
      } else {
        await followClock()
      }
    } catch (error) {
      console.error('[runtime]', error)
    } finally {
      busy = false
    }
  }

  const id = window.setInterval(run, 1000)
  void run()
  return () => {
    stopped = true
    window.clearInterval(id)
    releaseLock?.()
  }
}
