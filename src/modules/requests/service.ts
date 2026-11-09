import { z } from 'zod'
import { clock } from '@/core/clock/clock'
import { addDaysToDay, isIsoDay, localDay } from '@/core/dates'
import { writeAudit } from '@/core/db/audit'
import { db, INVENTORY_TABLES } from '@/core/db/db'
import { runTx } from '@/core/db/tx'
import { conflict, forbidden, invalid, notFound } from '@/core/errors'
import { newId } from '@/core/ids'
import { assertCan, can, type Actor } from '@/core/permissions/roles'
import { parseInput } from '@/core/validation'
import { applyMovement } from '../inventory/service'
import { RETURNABLE_KINDS } from '../inventory/types'
import {
  REQUEST_STATUS_LABEL,
  REQUEST_TRANSITIONS,
  type RequestLine,
  type RequestStatus,
  type SupplyRequest,
} from './types'

const REQUEST_TABLES = [db.requests, db.requestLines] as const

/* -------------------------------------------------------------------------- */
/*  Lectura                                                                    */
/* -------------------------------------------------------------------------- */

export interface RequestWithLines {
  request: SupplyRequest
  lines: RequestLine[]
}

export async function listRequests(filter: { requesterId?: string; status?: RequestStatus } = {}): Promise<SupplyRequest[]> {
  let rows = filter.requesterId
    ? await db.requests.where('requesterId').equals(filter.requesterId).toArray()
    : await db.requests.toArray()
  if (filter.status) rows = rows.filter((r) => r.status === filter.status)
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getRequest(id: string): Promise<RequestWithLines | undefined> {
  const request = await db.requests.get(id)
  if (!request) return undefined
  return { request, lines: await db.requestLines.where('requestId').equals(id).toArray() }
}

/** Solicitud entregada con devoluciones pendientes y fecha límite vencida. */
export function isReturnOverdue(request: SupplyRequest, nowMs: number): boolean {
  return request.status === 'delivered' && request.returnBy < localDay(nowMs)
}

/* -------------------------------------------------------------------------- */
/*  Máquina de estados                                                         */
/* -------------------------------------------------------------------------- */

function assertTransition(request: SupplyRequest, to: RequestStatus): void {
  if (!REQUEST_TRANSITIONS[request.status].includes(to)) {
    throw conflict(
      `Una solicitud "${REQUEST_STATUS_LABEL[request.status].toLowerCase()}" no puede pasar a "${REQUEST_STATUS_LABEL[to].toLowerCase()}".`,
    )
  }
}

/**
 * Carga la solicitud y sus líneas DENTRO de una transacción. Importante: espera directamente a
 * Dexie (sin llamar a otra función async), porque Dexie pierde el rastro de la transacción si se
 * anidan funciones async dentro de otras (ver el aviso en core/db/tx.ts).
 */
async function loadOrThrow(id: string): Promise<RequestWithLines> {
  const request = await db.requests.get(id)
  if (!request) throw notFound('Solicitud no encontrada.')
  const lines = await db.requestLines.where('requestId').equals(id).toArray()
  return { request, lines }
}

/* -------------------------------------------------------------------------- */
/*  Escritura                                                                  */
/* -------------------------------------------------------------------------- */

const dayField = (message: string) => z.string().refine(isIsoDay, message)

const createSchema = z.object({
  purpose: z.string().trim().min(5, 'Describe el propósito (mín. 5 caracteres).').max(200),
  neededBy: dayField('La fecha en que lo necesitas no es válida: revisa el día, el mes y el año.'),
  returnBy: dayField('La fecha de devolución no es válida: revisa el día, el mes y el año, o déjala vacía.').optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qty: z.number('La cantidad debe ser un número.').int('La cantidad debe ser un entero.').min(1, 'La cantidad mínima es 1.'),
      }),
    )
    .min(1, 'Agrega al menos un artículo.')
    .max(15, 'Máximo 15 artículos por solicitud.'),
})

export type CreateRequestInput = z.input<typeof createSchema>

