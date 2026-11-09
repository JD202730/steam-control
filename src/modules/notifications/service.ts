import { clock } from '@/core/clock/clock'
import { db } from '@/core/db/db'
import { bus } from '@/core/events/bus'
import { forbidden, notFound } from '@/core/errors'
import { newId } from '@/core/ids'
import { assertCan, type Actor } from '@/core/permissions/roles'
import type { Notification } from './types'

/* -------------------------------------------------------------------------- */
/*  Lectura                                                                    */
/* -------------------------------------------------------------------------- */

export async function listNotifications(userId: string, limit = 200): Promise<Notification[]> {
  const rows = await db.notifications.where('userId').equals(userId).toArray()
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
}

export const countUnread = (userId: string): Promise<number> =>
  db.notifications
    .where('userId')
    .equals(userId)
    .filter((n) => !n.readAt)
    .count()

/* -------------------------------------------------------------------------- */
/*  Escritura                                                                  */
/* -------------------------------------------------------------------------- */

export async function markRead(actor: Actor | null, id: string): Promise<void> {
  assertCan(actor, 'notifications:read')
  const n = await db.notifications.get(id)
  if (!n) throw notFound('Notificación no encontrada.')
  if (n.userId !== actor.id) throw forbidden()
  if (!n.readAt) await db.notifications.update(id, { readAt: clock.iso() })
}

export async function markAllRead(actor: Actor | null): Promise<void> {
  assertCan(actor, 'notifications:read')
  const now = clock.iso()
  await db.notifications
    .where('userId')
    .equals(actor.id)
    .filter((n) => !n.readAt)
    .modify({ readAt: now })
}

/* -------------------------------------------------------------------------- */
/*  Reacción a eventos de dominio                                              */
/* -------------------------------------------------------------------------- */

type Draft = Omit<Notification, 'id' | 'userId' | 'createdAt' | 'readAt'>

async function adminIds(): Promise<string[]> {
  const admins = await db.users.filter((u) => u.role === 'admin' && u.status === 'active').toArray()
  return admins.map((u) => u.id)
}

async function nameOf(userId: string): Promise<string> {
  return (await db.users.get(userId))?.name ?? 'Alguien'
}

async function push(userIds: string[], draft: Draft): Promise<void> {
  const recipients = [...new Set(userIds)].filter((id) => id !== 'system')
  if (!recipients.length) return
  const createdAt = clock.iso()
  await db.notifications.bulkAdd(recipients.map((userId) => ({ id: newId(), userId, createdAt, ...draft })))
}

