import { beforeAll, describe, expect, it } from 'vitest'
import { authenticate } from '@/core/auth/authService'
import { clock } from '@/core/clock/clock'
import { MINUTE } from '@/core/dates'
import { db } from '@/core/db/db'
import { createRng } from '@/core/random'
import { loadSnapshot } from '@/modules/analytics/snapshot'
import {
  adminKpis,
  consumptionByDay,
  filamentUsedGrams,
  maintenanceCosts,
  printerStatusCounts,
  printerUtilization,
  requestFunnel,
  stockByCategory,
  topConsumed,
  userSummary,
} from '@/modules/analytics/metrics'
import { verifyLedger } from '@/modules/inventory/service'
import { loadAlerts } from '@/modules/notifications/alerts'
import { syncJobs } from '@/modules/printers/service'
import {
  getSimState,
  pauseSimulation,
  setScenario,
  setSimulationSpeed,
  startSimulation,
  stepSimulation,
  tickSimulation,
} from '@/modules/simulation/engine'
import type { SimCounters } from '@/modules/simulation/types'
import { admin, alice, resetDb } from '@/test/helpers'
import { DEMO_ACCOUNTS, DEMO_ADMIN_PASSWORD, DEMO_USER_PASSWORD, SEED_ITEMS, SEED_PRINTERS } from './data'
import { ensureSeeded, getLastSeedReport, resetDemoData } from './seed'

