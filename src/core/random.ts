/** Generador pseudoaleatorio con semilla (mulberry32): la simulación es reproducible. */
export interface Rng {
  /** Número en [0, 1). */
  next(): number
  /** Entero en [min, max], ambos incluidos. */
  int(min: number, max: number): number
  pick<T>(items: readonly T[]): T
  chance(probability: number): boolean
  /** Estado interno, para poder guardarlo y reanudar la secuencia. */
  getState(): number
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0

  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
    getState: () => a,
  }
}
