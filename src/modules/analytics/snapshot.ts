import { clock } from '@/core/clock/clock'
import { db } from '@/core/db/db'
import type { Snapshot } from './metrics'

/** Lee de una vez las tablas que usan las métricas. Con useLiveQuery se recalcula al cambiar cualquiera. */
export async function loadSnapshot(): Promise<Snapshot> {
  const [categories, items, movements, requests, lines, printers, reservations, jobs, tasks] = await Promise.all([
    db.categories.toArray(),
    db.items.toArray(),
    db.movements.toArray(),
    db.requests.toArray(),
    db.requestLines.toArray(),
    db.printers.toArray(),
    db.reservations.toArray(),
    db.jobs.toArray(),
    db.maintenance.toArray(),
  ])
  return { categories, items, movements, requests, lines, printers, reservations, jobs, tasks, nowMs: clock.nowMs() }
}
