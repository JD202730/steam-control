import { KeyRound, Pencil, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { ROLE_LABEL, type Role } from '@/core/permissions/roles'
import { useUsers } from '@/modules/data-hooks'
import { createUser, resetUserPassword, updateUser } from '@/modules/users/service'
import type { PublicUser } from '@/modules/users/types'
import { useAction, useRequiredActor } from '@/shared/hooks/hooks'
import { fmtDate } from '@/shared/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Field, Input, Select } from '@/shared/ui/Fields'
import { Modal } from '@/shared/ui/Modal'
import { EmptyState, PageHeader, Spinner, tableCls } from '@/shared/ui/Misc'

function UserModal({ user, onClose }: { user: PublicUser | 'new'; onClose: () => void }) {
  const actor = useRequiredActor()
  const { run, pending } = useAction()
  const editing = user !== 'new' ? user : null
  const [name, setName] = useState(editing?.name ?? '')
  const [email, setEmail] = useState(editing?.email ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>(editing?.role ?? 'user')
  const [area, setArea] = useState(editing?.area ?? '')
  const [status, setStatus] = useState<'active' | 'disabled'>(editing?.status ?? 'active')

  const submit = async () => {
    const done = await run(
      () => (editing ? updateUser(actor, editing.id, { name, area, role, status }) : createUser(actor, { name, email, password, role, area })),
      editing ? 'Usuario actualizado.' : 'Usuario creado.',
    )
    if (done) onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Editar a ${editing.name}` : 'Nuevo usuario'}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={pending} onClick={submit} disabled={name.trim().length < 2 || (!editing && (!email.trim() || password.length < 8))}>
            {editing ? 'Guardar' : 'Crear usuario'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre completo" className="sm:col-span-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
        </Field>
        {!editing && (
          <>
            <Field label="Correo">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Contraseña inicial" hint="Mínimo 8 caracteres.">
              <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Rol">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="user">Usuario</option>
            <option value="admin">Administrador</option>
          </Select>
        </Field>
        <Field label="Grupo o área">
          <Input value={area} onChange={(e) => setArea(e.target.value)} maxLength={60} />
        </Field>
        {editing && (
          <Field label="Estado">
            <Select value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'disabled')}>
              <option value="active">Activo</option>
              <option value="disabled">Desactivado</option>
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  )
}

function PasswordModal({ user, onClose }: { user: PublicUser; onClose: () => void }) {
  const actor = useRequiredActor()
  const { run, pending } = useAction()
  const [password, setPassword] = useState('')
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Nueva contraseña para ${user.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={password.length < 8}
            onClick={async () => {
              if ((await run(() => resetUserPassword(actor, user.id, password), 'Contraseña actualizada.')) !== undefined) onClose()
            }}
          >
            Guardar
          </Button>
        </>
      }
    >
      <Field label="Contraseña nueva" hint="Mínimo 8 caracteres. Compártela por un canal seguro.">
        <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </Field>
    </Modal>
  )
}

export default function UsersPage() {
  const me = useRequiredActor()
  const users = useUsers()
  const [dialog, setDialog] = useState<{ type: 'user'; user: PublicUser | 'new' } | { type: 'password'; user: PublicUser } | null>(null)

  if (!users) return <Spinner />

  return (
    <>
      <PageHeader
        title="Usuarios"
        subtitle={`${users.filter((u) => u.status === 'active').length} cuentas activas de ${users.length}`}
        actions={
          <Button variant="primary" onClick={() => setDialog({ type: 'user', user: 'new' })} icon={<UserPlus className="size-4" />}>
            Nuevo usuario
          </Button>
        }
      />
      <Card>
        {users.length === 0 ? (
          <EmptyState icon={Users} title="Aún no hay usuarios" />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Persona</th>
                  <th className={tableCls.th}>Rol</th>
                  <th className={tableCls.th}>Estado</th>
                  <th className={tableCls.th}>Desde</th>
                  <th className={tableCls.th}>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={tableCls.row}>
                    <td className={tableCls.td}>
                      <p className="font-medium">
                        {u.name} {u.id === me.id && <Badge tone="brand">Tú</Badge>}
                      </p>
                      <p className="text-xs text-muted">
                        {u.email} · {u.area || 'Sin área'}
                      </p>
                    </td>
                    <td className={tableCls.td}>
                      <Badge tone={u.role === 'admin' ? 'brand' : 'neutral'}>{ROLE_LABEL[u.role]}</Badge>
                    </td>
                    <td className={tableCls.td}>
                      <Badge tone={u.status === 'active' ? 'ok' : 'neutral'}>{u.status === 'active' ? 'Activo' : 'Desactivado'}</Badge>
                    </td>
                    <td className={`${tableCls.td} text-muted`}>{fmtDate(u.createdAt)}</td>
                    <td className={`${tableCls.td} whitespace-nowrap text-right`}>
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'user', user: u })} icon={<Pencil className="size-3.5" />}>
                        Editar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'password', user: u })} icon={<KeyRound className="size-3.5" />}>
                        Contraseña
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {dialog?.type === 'user' && <UserModal key={dialog.user === 'new' ? 'new' : dialog.user.id} user={dialog.user} onClose={() => setDialog(null)} />}
      {dialog?.type === 'password' && <PasswordModal key={dialog.user.id} user={dialog.user} onClose={() => setDialog(null)} />}
    </>
  )
}
