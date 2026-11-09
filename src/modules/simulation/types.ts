export type Scenario = 'normal' | 'busy' | 'incidents' | 'shortage'

export const SCENARIO_LABEL: Record<Scenario, { name: string; description: string }> = {
  normal: { name: 'Jornada normal', description: 'Actividad moderada y pocas fallas.' },
  busy: { name: 'Semana de proyectos', description: 'Muchas solicitudes e impresiones simultáneas.' },
  incidents: { name: 'Equipos con problemas', description: 'Las impresoras fallan con frecuencia.' },
  shortage: { name: 'Escasez de material', description: 'No hay reposición automática: el stock se agota.' },
}

export const SIM_SPEEDS = [1, 10, 60, 300] as const

export interface SimCounters {
  ticks: number
  requests: number
  approvals: number
  deliveries: number
  returns: number
  jobs: number
  failures: number
  restocks: number
}

export interface SimState {
  id: 'main'
  running: boolean
  speed: number
  scenario: Scenario
  seed: number
  rngState: number
  /** Instante virtual guardado (ms) para restaurar el reloj al recargar. */
  virtualNow: number
  savedAtReal: number
  lastTickVirtual: number
  counters: SimCounters
}