export async function createRequest(actor: Actor | null, input: CreateRequestInput): Promise<SupplyRequest> {
  assertCan(actor, 'requests:create')
  const data = parseInput(createSchema, input)
  const today = localDay(clock.nowMs())
  if (data.neededBy < today) throw invalid('La fecha en que lo necesitas no puede estar en el pasado.')
  const returnBy = data.returnBy ?? addDaysToDay(data.neededBy, 7)
  if (returnBy < data.neededBy) throw invalid('La fecha de devolución no puede ser anterior a la fecha en que lo necesitas.')

  // Une líneas repetidas del mismo artículo.
  const merged = new Map<string, number>()
  for (const l of data.lines) merged.set(l.itemId, (merged.get(l.itemId) ?? 0) + l.qty)

  return runTx([...REQUEST_TABLES, db.items], async (ctx) => {
    const id = newId()
    const now = clock.iso()
    const lines: RequestLine[] = []
    for (const [itemId, qty] of merged) {
      const item = await db.items.get(itemId)
      if (!item || !item.active) throw notFound('Uno de los artículos ya no está disponible.')
      if (qty > item.onHand) {
        throw conflict(`"${item.name}": solo hay ${item.onHand} ${item.unit} en existencia (pediste ${qty}).`)
      }
      lines.push({
        id: newId(),
        requestId: id,
        itemId,
        qty,
        qtyDelivered: 0,
        qtyReturned: 0,
        returnable: RETURNABLE_KINDS.includes(item.kind),
      })
    }
    const request: SupplyRequest = {
      id,
      requesterId: actor.id,
      purpose: data.purpose,
      neededBy: data.neededBy,
      returnBy,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }
    await db.requests.add(request)
    await db.requestLines.bulkAdd(lines)
    await writeAudit(actor, 'requests.create', 'request', id, data.purpose)
    ctx.emit({ type: 'request.created', requestId: id, requesterId: actor.id })
    return request
  })
}

/** Aprueba y RESERVA el stock de todas las líneas. Todo o nada: si falta algo, no se aprueba nada. */
export async function approveRequest(actor: Actor | null, id: string, note?: string): Promise<SupplyRequest> {
  assertCan(actor, 'requests:manage')
  return runTx([...REQUEST_TABLES, ...INVENTORY_TABLES], async (ctx) => {
    const { request, lines } = await loadOrThrow(id)
    assertTransition(request, 'approved')
    for (const line of lines) {
      await applyMovement(ctx, actor.id, {
        itemId: line.itemId,
        type: 'reserve',
        qty: line.qty,
        reason: 'Reserva por solicitud aprobada',
        refType: 'request',
        refId: id,
      })
    }
    const now = clock.iso()
    await db.requests.update(id, {
      status: 'approved',
      decidedBy: actor.id,
      decidedAt: now,
      decisionNote: note?.trim() || undefined,
      updatedAt: now,
    })
    await writeAudit(actor, 'requests.approve', 'request', id)
    ctx.emit({ type: 'request.approved', requestId: id, requesterId: request.requesterId, actorId: actor.id })
    return (await db.requests.get(id))!
  })
}

export async function rejectRequest(actor: Actor | null, id: string, note: string): Promise<SupplyRequest> {
  assertCan(actor, 'requests:manage')
  const reason = parseInput(z.string().trim().min(3, 'Indica el motivo del rechazo.').max(200), note)
  return runTx([...REQUEST_TABLES], async (ctx) => {
    const { request } = await loadOrThrow(id)
    assertTransition(request, 'rejected')
    const now = clock.iso()
    await db.requests.update(id, { status: 'rejected', decidedBy: actor.id, decidedAt: now, decisionNote: reason, updatedAt: now })
    await writeAudit(actor, 'requests.reject', 'request', id, reason)
    ctx.emit({ type: 'request.rejected', requestId: id, requesterId: request.requesterId, actorId: actor.id })
    return (await db.requests.get(id))!
  })
}

