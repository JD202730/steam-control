import clsx from 'clsx'
import { Table2, BarChart3 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardHeader } from '../ui/Card'
import { Button } from '../ui/Button'
import { tableCls } from '../ui/Misc'

/** Colores categóricos por rol (paleta validada, con variantes para modo claro y oscuro en index.css). */
export const SERIES = {
  blue: 'var(--s1)',
  orange: 'var(--s2)',
  aqua: 'var(--s3)',
  yellow: 'var(--s4)',
  magenta: 'var(--s5)',
} as const

export interface SeriesDef {
  key: string
  label: string
  color: string
}

export interface ChartTable {
  columns: string[]
  rows: (string | number)[][]
}

const TICK = { fill: 'var(--tick)', fontSize: 12 }

/**
 * Marco de una gráfica: título, leyenda (siempre con 2+ series), alternancia gráfica/tabla
 * para quien no distingue colores o prefiere leer cifras, y estado vacío.
 */
export function ChartFrame({
  title,
  subtitle,
  legend,
  table,
  height = 260,
  empty,
  children,
}: {
  title: string
  subtitle?: string
  legend?: SeriesDef[]
  table: ChartTable
  height?: number
  empty?: boolean
  children: ReactNode
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={subtitle}
        actions={
          <Button size="sm" variant="ghost" onClick={() => setView(view === 'chart' ? 'table' : 'chart')} icon={view === 'chart' ? <Table2 className="size-4" /> : <BarChart3 className="size-4" />}>
            {view === 'chart' ? 'Ver tabla' : 'Ver gráfica'}
          </Button>
        }
      />
      <div className="px-5 pb-4 pt-3">
        {legend && legend.length >= 2 && (
          <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2" aria-label="Leyenda">
            {legend.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} aria-hidden />
                {s.label}
              </li>
            ))}
          </ul>
        )}
        {empty ? (
          <div className="grid place-items-center text-sm text-muted" style={{ height }}>
            Aún no hay datos para mostrar.
          </div>
        ) : view === 'chart' ? (
          <div style={{ height }} role="img" aria-label={`${title}. Usa “Ver tabla” para leer los valores.`}>
            {children}
          </div>
        ) : (
          <div className={clsx(tableCls.wrap, 'max-h-[320px] overflow-y-auto')}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <th key={c} className={tableCls.th}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i} className={tableCls.row}>
                    {row.map((cell, j) => (
                      <td key={j} className={clsx(tableCls.td, j > 0 && 'num')}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}

interface TooltipPayload {
  name?: string | number
  value?: number | string
  color?: string
  fill?: string
  stroke?: string
}

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: TooltipPayload[]; label?: string | number; unit?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      {label !== undefined && <div className="mb-1 font-medium text-ink">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-ink-2">
          <span className="size-2 rounded-[2px]" style={{ background: p.color ?? p.fill ?? p.stroke }} aria-hidden />
          <span>{p.name}</span>
          <span className="num ml-auto pl-3 font-medium text-ink">
            {typeof p.value === 'number' ? p.value.toLocaleString('es', { maximumFractionDigits: 1 }) : p.value}
            {unit ? ` ${unit}` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Área/línea en el tiempo (series continuas). Línea de 2 px y relleno suave. */
export function TimeSeries({ data, series, unit }: { data: Record<string, number | string>[]; series: SeriesDef[]; unit?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" tick={TICK} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} minTickGap={28} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} width={48} allowDecimals={false} />
        <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ stroke: 'var(--axis)' }} />
        {series.map((s) => (
          <Area
            key={s.key}
            type="linear"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            fill={s.color}
            fillOpacity={0.12}
            dot={false}
            activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** Barras verticales (o apiladas) con extremos redondeados y 2 px de separación entre segmentos. */
export function Columns({
  data,
  series,
  stacked,
  unit,
  categoryKey = 'label',
}: {
  data: Record<string, number | string>[]
  series: SeriesDef[]
  stacked?: boolean
  unit?: string
  categoryKey?: string
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey={categoryKey} tick={TICK} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} minTickGap={12} interval="preserveStartEnd" />
        <YAxis tick={TICK} axisLine={false} tickLine={false} width={48} allowDecimals={false} />
        <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: 'var(--bar-zero)', opacity: 0.6 }} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color}
            stackId={stacked ? 'a' : undefined}
            stroke={stacked ? 'var(--surface)' : undefined}
            strokeWidth={stacked ? 2 : 0}
            radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
            maxBarSize={36}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Barras horizontales para rankings (nombres largos legibles). */
export function RankBars({ data, color = SERIES.blue, unit, name = 'Valor' }: { data: { label: string; value: number }[]; color?: string; unit?: string; name?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }} barCategoryGap="26%">
        <CartesianGrid stroke="var(--grid)" horizontal={false} />
        <XAxis type="number" tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="label" tick={{ ...TICK, fill: 'var(--ink-2)' }} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} width={150} />
        <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: 'var(--bar-zero)', opacity: 0.6 }} />
        <Bar dataKey="value" name={name} fill={color} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  )
}
