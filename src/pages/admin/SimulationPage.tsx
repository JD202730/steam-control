import { useLiveQuery } from 'dexie-react-hooks'
import { Activity, Pause, Play, RotateCcw, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useSession } from '@/core/auth/session'
import { clock } from '@/core/clock/clock'
import { db } from '@/core/db/db'
import { verifyLedger } from '@/modules/inventory/service'
import { useById, useUsers } from '@/modules/data-hooks'
import { pauseSimulation, setScenario, setSimulationSpeed, startSimulation } from '@/modules/simulation/engine'
import { SCENARIO_LABEL, SIM_SPEEDS, type Scenario } from '@/modules/simulation/types'
import { resetDemoData } from '@/seed/seed'
import { useAction, useNow, useRequiredActor } from '@/shared/hooks/hooks'
import { fmtAgo, fmtDateTime, fmtNumber } from '@/shared/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/ui/Card'
import { ConfirmModal, Modal } from '@/shared/ui/Modal'
import { PageHeader, Spinner } from '@/shared/ui/Misc'

const ACTION_LABEL: Record<string, string> = {
  'requests.create': 'Solicitud creada',
  'requests.approve': 'Solicitud aprobada (stock reservado)',
  'requests.reject': 'Solicitud rechazada',
  'requests.cancel': 'Solicitud cancelada',
  'requests.deliver': 'Material entregado',
  'requests.return': 'Devolución registrada',
  'reservations.create': 'Reserva de impresora',
  'reservations.cancel': 'Reserva cancelada',
  'jobs.start': 'Impresión iniciada',
  'jobs.cancel': 'Impresión cancelada',
  'printers.failure': 'Falla de impresora',
  'maintenance.schedule': 'Mantenimiento programado',
  'maintenance.start': 'Mantenimiento iniciado',
  'maintenance.part': 'Repuesto usado',
  'maintenance.complete': 'Mantenimiento completado',
  'inventory.stock.in': 'Entrada de stock',
  'inventory.stock.adjust': 'Ajuste de stock',
}

const SPEED_LABEL: Record<number, string> = { 1: '×1 · tiempo real', 10: '×10', 60: '×60', 300: '×300' }

