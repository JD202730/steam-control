import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '@/core/db/db'
import { listCategories, listItems } from './inventory/service'
import { listJobs, listPrinters, listReservations } from './printers/service'
import { listRequests } from './requests/service'
import { listTasks } from './maintenance/service'
import { listUsers } from './users/service'

/**
 * Hooks de lectura "en vivo": cada uno se suscribe a las tablas que consulta y la interfaz se
 * vuelve a pintar sola cuando cambian (incluso desde otra pestaña). Devuelven undefined mientras cargan.
 */
export const useItems = () => useLiveQuery(listItems, [])
export const useCategories = () => useLiveQuery(listCategories, [])
export const useUsers = () => useLiveQuery(listUsers, [])
export const usePrinters = () => useLiveQuery(listPrinters, [])
export const useTasks = () => useLiveQuery(() => listTasks(), [])
export const useAllRequests = () => useLiveQuery(() => listRequests(), [])
export const useAllRequestLines = () => useLiveQuery(() => db.requestLines.toArray(), [])
export const useAllReservations = () => useLiveQuery(() => listReservations(), [])
export const useAllJobs = () => useLiveQuery(() => listJobs(), [])

export function useById<T extends { id: string }>(rows: T[] | undefined): Map<string, T> {
  return useMemo(() => new Map((rows ?? []).map((r) => [r.id, r])), [rows])
}
