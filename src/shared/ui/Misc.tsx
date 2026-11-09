import clsx from 'clsx'
import { LoaderCircle } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { Card } from './Card'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[15px] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted" role="status">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: ComponentType<{ className?: string }>; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-brand-soft text-brand">
        <Icon className="size-5" />
      </div>
      <p className="font-medium">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ProgressBar({ value, tone = 'brand', label, className }: { value: number; tone?: 'brand' | 'warn' | 'bad'; label?: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={clsx('h-2 w-full overflow-hidden rounded-full bg-line', className)}
    >
      <div
        className={clsx('layers h-full rounded-full transition-[width] duration-700', tone === 'brand' && 'bg-brand', tone === 'warn' && 'bg-accent', tone === 'bad' && 'bg-bad')}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-lg border border-line bg-surface-2 p-1">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          type="button"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={clsx(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            value === it.value ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink',
          )}
        >
          {it.label}
          {it.count !== undefined && <span className="num ml-1.5 text-xs text-muted">{it.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'brand',
  onClick,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon: ComponentType<{ className?: string }>
  tone?: 'brand' | 'ok' | 'warn' | 'bad' | 'info'
  onClick?: () => void
}) {
  const toneCls = { brand: 'bg-brand-soft text-brand', ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad', info: 'bg-info-soft text-info' }[tone]
  const body = (
    <>
      <div className={clsx('grid size-10 shrink-0 place-items-center rounded-lg', toneCls)}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 text-left">
        <div className="num font-display text-[26px] font-semibold leading-none">{value}</div>
        <div className="mt-1 text-sm text-ink-2">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
      </div>
    </>
  )
  const cls = 'flex items-center gap-4 p-4'
  return onClick ? (
    <Card className="transition-colors hover:border-line-strong">
      <button type="button" onClick={onClick} className={clsx(cls, 'w-full rounded-xl')}>
        {body}
      </button>
    </Card>
  ) : (
    <Card className={cls}>{body}</Card>
  )
}

/** Clases comunes para tablas de datos. */
export const tableCls = {
  wrap: 'overflow-x-auto',
  table: 'w-full border-collapse text-sm',
  th: 'whitespace-nowrap border-b border-line bg-surface-2 px-4 py-2.5 text-left text-xs font-medium text-muted first:rounded-tl-xl last:rounded-tr-xl',
  td: 'border-b border-line px-4 py-3 align-middle',
  row: 'transition-colors hover:bg-surface-2/60 last:[&>td]:border-b-0',
}
