/**
 * Reloj del sistema. Todo el dominio lee la hora de aquí (nunca de Date.now() directamente),
 * lo que permite:
 *  - acelerar el tiempo en el simulador (x10, x60...),
 *  - "viajar en el tiempo" al generar el historial de demostración,
 *  - pruebas deterministas congelando la hora.
 */
interface Anchor {
  real: number
  virtual: number
  speed: number
}

let anchor: Anchor = { real: Date.now(), virtual: Date.now(), speed: 1 }
let frozen: number | null = null

export const clock = {
  nowMs(): number {
    if (frozen !== null) return frozen
    return anchor.virtual + (Date.now() - anchor.real) * anchor.speed
  },
  now(): Date {
    return new Date(clock.nowMs())
  },
  iso(): string {
    return new Date(clock.nowMs()).toISOString()
  },
  speed(): number {
    return anchor.speed
  },
  /** Cambia la velocidad sin saltos: el instante actual se mantiene. */
  setSpeed(speed: number): void {
    anchor = { real: Date.now(), virtual: clock.nowMs(), speed }
  },
  /** Restaura el reloj desde un instante virtual guardado. */
  restore(virtualMs: number, speed = 1): void {
    anchor = { real: Date.now(), virtual: virtualMs, speed }
    frozen = null
  },
  resetToRealTime(): void {
    anchor = { real: Date.now(), virtual: Date.now(), speed: 1 }
    frozen = null
  },
  /** Congela el reloj en un instante (pruebas y generación de historial). */
  freeze(at: Date | number | string): void {
    frozen = new Date(at).getTime()
  },
  unfreeze(): void {
    frozen = null
  },
  isFrozen(): boolean {
    return frozen !== null
  },
}
