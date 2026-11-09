import { Clock, FileCheck2, Hammer, Package, Spool } from 'lucide-react'
import { useState } from 'react'
import { useSnapshot } from '@/modules/analytics/hooks'
import {
  consumptionByDay,
  filamentUsedGrams,
  maintenanceCosts,
  printerUtilization,
  requestFunnel,
  stockByCategory,
  topConsumed,
} from '@/modules/analytics/metrics'
import { Columns, ChartFrame, RankBars, SERIES, TimeSeries, type SeriesDef } from '@/shared/charts/Charts'
import { fmtMoney, fmtNumber } from '@/shared/format'
import { Kpi, PageHeader, Spinner, Tabs } from '@/shared/ui/Misc'

const PERIODS = [
  { value: '7', label: '7 días' },
  { value: '14', label: '14 días' },
  { value: '30', label: '30 días' },
] as const

export default function AnalyticsPage() {
  const snap = useSnapshot()
  const [period, setPeriod] = useState<'7' | '14' | '30'>('14')
  if (!snap) return <Spinner />
  const days = Number(period)

  const materials = consumptionByDay(snap, { days, kinds: ['consumable', 'tool', 'equipment'] })
  const filament = consumptionByDay(snap, { days, kinds: ['filament'] })
  const stock = stockByCategory(snap)
  const util = printerUtilization(snap, days)
  const funnel = requestFunnel(snap)
  const costs = maintenanceCosts(snap)
  const top = topConsumed(snap, { days, limit: 8 })

  const approved = funnel.filter((f) => ['approved', 'delivered', 'closed'].includes(f.status)).reduce((s, f) => s + f.count, 0)
  const rejected = funnel.find((f) => f.status === 'rejected')?.count ?? 0
  const approvalRate = approved + rejected ? Math.round((approved / (approved + rejected)) * 100) : 0
  const printedHours = util.reduce((s, u) => s + u.hours, 0)
  const totalCost = costs.reduce((s, c) => s + c.parts + c.labor, 0)

  const stockSeries: SeriesDef[] = [
    { key: 'ok', label: 'Stock suficiente', color: SERIES.blue },
    { key: 'low', label: 'Stock bajo o agotado', color: SERIES.orange },
  ]
  const costSeries: SeriesDef[] = [
    { key: 'parts', label: 'Repuestos', color: SERIES.blue },
    { key: 'labor', label: 'Mano de obra', color: SERIES.orange },
  ]
  const materialsSeries: SeriesDef[] = [{ key: 'value', label: 'Unidades consumidas', color: SERIES.blue }]
  const filamentSeries: SeriesDef[] = [{ key: 'value', label: 'Filamento (g)', color: SERIES.aqua }]

  return (
    <>
      <PageHeader title="Analítica" subtitle="Consumo, uso de equipos y estado del inventario. Las gráficas se actualizan con cada cambio." actions={<Tabs value={period} onChange={setPeriod} items={PERIODS.map((p) => ({ value: p.value, label: p.label }))} />} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={FileCheck2} label="Solicitudes aprobadas" value={`${approvalRate}%`} hint={`${approved} aprobadas, ${rejected} rechazadas`} />
        <Kpi icon={Spool} tone="info" label="Filamento usado" value={`${fmtNumber(filamentUsedGrams(snap, days) / 1000, 2)} kg`} hint={`Últimos ${days} días`} />
        <Kpi icon={Clock} tone="ok" label="Horas de impresión" value={fmtNumber(printedHours, 1)} hint={`Últimos ${days} días`} />
        <Kpi icon={Package} tone="warn" label="Artículos con stock bajo" value={stock.reduce((s, c) => s + c.low, 0)} />
        <Kpi icon={Hammer} tone="bad" label="Costo de mantenimiento" value={fmtMoney(totalCost)} hint="Acumulado" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartFrame title="Materiales consumidos por día" subtitle="Salidas y entregas de consumibles, herramientas y equipos" table={{ columns: ['Día', 'Unidades'], rows: materials.map((d) => [d.label, d.value]) }} empty={materials.every((d) => d.value === 0)}>
          <Columns data={materials} series={materialsSeries} unit="ud" />
        </ChartFrame>

        <ChartFrame title="Filamento consumido por día" subtitle="Gramos entregados a los trabajos de impresión" table={{ columns: ['Día', 'Gramos'], rows: filament.map((d) => [d.label, d.value]) }} empty={filament.every((d) => d.value === 0)}>
          <TimeSeries data={filament} series={filamentSeries} unit="g" />
        </ChartFrame>

        <ChartFrame
          title="Estado del stock por categoría"
          subtitle="Cuántos artículos están bien y cuántos necesitan reposición"
          legend={stockSeries}
          table={{ columns: ['Categoría', 'Suficiente', 'Bajo o agotado'], rows: stock.map((c) => [c.category, c.ok, c.low]) }}
          empty={stock.length === 0}
        >
          <Columns data={stock} series={stockSeries} stacked categoryKey="category" unit="artículos" />
        </ChartFrame>

        <ChartFrame title="Horas de uso por impresora" subtitle={`Últimos ${days} días`} table={{ columns: ['Impresora', 'Horas'], rows: util.map((u) => [u.name, u.hours]) }} empty={util.every((u) => u.hours === 0)}>
          <RankBars data={util.map((u) => ({ label: u.name, value: u.hours }))} unit="h" name="Horas" color={SERIES.aqua} />
        </ChartFrame>

        <ChartFrame title="Embudo de solicitudes" subtitle="Cuántas hay en cada estado" table={{ columns: ['Estado', 'Solicitudes'], rows: funnel.map((f) => [f.label, f.count]) }} empty={funnel.every((f) => f.count === 0)}>
          <RankBars data={funnel.map((f) => ({ label: f.label, value: f.count }))} name="Solicitudes" />
        </ChartFrame>

        <ChartFrame title="Lo más consumido" subtitle={`Top de artículos, últimos ${days} días (sin filamento)`} table={{ columns: ['Artículo', 'Cantidad'], rows: top.map((t) => [t.name, `${t.qty} ${t.unit}`]) }} empty={top.length === 0}>
          <RankBars data={top.map((t) => ({ label: t.name, value: t.qty }))} name="Cantidad" color={SERIES.orange} />
        </ChartFrame>

        <div className="xl:col-span-2">
          <ChartFrame
            title="Costo de mantenimiento por tipo"
            subtitle="Solo tareas completadas"
            legend={costSeries}
            height={220}
            table={{ columns: ['Tipo', 'Tareas', 'Repuestos', 'Mano de obra'], rows: costs.map((c) => [c.type, c.count, fmtMoney(c.parts), fmtMoney(c.labor)]) }}
            empty={costs.every((c) => c.count === 0)}
          >
            <Columns data={costs} series={costSeries} stacked categoryKey="type" unit="$" />
          </ChartFrame>
        </div>
      </div>
    </>
  )
}
