import clsx from 'clsx'
import { Search } from 'lucide-react'
import type { ComponentProps, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export const controlCls =
  'rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted transition-colors ' +
  'hover:border-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:opacity-60 disabled:bg-surface-2'

/** Ocupan todo el ancho salvo que quien los usa indique su propio ancho (evita choques entre w-full y w-auto). */
const widthOf = (className?: string) => (className && /(^|\s)(w|min-w|max-w)-/.test(className) ? '' : 'w-full')

/** Campo con etiqueta: la etiqueta envuelve al control, así queda asociada sin ids. */
export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block text-sm', className)}>
      <span className="mb-1 block font-medium text-ink-2">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-bad">{error}</span>}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input {...rest} className={clsx(controlCls, widthOf(className), 'h-10', className)} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={clsx(controlCls, widthOf(className), 'h-10 pr-8', className)}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={clsx(controlCls, widthOf(className), 'min-h-20 py-2', className)} />
}

export function SearchInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={clsx('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input type="search" {...rest} className={clsx(controlCls, 'w-full h-10 pl-9')} />
    </div>
  )
}

/** Convierte el valor de un <input type=number> a número (vacío -> NaN para que la validación lo rechace). */
export const toNumber = (value: string): number => (value.trim() === '' ? Number.NaN : Number(value))
