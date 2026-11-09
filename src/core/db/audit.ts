import { clock } from '../clock/clock'
import { newId } from '../ids'
import type { Actor } from '../permissions/roles'
import { db } from './db'

/** Registra una acción en la bitácora. Debe llamarse dentro de runTx (la tabla ya está incluida). */
export async function writeAudit(
  actor: Actor,
  action: string,
  entity: string,
  entityId: string,
  detail?: string,
): Promise<void> {
  await db.audit.add({
    id: newId(),
    at: clock.iso(),
    actorId: actor.id,
    actorName: actor.name,
    action,
    entity,
    entityId,
    detail,
  })
}