/** Cancela la solicitud (su dueño o un administrador). Si estaba aprobada, libera el stock reservado. */
export async function cancelRequest(actor: Actor | null, id: string): Promise<SupplyRequest> {
  if (!actor) throw forbidden()
  return runTx([...REQUEST_TABLES, ...INVENTORY_TABLES], async (ctx) => {
    const { request, lines } = await loadOrThrow(id)
    if (request.requesterId !== actor.id && !can(actor, 'requests:manage')) throw forbidden()
    assertTransition(request, 'cancelled')
    if (request.status === 'approved') {
      for (const line of lines) {
        await applyMovement(ctx, actor.id, {
          itemId: line.itemId,
          type: 'release',
          qty: line.qty,
          reason: 'Reserva liberada por cancelación',
          refType: 'request',
          refId: id,
        })
      }
    }
    await db.requests.update(id, { status: 'cancelled', updatedAt: clock.iso() })
    await writeAudit(actor, 'requests.cancel', 'request', id)
    ctx.emit({ type: 'request.cancelled', requestId: id, requesterId: request.requesterId, actorId: actor.id })
    return (await db.requests.get(id))!
  })
}

/** Entrega lo reservado: el stock sale del almacén. Sin nada que devolver, la solicitud se cierra. */
export async function deliverRequest(actor: Actor | null, id: string): Promise<SupplyRequest> {
  assertCan(actor, 'requests:manage')
  return runTx([...REQUEST_TABLES, ...INVENTORY_TABLES], async (ctx) => {
    const { request, lines } = await loadOrThrow(id)
    assertTransition(request, 'delivered')
    for (const line of lines) {
      await applyMovement(ctx, actor.id, {
        itemId: line.itemId,
        type: 'issue',
        qty: line.qty,
        reason: 'Entrega de solicitud',
        refType: 'request',
        refId: id,
      })
      await db.requestLines.update(line.id, { qtyDelivered: line.qty })
    }
    const now = clock.iso()
    const nothingToReturn = lines.every((l) => !l.returnable)
    await db.requests.update(id, {
      status: nothingToReturn ? 'closed' : 'delivered',
      deliveredAt: now,
      closedAt: nothingToReturn ? now : undefined,
      updatedAt: now,
    })
    await writeAudit(actor, 'requests.deliver', 'request', id)
    ctx.emit({ type: 'request.delivered', requestId: id, requesterId: request.requesterId, actorId: actor.id })
    if (nothingToReturn) {
      ctx.emit({ type: 'request.closed', requestId: id, requesterId: request.requesterId, actorId: actor.id })
    }
    return (await db.requests.get(id))!
  })
}

/** Registra la devolución de una herramienta/equipo. Al devolver todo, la solicitud se cierra. */
export async function returnLine(actor: Actor | null, requestId: string, lineId: string, qty: number): Promise<SupplyRequest> {
  assertCan(actor, 'requests:manage')
  const amount = parseInput(z.number().int('La cantidad debe ser un entero.').min(1, 'La cantidad mínima es 1.'), qty)
  return runTx([...REQUEST_TABLES, ...INVENTORY_TABLES], async (ctx) => {
    const { request, lines } = await loadOrThrow(requestId)
    if (request.status !== 'delivered') throw conflict('Solo se pueden registrar devoluciones de solicitudes entregadas.')
    const line = lines.find((l) => l.id === lineId)
    if (!line) throw notFound('Línea no encontrada.')
    if (!line.returnable) throw conflict('Este artículo es consumible y no se devuelve.')
    const pending = line.qtyDelivered - line.qtyReturned
    if (amount > pending) throw conflict(`Solo quedan ${pending} por devolver.`)

    await applyMovement(ctx, actor.id, {
      itemId: line.itemId,
      type: 'return',
      qty: amount,
      reason: 'Devolución de solicitud',
      refType: 'request',
      refId: requestId,
    })
    await db.requestLines.update(line.id, { qtyReturned: line.qtyReturned + amount })

    const allReturned = lines.every((l) => !l.returnable || (l.id === lineId ? l.qtyReturned + amount : l.qtyReturned) >= l.qtyDelivered)
    if (allReturned) {
      const now = clock.iso()
      await db.requests.update(requestId, { status: 'closed', closedAt: now, updatedAt: now })
      ctx.emit({ type: 'request.closed', requestId, requesterId: request.requesterId, actorId: actor.id })
    }
    await writeAudit(actor, 'requests.return', 'request', requestId, `${amount}`)
    return (await db.requests.get(requestId))!
  })
}
