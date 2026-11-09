import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useSession } from '@/core/auth/session'
import { ROLE_LABEL } from '@/core/permissions/roles'
import { changeOwnPassword, getUser, updateOwnProfile } from '@/modules/users/service'
import { useAction, useRequiredActor } from '@/shared/hooks/hooks'
import { fmtDate } from '@/shared/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/ui/Card'
import { Field, Input } from '@/shared/ui/Fields'
import { PageHeader, Spinner } from '@/shared/ui/Misc'

function ProfileForm({ initialName, initialArea }: { initialName: string; initialArea: string }) {
  const actor = useRequiredActor()
  const refresh = useSession((s) => s.refresh)
  const { run, pending } = useAction()
  const [name, setName] = useState(initialName)
  const [area, setArea] = useState(initialArea)
  return (
    <CardBody className="space-y-4">
      <Field label="Nombre">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </Field>
      <Field label="Grupo o área" hint="Por ejemplo: Docente de Tecnología o Grado 10-A.">
        <Input value={area} onChange={(e) => setArea(e.target.value)} maxLength={60} />
      </Field>
      <Button
        variant="primary"
        loading={pending}
        onClick={async () => {
          if (await run(() => updateOwnProfile(actor, { name, area }), 'Perfil actualizado.')) await refresh()
        }}
      >
        Guardar cambios
      </Button>
    </CardBody>
  )
}

function PasswordForm() {
  const actor = useRequiredActor()
  const { run, pending } = useAction()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const mismatch = repeat.length > 0 && repeat !== next
  return (
    <CardBody className="space-y-4">
      <Field label="Contraseña actual">
        <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="Contraseña nueva" hint="Mínimo 8 caracteres.">
        <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label="Repite la contraseña nueva" error={mismatch ? 'Las contraseñas no coinciden.' : undefined}>
        <Input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </Field>
      <Button
        variant="primary"
        loading={pending}
        disabled={!current || next.length < 8 || next !== repeat}
        onClick={async () => {
          const done = await run(() => changeOwnPassword(actor, current, next), 'Contraseña actualizada.')
          if (done !== undefined) {
            setCurrent('')
            setNext('')
            setRepeat('')
          }
        }}
      >
        Cambiar contraseña
      </Button>
    </CardBody>
  )
}

export default function ProfilePage() {
  const actor = useRequiredActor()
  const user = useLiveQuery(() => getUser(actor.id), [actor.id])
  if (!user) return <Spinner />
  return (
    <>
      <PageHeader title="Mi perfil" subtitle="Tus datos y tu contraseña." />
      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={user.email}
            subtitle={`Cuenta creada el ${fmtDate(user.createdAt)}`}
            actions={<Badge tone={user.role === 'admin' ? 'brand' : 'neutral'}>{ROLE_LABEL[user.role]}</Badge>}
          />
          <ProfileForm key={user.id} initialName={user.name} initialArea={user.area} />
        </Card>
        <Card>
          <CardHeader title="Cambiar contraseña" subtitle="Las contraseñas se guardan cifradas (PBKDF2), nunca en claro." />
          <PasswordForm />
        </Card>
      </div>
    </>
  )
}