describe('datos de demostración', () => {
  beforeAll(async () => {
    await resetDb({ users: false })
    await ensureSeeded()
  })

  it('crea usuarios, catálogo, impresoras y un historial amplio', async () => {
    expect(await db.users.count()).toBe(DEMO_ACCOUNTS.length)
    expect(await db.items.count()).toBe(SEED_ITEMS.length)
    expect(await db.printers.count()).toBe(SEED_PRINTERS.length)
    expect(await db.requests.count()).toBeGreaterThanOrEqual(15)
    expect(await db.jobs.count()).toBeGreaterThanOrEqual(8)
    expect(await db.movements.count()).toBeGreaterThan(80)
    expect(await db.maintenance.count()).toBeGreaterThanOrEqual(3)
    expect(await db.notifications.count()).toBeGreaterThan(20)
    const report = getLastSeedReport()
    expect(report.operations).toBeGreaterThan(80)
    expect(report.skipped / report.operations).toBeLessThan(0.3) // el historial es casi todo válido
  })

  it('el inventario es coherente: el libro de movimientos cuadra con las existencias', async () => {
    const ledger = await verifyLedger()
    expect(ledger.issues).toEqual([])
    expect(ledger.ok).toBe(true)
    for (const item of await db.items.toArray()) {
      expect(item.onHand).toBeGreaterThanOrEqual(0)
      expect(item.reserved).toBeGreaterThanOrEqual(0)
      expect(item.reserved).toBeLessThanOrEqual(item.onHand)
    }
  })

  it('el estado presente es variado: solicitudes en cada estado, trabajo en curso, reserva afectada y alertas', async () => {
    const statuses = new Set((await db.requests.toArray()).map((r) => r.status))
    for (const s of ['pending', 'approved', 'delivered', 'closed', 'rejected', 'cancelled'] as const) expect(statuses).toContain(s)
    const running = await db.jobs.where('status').equals('printing').toArray()
    expect(running).toHaveLength(1)
    expect((await db.printers.get(running[0].printerId))!.status).toBe('printing')
    expect((await db.reservations.where('status').equals('affected').count())).toBeGreaterThanOrEqual(1)
    expect((await loadAlerts()).length).toBeGreaterThan(0)
    expect((await db.reservations.where('status').equals('confirmed').count())).toBeGreaterThanOrEqual(2)
  })

  it('las cuentas de demostración inician sesión con sus contraseñas ficticias', async () => {
    await expect(authenticate('admin@steam.demo', DEMO_ADMIN_PASSWORD)).resolves.toMatchObject({ role: 'admin' })
    await expect(authenticate('usuario@steam.demo', DEMO_USER_PASSWORD)).resolves.toMatchObject({ role: 'user' })
    await expect(authenticate('usuario@steam.demo', DEMO_ADMIN_PASSWORD)).rejects.toMatchObject({ code: 'AUTH' })
    await expect(authenticate('exalumno@steam.demo', DEMO_USER_PASSWORD)).rejects.toMatchObject({ code: 'AUTH' }) // desactivada
  })

  it('ninguna contraseña queda guardada en claro', async () => {
    const stored = JSON.stringify(await db.users.toArray())
    expect(stored).not.toContain(DEMO_ADMIN_PASSWORD)
    expect(stored).not.toContain(DEMO_USER_PASSWORD)
  })

  it('las métricas reflejan los datos (KPIs, series y resúmenes)', async () => {
    const s = await loadSnapshot()
    const k = adminKpis(s)
    expect(k.pendingRequests).toBe(s.requests.filter((r) => r.status === 'pending').length)
    expect(k.pendingRequests).toBeGreaterThanOrEqual(3)
    expect(k.printersTotal).toBe(4)
    expect(k.printersPrinting).toBe(1)
    expect(k.overdueReturns).toBeGreaterThanOrEqual(1)

    expect(requestFunnel(s).reduce((sum, r) => sum + r.count, 0)).toBe(s.requests.length)
    expect(printerStatusCounts(s).reduce((sum, r) => sum + r.count, 0)).toBe(4)
    expect(consumptionByDay(s, { days: 14, kinds: ['consumable', 'tool', 'equipment'] })).toHaveLength(14)
    expect(consumptionByDay(s, { days: 30, kinds: ['filament'] }).some((d) => d.value > 0)).toBe(true)
    expect(stockByCategory(s).length).toBeGreaterThan(3)
    expect(printerUtilization(s, 30).some((p) => p.hours > 0)).toBe(true)
    expect(maintenanceCosts(s).find((m) => m.type === 'Preventivo')!.count).toBeGreaterThanOrEqual(2)
    expect(topConsumed(s, { days: 30, limit: 5 }).length).toBeGreaterThan(0)
    expect(filamentUsedGrams(s, 30)).toBeGreaterThan(0)

    const sofia = userSummary(s, 'u-sofia')
    expect(sofia.runningJobs).toBe(1)
    expect(sofia.itemsOnLoan).toBeGreaterThanOrEqual(1)
  })

  it('el trabajo en curso avanza con el reloj y termina solo, sin romper el inventario', async () => {
    const [job] = await db.jobs.where('status').equals('printing').toArray()
    clock.freeze(Date.parse(job.startedAt) + (job.estimatedMinutes + 5) * MINUTE)
    await syncJobs()
    expect((await db.jobs.get(job.id))!.status).toBe('completed')
    expect((await verifyLedger()).ok).toBe(true)
    clock.resetToRealTime()
  })

  it('la simulación acelerada mantiene la coherencia durante muchos pasos y genera actividad', async () => {
    await resetDemoData(admin)
    clock.resetToRealTime()
    const before = {
      requests: await db.requests.count(),
      jobs: await db.jobs.count(),
      movements: await db.movements.count(),
    }
    const rng = createRng(7)
    const counters: SimCounters = { ticks: 0, requests: 0, approvals: 0, deliveries: 0, returns: 0, jobs: 0, failures: 0, restocks: 0 }
    const start = clock.nowMs()
    for (let i = 1; i <= 90; i++) {
      clock.freeze(start + i * 15 * MINUTE) // 22 h simuladas en pasos de 15 min
      await syncJobs()
      await stepSimulation(rng, 15, 'busy', counters)
    }
    clock.resetToRealTime()

    expect(counters.requests).toBeGreaterThan(5)
    expect(counters.approvals).toBeGreaterThan(0)
    expect(counters.jobs).toBeGreaterThan(0)
    expect(await db.requests.count()).toBeGreaterThan(before.requests)
    expect(await db.jobs.count()).toBeGreaterThan(before.jobs)
    expect(await db.movements.count()).toBeGreaterThan(before.movements)
    const ledger = await verifyLedger()
    expect(ledger.issues).toEqual([])
  })

  it('el escenario "equipos con problemas" provoca fallas que activan el mantenimiento correctivo', async () => {
    await resetDemoData(admin)
    clock.resetToRealTime()
    const rng = createRng(11)
    const counters: SimCounters = { ticks: 0, requests: 0, approvals: 0, deliveries: 0, returns: 0, jobs: 0, failures: 0, restocks: 0 }
    const correctivesBefore = await db.maintenance.where('type').equals('corrective').count()
    const start = clock.nowMs()
    for (let i = 1; i <= 60; i++) {
      clock.freeze(start + i * 20 * MINUTE)
      await syncJobs()
      await stepSimulation(rng, 20, 'incidents', counters)
    }
    clock.resetToRealTime()
    expect(counters.failures).toBeGreaterThan(0)
    expect(await db.maintenance.where('type').equals('corrective').count()).toBeGreaterThan(correctivesBefore)
    expect((await verifyLedger()).ok).toBe(true)
  })

  it('el control de la simulación exige ser administrador y persiste su estado', async () => {
    await resetDemoData(admin)
    clock.resetToRealTime()
    await expect(startSimulation(alice)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(pauseSimulation(alice)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(setScenario(alice, 'busy')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(resetDemoData(alice)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(setSimulationSpeed(admin, 7)).rejects.toMatchObject({ code: 'VALIDATION' })

    await setScenario(admin, 'shortage')
    await startSimulation(admin, { speed: 60 })
    expect(clock.speed()).toBe(60)
    expect(await getSimState()).toMatchObject({ running: true, speed: 60, scenario: 'shortage' })

    await setSimulationSpeed(admin, 300)
    expect(clock.speed()).toBe(300)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(await tickSimulation()).toBe(true) // pasó tiempo virtual: el motor ejecuta un paso
    expect((await getSimState()).counters.ticks).toBe(1)

    await pauseSimulation(admin)
    expect(clock.speed()).toBe(1)
    expect(await getSimState()).toMatchObject({ running: false })
    expect(await tickSimulation()).toBe(false) // en pausa no avanza
    clock.resetToRealTime()
  })
})
