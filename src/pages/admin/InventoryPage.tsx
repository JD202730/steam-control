import { ArrowDownToLine, FolderPlus, History, Pencil, Plus, Power, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useById, useCategories, useItems, useUsers } from '@/modules/data-hooks'
import {
  adjustStock,
  availableOf,
  createCategory,
  createItem,
  isLowStock,
  listMovements,
  receiveStock,
  setItemActive,
  updateItem,
  verifyLedger,
  type LedgerIssue,
} from '@/modules/inventory/service'
import { ITEM_KIND_LABEL, MOVEMENT_LABEL, type InventoryItem, type ItemKind } from '@/modules/inventory/types'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAction, useRequiredActor } from '@/shared/hooks/hooks'
import { fmtDateTime, fmtMoney, fmtNumber } from '@/shared/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Field, Input, SearchInput, Select, toNumber } from '@/shared/ui/Fields'
import { Modal } from '@/shared/ui/Modal'
import { EmptyState, PageHeader, Spinner, tableCls } from '@/shared/ui/Misc'

/* ----------------------------- Formulario de artículo ----------------------------- */

function ItemModal({ item, onClose }: { item: InventoryItem | 'new'; onClose: () => void }) {
  const actor = useRequiredActor()
  const categories = useCategories() ?? []
  const { run, pending } = useAction()
  const editing = item !== 'new' ? item : null
  const [sku, setSku] = useState(editing?.sku ?? '')
  const [name, setName] = useState(editing?.name ?? '')
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? categories[0]?.id ?? '')
  const [kind, setKind] = useState<ItemKind>(editing?.kind ?? 'consumable')
  const [unit, setUnit] = useState(editing?.unit ?? 'ud')
  const [minStock, setMinStock] = useState(String(editing?.minStock ?? 5))
  const [location, setLocation] = useState(editing?.location ?? '')
  const [unitCost, setUnitCost] = useState(String(editing?.unitCost ?? 0))
  const [initialStock, setInitialStock] = useState('0')

  const submit = async () => {
    const common = { name, categoryId, minStock: toNumber(minStock), location, unitCost: toNumber(unitCost) }
    const done = await run(
      () => (editing ? updateItem(actor, editing.id, common) : createItem(actor, { ...common, sku, kind, unit, initialStock: toNumber(initialStock) })),
      editing ? 'Artículo actualizado.' : 'Artículo creado.',
    )
    if (done) onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Editar ${editing.name}` : 'Nuevo artículo'}
      description={editing ? 'Las existencias no se editan aquí: usa “Entrada” o “Ajuste” para que quede registro.' : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={pending} onClick={submit} disabled={!name.trim() || !categoryId || (!editing && !sku.trim())}>
            {editing ? 'Guardar' : 'Crear artículo'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!editing && (
          <Field label="Código (SKU)" hint="Único. Ej.: ELE-ARD-UNO">
            <Input value={sku} onChange={(e) => setSku(e.target.value)} maxLength={24} />
          </Field>
        )}
        <Field label="Nombre" className={editing ? 'sm:col-span-2' : ''}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Categoría">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        {!editing && (
          <>
            <Field label="Tipo" hint={kind === 'tool' || kind === 'equipment' ? 'Se presta y debe devolverse.' : 'Se consume al usarlo.'}>
              <Select value={kind} onChange={(e) => setKind(e.target.value as ItemKind)}>
                {(Object.keys(ITEM_KIND_LABEL) as ItemKind[]).map((k) => (
                  <option key={k} value={k}>
                    {ITEM_KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Unidad">
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={12} placeholder="ud, g, par…" />
            </Field>
            <Field label="Stock inicial">
              <Input type="number" min={0} value={initialStock} onChange={(e) => setInitialStock(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Stock mínimo" hint="Por debajo de esto se genera una alerta.">
          <Input type="number" min={0} value={minStock} onChange={(e) => setMinStock(e.target.value)} />
        </Field>
        <Field label="Costo por unidad">
          <Input type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
        </Field>
        <Field label="Ubicación">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={60} placeholder="Estante A1" />
        </Field>
      </div>
    </Modal>
  )
}

/* ------------------------------ Entrada y ajuste ------------------------------ */

function StockModal({ item, mode, onClose }: { item: InventoryItem; mode: 'in' | 'adjust'; onClose: () => void }) {
  const actor = useRequiredActor()
  const { run, pending } = useAction()
  const [qty, setQty] = useState('')
  const [sign, setSign] = useState<'+' | '-'>('+')
  const [reason, setReason] = useState(mode === 'in' ? 'Compra' : '')
  const amount = toNumber(qty)

  const submit = async () => {
    const done = await run(
      () => (mode === 'in' ? receiveStock(actor, item.id, amount, reason) : adjustStock(actor, item.id, sign === '-' ? -amount : amount, reason)),
      mode === 'in' ? 'Entrada registrada.' : 'Ajuste registrado.',
    )
    if (done) onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={mode === 'in' ? `Entrada de ${item.name}` : `Ajustar ${item.name}`}
      description={`Existencias: ${fmtNumber(item.onHand)} ${item.unit} · reservado: ${fmtNumber(item.reserved)} · disponible: ${fmtNumber(availableOf(item))}`}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={pending} onClick={submit} disabled={!(amount > 0) || reason.trim().length < 3}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          {mode === 'adjust' && (
            <Select className="w-24" value={sign} onChange={(e) => setSign(e.target.value as '+' | '-')} aria-label="Sumar o restar">
              <option value="+">Sumar</option>
              <option value="-">Restar</option>
            </Select>
          )}
          <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} placeholder={`Cantidad (${item.unit})`} autoFocus aria-label="Cantidad" />
        </div>
        <Field label="Motivo" hint={mode === 'adjust' ? 'Ej.: conteo físico, pieza dañada.' : 'Ej.: compra, donación.'}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={160} />
        </Field>
      </div>
    </Modal>
  )
}

/* ------------------------------ Historial de movimientos ------------------------------ */

function MovementsModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const movements = useLiveQuery(() => listMovements(item.id, 60), [item.id])
  const users = useById(useUsers())
  return (
    <Modal open onClose={onClose} size="lg" title={`Movimientos de ${item.name}`} description="Cada cambio de stock queda registrado: así se puede auditar el inventario." footer={<Button onClick={onClose}>Cerrar</Button>}>
      {!movements ? (
        <Spinner />
      ) : (
        <div className={tableCls.wrap}>
          <table className={tableCls.table}>
            <thead>
              <tr>
                <th className={tableCls.th}>Fecha</th>
                <th className={tableCls.th}>Tipo</th>
                <th className={tableCls.th}>Cantidad</th>
                <th className={tableCls.th}>Existencias</th>
                <th className={tableCls.th}>Motivo</th>
                <th className={tableCls.th}>Por</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className={tableCls.row}>
                  <td className={`${tableCls.td} whitespace-nowrap`}>{fmtDateTime(m.at)}</td>
                  <td className={tableCls.td}>
                    <Badge tone={m.deltaOnHand > 0 ? 'ok' : m.deltaOnHand < 0 ? 'warn' : 'info'}>{MOVEMENT_LABEL[m.type]}</Badge>
                  </td>
                  <td className={`${tableCls.td} num`}>{m.qty > 0 && m.type === 'adjust' ? `+${m.qty}` : m.qty}</td>
                  <td className={`${tableCls.td} num`}>
                    {fmtNumber(m.balanceOnHand)} <span className="text-xs text-muted">({fmtNumber(m.balanceReserved)} res.)</span>
                  </td>
                  <td className={tableCls.td}>{m.reason}</td>
                  <td className={`${tableCls.td} text-muted`}>{m.actorId === 'system' ? 'Sistema' : (users.get(m.actorId)?.name ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

function CategoryModal({ onClose }: { onClose: () => void }) {
  const actor = useRequiredActor()
  const { run, pending } = useAction()
  const [name, setName] = useState('')
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Nueva categoría"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={name.trim().length < 2}
            onClick={async () => {
              if (await run(() => createCategory(actor, name), 'Categoría creada.')) onClose()
            }}
          >
            Crear
          </Button>
        </>
      }
    >
      <Field label="Nombre">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
      </Field>
    </Modal>
  )
}

/* ----------------------------------------- Página ----------------------------------------- */

type Dialog = { type: 'item'; item: InventoryItem | 'new' } | { type: 'stock'; item: InventoryItem; mode: 'in' | 'adjust' } | { type: 'moves'; item: InventoryItem } | { type: 'category' } | { type: 'ledger'; issues: LedgerIssue[]; checked: number } | null

export default function InventoryPage() {
  const actor = useRequiredActor()
  const items = useItems()
  const categories = useCategories()
  const categoryById = useById(categories)
  const { run } = useAction()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [kind, setKind] = useState<'all' | ItemKind>('all')
  const [onlyLow, setOnlyLow] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (items ?? []).filter(
      (i) =>
        (showInactive || i.active) &&
        (!category || i.categoryId === category) &&
        (kind === 'all' || i.kind === kind) &&
        (!onlyLow || isLowStock(i)) &&
        (!q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)),
    )
  }, [items, query, category, kind, onlyLow, showInactive])

  if (!items || !categories) return <Spinner />
  const lowCount = items.filter(isLowStock).length

  const checkLedger = async () => {
    const report = await run(() => verifyLedger())
    if (report) setDialog({ type: 'ledger', issues: report.issues, checked: report.checked })
  }

  return (
    <>
      <PageHeader
        title="Inventario"
        subtitle={`${items.filter((i) => i.active).length} artículos activos · ${lowCount} con stock bajo o agotado`}
        actions={
          <>
            <Button onClick={checkLedger} icon={<ShieldCheck className="size-4" />}>
              Verificar coherencia
            </Button>
            <Button onClick={() => setDialog({ type: 'category' })} icon={<FolderPlus className="size-4" />}>
              Nueva categoría
            </Button>
            <Button variant="primary" onClick={() => setDialog({ type: 'item', item: 'new' })} icon={<Plus className="size-4" />}>
              Nuevo artículo
            </Button>
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <SearchInput className="min-w-52 flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o código" aria-label="Buscar en el inventario" />
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
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} className="size-4 accent-[var(--brand)]" /> Solo stock bajo
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-4 accent-[var(--brand)]" /> Ver desactivados
          </label>
        </div>

        {visible.length === 0 ? (
          <EmptyState icon={SlidersHorizontal} title="No hay artículos con esos filtros" />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Artículo</th>
                  <th className={tableCls.th}>Tipo</th>
                  <th className={`${tableCls.th} text-right`}>Existencias</th>
                  <th className={`${tableCls.th} text-right`}>Reservado</th>
                  <th className={`${tableCls.th} text-right`}>Disponible</th>
                  <th className={`${tableCls.th} text-right`}>Mínimo</th>
                  <th className={`${tableCls.th} text-right`}>Costo</th>
                  <th className={tableCls.th}>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => {
                  const available = availableOf(i)
                  return (
                    <tr key={i.id} className={`${tableCls.row} ${i.active ? '' : 'opacity-55'}`}>
                      <td className={tableCls.td}>
                        <p className="font-medium">
                          {i.name} {!i.active && <Badge>Desactivado</Badge>}
                        </p>
                        <p className="text-xs text-muted">
                          {i.sku} · {categoryById.get(i.categoryId)?.name} · {i.location}
                        </p>
                      </td>
                      <td className={tableCls.td}>
                        <Badge tone={i.kind === 'filament' ? 'info' : i.kind === 'tool' || i.kind === 'equipment' ? 'brand' : 'neutral'}>{ITEM_KIND_LABEL[i.kind]}</Badge>
                      </td>
                      <td className={`${tableCls.td} num text-right`}>
                        {fmtNumber(i.onHand)} <span className="text-xs text-muted">{i.unit}</span>
                      </td>
                      <td className={`${tableCls.td} num text-right text-muted`}>{fmtNumber(i.reserved)}</td>
                      <td className={`${tableCls.td} num text-right`}>
                        <span className="font-semibold">{fmtNumber(available)}</span>
                        {i.active && available <= 0 ? <Badge tone="bad" className="ml-2">Agotado</Badge> : isLowStock(i) ? <Badge tone="warn" className="ml-2">Bajo</Badge> : null}
                      </td>
                      <td className={`${tableCls.td} num text-right text-muted`}>{fmtNumber(i.minStock)}</td>
                      <td className={`${tableCls.td} num text-right text-muted`}>{fmtMoney(i.unitCost)}</td>
                      <td className={`${tableCls.td} whitespace-nowrap text-right`}>
                        <Button size="sm" variant="ghost" className="px-2" aria-label={`Entrada de ${i.name}`} title="Registrar entrada" onClick={() => setDialog({ type: 'stock', item: i, mode: 'in' })}>
                          <ArrowDownToLine className="size-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="px-2" aria-label={`Ajustar ${i.name}`} title="Ajuste por conteo" onClick={() => setDialog({ type: 'stock', item: i, mode: 'adjust' })}>
                          <SlidersHorizontal className="size-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="px-2" aria-label={`Movimientos de ${i.name}`} title="Ver movimientos" onClick={() => setDialog({ type: 'moves', item: i })}>
                          <History className="size-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="px-2" aria-label={`Editar ${i.name}`} title="Editar" onClick={() => setDialog({ type: 'item', item: i })}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="px-2"
                          aria-label={i.active ? `Desactivar ${i.name}` : `Activar ${i.name}`}
                          title={i.active ? 'Desactivar' : 'Activar'}
                          onClick={() => run(() => setItemActive(actor, i.id, !i.active), i.active ? 'Artículo desactivado.' : 'Artículo activado.')}
                        >
                          <Power className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog?.type === 'item' && <ItemModal key={dialog.item === 'new' ? 'new' : dialog.item.id} item={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.type === 'stock' && <StockModal key={dialog.item.id + dialog.mode} item={dialog.item} mode={dialog.mode} onClose={() => setDialog(null)} />}
      {dialog?.type === 'moves' && <MovementsModal item={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.type === 'category' && <CategoryModal onClose={() => setDialog(null)} />}
      {dialog?.type === 'ledger' && (
        <Modal open onClose={() => setDialog(null)} size="sm" title={dialog.issues.length ? 'Se encontraron diferencias' : 'Inventario coherente'} footer={<Button onClick={() => setDialog(null)}>Cerrar</Button>}>
          {dialog.issues.length === 0 ? (
            <p className="text-sm text-ink-2">
              Se recalcularon las existencias de {dialog.checked} artículos a partir del libro de movimientos y todas coinciden. No hay stock negativo ni reservas mayores a las existencias.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {dialog.issues.map((i) => (
                <li key={i.itemId} className="rounded-lg bg-bad-soft p-3 text-bad">
                  <strong>{i.name}</strong>: {i.problem} (libro {i.expectedOnHand}, guardado {i.actualOnHand})
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </>
  )
}
