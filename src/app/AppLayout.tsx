import clsx from 'clsx'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bell,
  Boxes,
  ChartColumn,
  ClipboardList,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Printer,
  Siren,
  Sun,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Suspense, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { useSession } from '@/core/auth/session'
import { db } from '@/core/db/db'
import { ROLE_LABEL } from '@/core/permissions/roles'
import { loadAlerts } from '@/modules/notifications/alerts'
import { countUnread } from '@/modules/notifications/service'
import { useNow, useTheme } from '@/shared/hooks/hooks'
import { fmtDateTime } from '@/shared/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Spinner } from '@/shared/ui/Misc'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  badge?: 'requests' | 'alerts'
}

const USER_NAV: NavItem[] = [
  { to: '/user', label: 'Mi panel', icon: LayoutDashboard, end: true },
  { to: '/user/catalogo', label: 'Catálogo', icon: Boxes },
  { to: '/user/solicitudes', label: 'Mis solicitudes', icon: ClipboardList },
  { to: '/user/impresoras', label: 'Impresoras 3D', icon: Printer },
]

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Panel', icon: LayoutDashboard, end: true },
  { to: '/admin/inventario', label: 'Inventario', icon: Boxes },
  { to: '/admin/solicitudes', label: 'Solicitudes', icon: ClipboardList, badge: 'requests' },
  { to: '/admin/impresoras', label: 'Impresoras 3D', icon: Printer },
  { to: '/admin/mantenimiento', label: 'Mantenimiento', icon: Wrench },
  { to: '/admin/analitica', label: 'Analítica', icon: ChartColumn },
  { to: '/admin/alertas', label: 'Alertas', icon: Siren, badge: 'alerts' },
  { to: '/admin/usuarios', label: 'Usuarios', icon: Users },
  { to: '/admin/simulacion', label: 'Simulación', icon: FlaskConical },
]

function BrandMark() {
  return (
    <svg viewBox="0 0 40 40" className="size-9" aria-hidden>
      <rect width="40" height="40" rx="10" fill="var(--brand)" />
      <path d="M20 7.5l11 6.3v12.4L20 32.5l-11-6.3V13.8z" fill="none" stroke="var(--brand-ink)" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M12.5 18.5h15M12.5 22h15" stroke="var(--brand-ink)" strokeWidth="1.6" opacity="0.7" />
      <circle cx="20" cy="15.5" r="2.6" fill="var(--accent)" />
    </svg>
  )
}

export function AppLayout() {
  const user = useSession((s) => s.user)!
  const logout = useSession((s) => s.logout)
  const navigate = useNavigate()
  const { dark, toggle } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const now = useNow(1000)
  const isAdmin = user.role === 'admin'
  const nav = isAdmin ? ADMIN_NAV : USER_NAV
  const base = isAdmin ? '/admin' : '/user'

  const sim = useLiveQuery(() => db.sim.get('main'), [])
  const unread = useLiveQuery(() => countUnread(user.id), [user.id], 0)
  const pending = useLiveQuery(() => (isAdmin ? db.requests.where('status').equals('pending').count() : 0), [isAdmin], 0)
  const alerts = useLiveQuery(async () => (isAdmin ? (await loadAlerts()).filter((a) => !a.acked).length : 0), [isAdmin], 0)
  const badges = { requests: pending, alerts }

  const doLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen lg:pl-64">
      {menuOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden />}

      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-side text-side-ink transition-transform duration-200 lg:translate-x-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Barra lateral"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--side-line)] px-5 py-5">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div className="leading-tight">
              <div className="font-display text-[17px] font-semibold text-white">STEAM Control</div>
              <div className="text-xs text-side-ink/70">{isAdmin ? 'Administración' : 'Sala STEAM'}</div>
            </div>
          </div>
          <button type="button" className="rounded-md p-1 text-side-ink hover:bg-white/10 lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Cerrar menú">
            <X className="size-5" />
          </button>
        </div>

        <nav aria-label="Navegación principal" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {nav.map((item) => {
            const count = item.badge ? badges[item.badge] : 0
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium transition-colors',
                    isActive ? 'bg-white/10 text-white' : 'text-side-ink hover:bg-white/5 hover:text-white',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute inset-y-2 left-0 w-1 rounded-r bg-accent" aria-hidden />}
                    <item.icon className="size-[18px]" aria-hidden />
                    <span className="flex-1">{item.label}</span>
                    {count > 0 && <span className="num grid min-w-5 place-items-center rounded-full bg-accent px-1.5 text-xs font-semibold text-black">{count}</span>}
                  </>
                )}
              </NavLink>
            )
          })}
        </nav>

        <div className="border-t border-[var(--side-line)] p-3">
          <NavLink to={`${base}/perfil`} onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5">
            <span className="grid size-9 place-items-center rounded-full bg-brand text-sm font-semibold text-brand-ink" aria-hidden>
              {user.name
                .split(' ')
                .map((p) => p[0])
                .slice(0, 2)
                .join('')}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-medium text-white">{user.name}</span>
              <span className="block text-xs text-side-ink/70">{ROLE_LABEL[user.role]}</span>
            </span>
          </NavLink>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur lg:px-8">
          <Button variant="ghost" size="sm" className="px-2 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Abrir menú">
            <Menu className="size-5" />
          </Button>
          <div className="min-w-0 text-sm text-ink-2">
            <span className="hidden sm:inline">Hora de la sala: </span>
            <span className="num font-medium text-ink">{fmtDateTime(new Date(now).toISOString())}</span>
          </div>
          {sim?.running && (
            <Badge tone="warn" className="gap-1.5">
              <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
              Simulación ×{sim.speed}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" className="px-2" onClick={toggle} aria-label={dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}>
              {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
            </Button>
            <NavLink to={`${base}/notificaciones`} className="relative rounded-lg p-2 text-ink-2 hover:bg-brand-soft" aria-label={`Notificaciones${unread ? `, ${unread} sin leer` : ''}`}>
              <Bell className="size-[18px]" />
              {unread > 0 && <span className="num absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">{unread > 99 ? '99+' : unread}</span>}
            </NavLink>
            <Button variant="ghost" size="sm" onClick={doLogout} icon={<LogOut className="size-4" />}>
              <span className="hidden sm:inline">Salir</span>
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
