import type { Table } from 'dexie'
import { bus } from '../events/bus'
import type { DomainEvent } from '../events/types'
import { db } from './db'

export interface TxContext {
  /** Encola un evento; se publica al confirmar la transacción. */
  emit(event: DomainEvent): void
}

/**
 * Ejecuta `fn` en UNA transacción atómica: si algo falla, no se guarda nada.
 * Los eventos de dominio se publican solo después de confirmar, así quienes
 * reaccionan (notificaciones, mantenimiento...) siempre ven datos consistentes.
 *
 * REGLAS (limitación conocida de Dexie con async/await nativo):
 *  1. Dentro de `fn` solo se usan las tablas declaradas (la de auditoría se añade sola).
 *  2. No se espera nada ajeno a Dexie (fetch, crypto, timers...): cerraría la transacción.
 *  3. `fn` puede llamar a funciones auxiliares async (applyMovement, writeAudit...) pero ESAS
 *     auxiliares solo deben esperar operaciones de Dexie, nunca otra función async propia:
 *     si se anidan dos niveles, Dexie pierde la transacción y lanza PrematureCommitError.
 *     Las pruebas de cada servicio recorren todas las rutas para detectarlo.
 */
export async function runTx<T>(tables: readonly Table[], fn: (ctx: TxContext) => Promise<T>): Promise<T> {
  const events: DomainEvent[] = []
  const ctx: TxContext = {
    emit: (event) => {
      events.push(event)
    },
  }
  const result = await db.transaction('rw', [...tables, db.audit], () => fn(ctx))
  await bus.emitAll(events)
  return result
}
