import { registerMaintenanceHandlers } from '@/modules/maintenance/service'
import { registerNotificationHandlers } from '@/modules/notifications/service'

/**
 * Conecta los módulos entre sí mediante el bus de eventos. Se llama una sola vez al arrancar
 * (y en las pruebas que necesitan ver notificaciones o mantenimientos automáticos).
 */
export function registerAllHandlers(): () => void {
  const offs = [registerNotificationHandlers(), registerMaintenanceHandlers()]
  return () => offs.forEach((off) => off())
}
