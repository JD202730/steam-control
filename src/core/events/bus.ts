import type { DomainEvent, EventOf, EventType } from './types'

type Handler<T extends EventType> = (event: EventOf<T>) => void | Promise<void>
type AnyHandler = (event: DomainEvent) => void | Promise<void>

const handlers = new Map<EventType, Set<AnyHandler>>()

/**
 * Bus de eventos tipado. Los eventos se publican DESPUÉS de confirmar la transacción
 * (ver runTx), de modo que quien reacciona siempre ve datos ya consistentes.
 */
export const bus = {
  on<T extends EventType>(type: T, handler: Handler<T>): () => void {
    const set = handlers.get(type) ?? new Set<AnyHandler>()
    const wrapped = handler as unknown as AnyHandler
    set.add(wrapped)
    handlers.set(type, set)
    return () => {
      set.delete(wrapped)
    }
  },

  /** Publica un evento y espera a todos sus manejadores. Un manejador que falla no rompe al resto. */
  async emit(event: DomainEvent): Promise<void> {
    const set = handlers.get(event.type)
    if (!set) return
    for (const handler of [...set]) {
      try {
        await handler(event)
      } catch (error) {
        console.error(`[bus] error en el manejador de "${event.type}"`, error)
      }
    }
  },

  async emitAll(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) await bus.emit(event)
  },

  /** Solo para pruebas. */
  clear(): void {
    handlers.clear()
  },
}