/** Convierte los eventos de los demás módulos en notificaciones para quien corresponda. */
export function registerNotificationHandlers(): () => void {
  const offs = [
    bus.on('request.created', async (e) => {
      const request = await db.requests.get(e.requestId)
      await push(await adminIds(), {
        kind: 'request.created',
        severity: 'info',
        title: 'Nueva solicitud de material',
        body: `${await nameOf(e.requesterId)} solicitó: ${request?.purpose ?? ''}`,
        refType: 'request',
        refId: e.requestId,
      })
    }),
    bus.on('request.approved', (e) =>
      push([e.requesterId], {
        kind: 'request.approved',
        severity: 'success',
        title: 'Solicitud aprobada',
        body: 'Tu material está reservado. Pasa por la Sala STEAM a recogerlo.',
        refType: 'request',
        refId: e.requestId,
      }),
    ),
    bus.on('request.rejected', async (e) => {
      const request = await db.requests.get(e.requestId)
      await push([e.requesterId], {
        kind: 'request.rejected',
        severity: 'danger',
        title: 'Solicitud rechazada',
        body: request?.decisionNote ? `Motivo: ${request.decisionNote}` : 'Tu solicitud fue rechazada.',
        refType: 'request',
        refId: e.requestId,
      })
    }),
    bus.on('request.cancelled', (e) =>
      e.actorId !== e.requesterId
        ? push([e.requesterId], {
            kind: 'request.cancelled',
            severity: 'warning',
            title: 'Solicitud cancelada',
            body: 'Un administrador canceló tu solicitud y liberó el material reservado.',
            refType: 'request',
            refId: e.requestId,
          })
        : undefined,
    ),
    bus.on('request.delivered', async (e) => {
      const request = await db.requests.get(e.requestId)
      const lines = await db.requestLines.where('requestId').equals(e.requestId).toArray()
      const returnable = lines.some((l) => l.returnable)
      await push([e.requesterId], {
        kind: 'request.delivered',
        severity: 'info',
        title: 'Material entregado',
        body: returnable && request ? `Recuerda devolver las herramientas antes del ${request.returnBy}.` : 'Tu solicitud fue entregada.',
        refType: 'request',
        refId: e.requestId,
      })
    }),
    bus.on('request.closed', async (e) => {
      const lines = await db.requestLines.where('requestId').equals(e.requestId).toArray()
      if (!lines.some((l) => l.returnable)) return
      await push([e.requesterId], {
        kind: 'request.closed',
        severity: 'success',
        title: 'Devolución completa',
        body: 'Recibimos todo lo prestado. ¡Gracias!',
        refType: 'request',
        refId: e.requestId,
      })
    }),
    bus.on('stock.low', async (e) =>
      push(await adminIds(), {
        kind: 'stock.low',
        severity: 'warning',
        title: 'Stock bajo',
        body: `${e.name}: quedan ${e.available} ${e.unit} (mínimo ${e.minStock}).`,
        refType: 'item',
        refId: e.itemId,
      }),
    ),
    bus.on('stock.out', async (e) =>
      push(await adminIds(), {
        kind: 'stock.out',
        severity: 'danger',
        title: 'Stock agotado',
        body: `${e.name} está agotado.`,
        refType: 'item',
        refId: e.itemId,
      }),
    ),
    bus.on('reservation.affected', (e) =>
      push([e.userId], {
        kind: 'reservation.affected',
        severity: 'warning',
        title: 'Tu reserva fue afectada',
        body: `${e.printerName} tendrá mantenimiento en el horario que reservaste. Reprograma tu reserva.`,
        refType: 'reservation',
        refId: e.reservationId,
      }),
    ),
    bus.on('job.completed', (e) =>
      push([e.userId], {
        kind: 'job.completed',
        severity: 'success',
        title: 'Impresión terminada',
        body: `"${e.name}" terminó de imprimirse.`,
        refType: 'job',
        refId: e.jobId,
      }),
    ),
    bus.on('printer.failed', async (e) => {
      await push(await adminIds(), {
        kind: 'printer.failed',
        severity: 'danger',
        title: `Falla en ${e.printerName}`,
        body: e.reason,
        refType: 'printer',
        refId: e.printerId,
      })
      if (e.userId) {
        await push([e.userId], {
          kind: 'printer.failed.job',
          severity: 'danger',
          title: 'Tu impresión falló',
          body: `${e.printerName} tuvo una falla: ${e.reason}. El filamento no usado volvió al inventario.`,
          refType: 'job',
          refId: e.jobId,
        })
      }
    }),
    bus.on('maintenance.due', async (e) =>
      push(await adminIds(), {
        kind: 'maintenance.due',
        severity: 'warning',
        title: `${e.printerName} necesita mantenimiento`,
        body: `Acumula ${e.hours} h de impresión desde el último mantenimiento.`,
        refType: 'printer',
        refId: e.printerId,
      }),
    ),
    bus.on('maintenance.started', async (e) =>
      push(await adminIds(), {
        kind: 'maintenance.started',
        severity: 'info',
        title: 'Mantenimiento iniciado',
        body: `${e.printerName}: ${e.title}`,
        refType: 'maintenance',
        refId: e.taskId,
      }),
    ),
    bus.on('maintenance.completed', async (e) =>
      push(await adminIds(), {
        kind: 'maintenance.completed',
        severity: 'success',
        title: 'Mantenimiento completado',
        body: `${e.printerName} vuelve a estar disponible.`,
        refType: 'maintenance',
        refId: e.taskId,
      }),
    ),
  ]
  return () => offs.forEach((off) => off())
}
