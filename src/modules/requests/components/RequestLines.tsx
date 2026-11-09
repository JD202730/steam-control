import { fmtNumber } from '@/shared/format'
import type { InventoryItem } from '../../inventory/types'
import type { RequestLine } from '../types'

/** Lista compacta de los artículos de una solicitud: "Arduino UNO ×2". */
export function RequestLines({ lines, items, showReturn }: { lines: RequestLine[]; items: Map<string, InventoryItem>; showReturn?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {lines.map((l) => {
        const item = items.get(l.itemId)
        const pending = l.qtyDelivered - l.qtyReturned
        return (
          <li key={l.id} className="rounded-md border border-line bg-surface-2 px-2 py-1 text-[13px]">
            <span className="font-medium">{item?.name ?? 'Artículo eliminado'}</span>
            <span className="num ml-1 text-muted">
              ×{fmtNumber(l.qty)}
              {item && item.unit !== 'ud' ? ` ${item.unit}` : ''}
            </span>
            {showReturn && l.returnable && l.qtyDelivered > 0 && (
              <span className="ml-1 text-xs text-muted">{pending > 0 ? `· faltan ${pending} por devolver` : '· devuelto'}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