export default function SimulationPage() {
  const actor = useRequiredActor()
  const refreshSession = useSession((s) => s.refresh)
  const sim = useLiveQuery(() => db.sim.get('main'), [])
  const audit = useLiveQuery(() => db.audit.orderBy('at').reverse().limit(14).toArray(), [])
  const userById = useById(useUsers())
  const now = useNow(1000)
  const { run, pending } = useAction()
  const [confirmReset, setConfirmReset] = useState(false)
  const [ledger, setLedger] = useState<{ ok: boolean; checked: number; problems: string[] } | null>(null)

  if (!sim) return <Spinner />

  const counters: [string, number][] = [
    ['Solicitudes creadas', sim.counters.requests],
    ['Aprobaciones', sim.counters.approvals],
    ['Entregas', sim.counters.deliveries],
    ['Devoluciones', sim.counters.returns],
    ['Impresiones iniciadas', sim.counters.jobs],
    ['Fallas de impresoras', sim.counters.failures],
    ['Reposiciones de stock', sim.counters.restocks],
    ['Pasos de simulación', sim.counters.ticks],
  ]

  return (
    <>
      <PageHeader
        title="Simulación"
        subtitle="Acelera el tiempo y deja que la sala “viva”: llegan solicitudes, se imprime, las máquinas fallan y se reponen materiales. Todo pasa por las mismas reglas que usas tú."
        actions={
          sim.running ? (
            <Button onClick={() => run(() => pauseSimulation(actor), 'Simulación en pausa.')} icon={<Pause className="size-4" />}>
              Pausar simulación
            </Button>
          ) : (
            <Button variant="primary" onClick={() => run(() => startSimulation(actor), 'Simulación en marcha.')} icon={<Play className="size-4" />}>
              Iniciar simulación
            </Button>
          )
        }
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Control" subtitle="Los cambios se aplican al instante." actions={sim.running ? <Badge tone="ok">En marcha ×{sim.speed}</Badge> : <Badge>En pausa</Badge>} />
          <CardBody className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg bg-surface-2 p-4">
                <p className="text-xs text-muted">Hora de la sala (simulada)</p>
                <p className="num font-display text-2xl font-semibold">{fmtDateTime(new Date(now).toISOString())}</p>
              </div>
              <div className="rounded-lg bg-surface-2 p-4">
                <p className="text-xs text-muted">Velocidad del reloj</p>
                <p className="num font-display text-2xl font-semibold">×{clock.speed()}</p>
                <p className="text-xs text-muted">{clock.speed() === 1 ? 'Tiempo real' : `1 segundo real = ${clock.speed()} segundos de la sala`}</p>
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Velocidad</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Velocidad de la simulación">
                {SIM_SPEEDS.map((s) => (
                  <Button key={s} role="radio" aria-checked={sim.speed === s} variant={sim.speed === s ? 'primary' : 'secondary'} onClick={() => run(() => setSimulationSpeed(actor, s))}>
                    {SPEED_LABEL[s]}
                  </Button>
                ))}
              </div>
              {!sim.running && <p className="mt-2 text-xs text-muted">La velocidad elegida se usará al iniciar la simulación.</p>}
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Escenario</p>
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Escenario">
                {(Object.keys(SCENARIO_LABEL) as Scenario[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={sim.scenario === s}
                    onClick={() => run(() => setScenario(actor, s))}
                    className={`rounded-lg border p-3 text-left transition-colors ${sim.scenario === s ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong'}`}
                  >
                    <span className="block font-medium">{SCENARIO_LABEL[s].name}</span>
                    <span className="block text-sm text-ink-2">{SCENARIO_LABEL[s].description}</span>
                  </button>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Lo que ha pasado" subtitle="Desde la última reiniciada" />
          <ul className="divide-y divide-line">
            {counters.map(([label, value]) => (
              <li key={label} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span className="text-ink-2">{label}</span>
                <span className="num font-semibold">{fmtNumber(value)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Actividad reciente" subtitle="Cada acción queda en la bitácora, la haga una persona o el simulador" />
          {!audit?.length ? (
            <p className="px-5 py-8 text-center text-sm text-muted">Sin actividad todavía.</p>
          ) : (
            <ul className="divide-y divide-line">
              {audit.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                  <Activity className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{ACTION_LABEL[a.action] ?? a.action}</p>
                    <p className="truncate text-xs text-muted">
                      {a.actorId === 'system' ? 'Simulador' : (userById.get(a.actorId)?.name ?? a.actorName)}
                      {a.detail ? ` · ${a.detail}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted">{fmtAgo(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Herramientas" />
          <CardBody className="space-y-3">
            <Button
              className="w-full"
              icon={<ShieldCheck className="size-4" />}
              onClick={async () => {
                const report = await run(() => verifyLedger())
                if (report) setLedger({ ok: report.ok, checked: report.checked, problems: report.issues.map((i) => `${i.name}: ${i.problem}`) })
              }}
            >
              Verificar coherencia del inventario
            </Button>
            <Button className="w-full" variant="danger" icon={<RotateCcw className="size-4" />} onClick={() => setConfirmReset(true)}>
              Restablecer datos de demostración
            </Button>
            <p className="text-xs text-muted">Restablecer borra todo lo que hay en este navegador y vuelve a generar el historial de ejemplo.</p>
          </CardBody>
        </Card>
      </div>

      <ConfirmModal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="¿Restablecer los datos de demostración?"
        message="Se borrarán solicitudes, reservas, movimientos y notificaciones, y se generará un historial nuevo. Esta acción no se puede deshacer."
        confirmLabel="Restablecer"
        danger
        loading={pending}
        onConfirm={async () => {
          await run(() => resetDemoData(actor), 'Datos de demostración restablecidos.')
          await refreshSession()
          setConfirmReset(false)
        }}
      />
      {ledger && (
        <Modal open onClose={() => setLedger(null)} size="sm" title={ledger.ok ? 'Inventario coherente' : 'Se encontraron diferencias'} footer={<Button onClick={() => setLedger(null)}>Cerrar</Button>}>
          {ledger.ok ? (
            <p className="text-sm text-ink-2">Se recalcularon las existencias de {ledger.checked} artículos desde el libro de movimientos y todas coinciden, incluso con la simulación en marcha.</p>
          ) : (
            <ul className="space-y-2 text-sm text-bad">
              {ledger.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </>
  )
}
