import { Minus, PackageSearch, Plus, Send, ShoppingCart, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { clock } from '@/core/clock/clock'
import { dayKey } from '@/core/dates'
import { availableOf } from '@/modules/inventory/service'
import { ITEM_KIND_LABEL, RETURNABLE_KINDS, type ItemKind } from '@/modules/inventory/types'
import { useById, useCategories, useItems } from '@/modules/data-hooks'
import { createRequest } from '@/modules/requests/service'
import { useAction, useRequiredActor } from '@/shared/hooks/hooks'
import { fmtNumber } from '@/shared/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/ui/Card'
import { Field, Input, SearchInput, Select, Textarea } from '@/shared/ui/Fields'
import { EmptyState, PageHeader, Spinner, tableCls } from '@/shared/ui/Misc'

export default function CatalogPage() {
  const actor = useRequiredActor()
  const navigate = useNavigate()
  const items = useItems()
  const categories = useCategories()
  const itemsById = useById(items)
  const categoryName = useById(categories)
  const { run, pending } = useAction()

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [kind, setKind] = useState<'all' | ItemKind>('all')
  const [cart, setCart] = useState<Record<string, number>>({})
  const [purpose, setPurpose] = useState('')
  const [neededBy, setNeededBy] = useState(() => dayKey(clock.nowMs()))
  const [returnBy, setReturnBy] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (items ?? []).filter(
      (i) =>
        i.active &&
        (!category || i.categoryId === category) &&
        (kind === 'all' || i.kind === kind) &&
        (!q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)),
    )
  }, [items, query, category, kind])

  if (!items || !categories) return <Spinner />

  const lines = Object.entries(cart)
    .map(([itemId, qty]) => ({ itemId, qty, item: itemsById.get(itemId) }))
    .filter((l) => l.item)
  const hasLoan = lines.some((l) => RETURNABLE_KINDS.includes(l.item!.kind))

  const setQty = (itemId: string, qty: number) => {
    const item = itemsById.get(itemId)
    if (!item) return
    const clamped = Math.max(0, Math.min(qty, item.onHand))
    setCart((c) => {
      const next = { ...c }
      if (clamped <= 0) delete next[itemId]
      else next[itemId] = clamped
      return next
    })
  }

  const submit = async () => {
    const created = await run(
      () =>
        createRequest(actor, {
          purpose,
          neededBy,
          returnBy: hasLoan && returnBy ? returnBy : undefined,
          lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
        }),
      'Solicitud enviada. Te avisaremos cuando la revisen.',
    )
    if (created) navigate('/user/solicitudes')
  }

  return (
    <>
      <PageHeader title="Catálogo" subtitle="Busca lo que necesitas, agrégalo a tu solicitud y envíala para que la apruebe la coordinación." />

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <div className="flex flex-wrap gap-3 border-b border-line p-4">
            <SearchInput className="min-w-52 flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o código" aria-label="Buscar en el catálogo" />
            <Select className="w-auto min-w-44" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoría">
              <option value="">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select className="w-auto min-w-40" value={kind} onChange={(e) => setKind(e.target.value as 'all' | ItemKind)} aria-label="Tipo">
              <option value="all">Todos los tipos</option>
              {(Object.keys(ITEM_KIND_LABEL) as ItemKind[]).map((k) => (
                <option key={k} value={k}>
                  {ITEM_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </div>

          {visible.length === 0 ? (
            <EmptyState icon={PackageSearch} title="No encontramos artículos" text="Prueba con otra búsqueda o quita los filtros." />
          ) : (
            <div className={tableCls.wrap}>
              <table className={tableCls.table}>
                <thead>
                  <tr>
                    <th className={tableCls.th}>Artículo</th>
                    <th className={tableCls.th}>Tipo</th>
                    <th className={tableCls.th}>Disponible</th>
                    <th className={tableCls.th}>
                      <span className="sr-only">Acción</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((i) => {
                    const available = availableOf(i)
                    const inCart = cart[i.id]
                    return (
                      <tr key={i.id} className={tableCls.row}>
                        <td className={tableCls.td}>
                          <p className="font-medium">{i.name}</p>
                          <p className="text-xs text-muted">
                            {i.sku} · {categoryName.get(i.categoryId)?.name} · {i.location}
                          </p>
                        </td>
                        <td className={tableCls.td}>
                          <Badge tone={i.kind === 'filament' ? 'info' : RETURNABLE_KINDS.includes(i.kind) ? 'brand' : 'neutral'}>{ITEM_KIND_LABEL[i.kind]}</Badge>
                        </td>
                        <td className={tableCls.td}>
                          <span className="num font-medium">
                            {fmtNumber(available)} {i.unit}
                          </span>
                          {available <= 0 ? <Badge tone="bad" className="ml-2">Agotado</Badge> : available <= i.minStock ? <Badge tone="warn" className="ml-2">Pocas unidades</Badge> : null}
                        </td>
                        <td className={`${tableCls.td} text-right`}>
                          {i.kind === 'filament' ? (
                            <span className="text-xs text-muted">Se usa al imprimir</span>
                          ) : inCart ? (
                            <span className="num text-sm font-medium text-brand">En tu solicitud ×{inCart}</span>
                          ) : (
                            <Button size="sm" disabled={available <= 0} onClick={() => setQty(i.id, 1)} icon={<Plus className="size-4" />}>
                              Agregar
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="xl:sticky xl:top-20">
          <CardHeader title="Tu solicitud" subtitle={lines.length ? `${lines.length} artículo${lines.length > 1 ? 's' : ''}` : undefined} />
          {lines.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="Aún no agregas nada" text="Usa “Agregar” en el catálogo para armar tu solicitud." />
          ) : (
            <CardBody className="space-y-4">
              <ul className="space-y-2">
                {lines.map(({ itemId, qty, item }) => (
                  <li key={itemId} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item!.name}</p>
                      <p className="text-xs text-muted">{RETURNABLE_KINDS.includes(item!.kind) ? 'Se devuelve' : 'Se consume'}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" className="px-2" aria-label={`Quitar una unidad de ${item!.name}`} onClick={() => setQty(itemId, qty - 1)}>
                        <Minus className="size-4" />
                      </Button>
                      <span className="num w-8 text-center text-sm font-semibold">{qty}</span>
                      <Button size="sm" variant="ghost" className="px-2" aria-label={`Agregar una unidad de ${item!.name}`} onClick={() => setQty(itemId, qty + 1)} disabled={qty >= item!.onHand}>
                        <Plus className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" className="px-2 text-bad" aria-label={`Quitar ${item!.name}`} onClick={() => setQty(itemId, 0)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <Field label="¿Para qué lo necesitas?">
                <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Ej.: prototipo del proyecto de robótica" maxLength={200} />
              </Field>
              <Field label="Lo necesito el">
                <Input type="date" min={dayKey(clock.nowMs())} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
              </Field>
              {hasLoan && (
                <Field label="Devolveré las herramientas antes del" hint="Si no eliges fecha, serán 7 días después.">
                  <Input type="date" min={neededBy} value={returnBy} onChange={(e) => setReturnBy(e.target.value)} />
                </Field>
              )}
              <Button variant="primary" className="w-full" loading={pending} disabled={purpose.trim().length < 5 || !neededBy} onClick={submit} icon={<Send className="size-4" />}>
                Enviar solicitud
              </Button>
            </CardBody>
          )}
        </Card>
      </div>
    </>
  )
}
