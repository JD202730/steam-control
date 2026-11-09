import clsx from 'clsx'
import { CircleAlert, CircleCheck, Info } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type ToastTone = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  tone: ToastTone
  text: string
}

interface ToastApi {
  success: (text: string) => void
  error: (text: string) => void
  info: (text: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const STYLES: Record<ToastTone, string> = {
  success: 'border-ok/30 bg-ok-soft text-ok',
  error: 'border-bad/30 bg-bad-soft text-bad',
  info: 'border-info/30 bg-info-soft text-info',
}
const ICONS = { success: CircleCheck, error: CircleAlert, info: Info }

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((tone: ToastTone, text: string) => {
    const id = nextId++
    setItems((list) => [...list.slice(-3), { id, tone, text }])
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 4000)
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (text) => push('success', text),
      error: (text) => push('error', text),
      info: (text) => push('info', text),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
        {items.map((t) => {
          const Icon = ICONS[t.tone]
          return (
            <div key={t.id} className={clsx('pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg', STYLES[t.tone])}>
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t.text}</span>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return ctx
}
