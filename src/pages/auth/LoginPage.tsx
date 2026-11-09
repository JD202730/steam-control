import { KeyRound, Mail, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { useSession } from '@/core/auth/session'
import { errorMessage } from '@/core/errors'
import { DEMO_ACCOUNTS } from '@/seed/data'
import { Button } from '@/shared/ui/Button'
import { Field, Input } from '@/shared/ui/Fields'

const DEMOS = DEMO_ACCOUNTS.filter((a) => ['u-admin', 'u-sofia'].includes(a.id))

/** Ilustración: una pieza hexagonal "cortada en capas", como la ve una impresora 3D. */
function LayersArt() {
  return (
    <svg viewBox="0 0 320 300" className="w-full max-w-[340px]" aria-hidden>
      {Array.from({ length: 14 }, (_, i) => {
        const y = 40 + i * 16
        const w = 100 - Math.abs(i - 6.5) * 4.2
        return <ellipse key={i} cx="160" cy={y} rx={w + 40} ry="22" fill="none" stroke="#7fd8cd" strokeWidth="2" opacity={0.25 + i * 0.045} />
      })}
      <ellipse cx="160" cy="40" rx="64" ry="14" fill="#e8a317" opacity="0.95" />
      <path d="M160 14v26" stroke="#e8a317" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export default function LoginPage() {
  const user = useSession((s) => s.user)
  const login = useSession((s) => s.login)
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/user'} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const signedIn = await login(email, password)
      const home = signedIn.role === 'admin' ? '/admin' : '/user'
      const from = (location.state as { from?: string } | null)?.from
      navigate(from?.startsWith(home) ? from : home, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-side p-12 text-side-ink lg:flex">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 40 40" className="size-10" aria-hidden>
            <rect width="40" height="40" rx="10" fill="#0b6e66" />
            <path d="M20 7.5l11 6.3v12.4L20 32.5l-11-6.3V13.8z" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" />
            <circle cx="20" cy="15.5" r="2.6" fill="#e8a317" />
          </svg>
          <span className="font-display text-xl font-semibold text-white">STEAM Control</span>
        </div>
        <div>
          <LayersArt />
          <h1 className="mt-6 max-w-md text-4xl font-semibold leading-tight text-white">Cada pieza, cada solicitud y cada impresora, al día.</h1>
          <p className="mt-4 max-w-md text-[17px] text-side-ink/80">
            Gestiona el inventario de la Sala STEAM, aprueba solicitudes, reserva impresoras 3D y planifica su mantenimiento desde un solo lugar.
          </p>
        </div>
        <p className="text-sm text-side-ink/60">Entorno de demostración: los datos son ficticios y se guardan solo en este navegador.</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h2 className="text-[26px] font-semibold">Entrar a tu cuenta</h2>
          <p className="mt-1 text-sm text-ink-2">Usa tu correo de la Sala STEAM.</p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <Field label="Correo">
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" placeholder="nombre@steam.demo" required />
              </div>
            </Field>
            <Field label="Contraseña">
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" required />
              </div>
            </Field>
            {error && (
              <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!email || !password}>
              Entrar
            </Button>
          </form>

          <div className="mt-8 rounded-xl border border-line bg-surface p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4 text-brand" aria-hidden /> Cuentas de demostración
            </p>
            <p className="mt-1 text-xs text-muted">Datos ficticios. Elige una para rellenar el formulario.</p>
            <div className="mt-3 grid gap-2">
              {DEMOS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setEmail(a.email)
                    setPassword(a.password)
                    setError(null)
                  }}
                  className="rounded-lg border border-line px-3 py-2 text-left text-sm transition-colors hover:border-brand hover:bg-brand-soft"
                >
                  <span className="block font-medium">{a.role === 'admin' ? 'Administración' : 'Usuario'}</span>
                  <span className="num block text-xs text-muted">
                    {a.email} · {a.password}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
