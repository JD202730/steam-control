import { lazy, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { useSession } from '@/core/auth/session'
import type { Role } from '@/core/permissions/roles'
import { ToastProvider } from '@/shared/ui/Toast'
import { Button } from '@/shared/ui/Button'
import { Spinner } from '@/shared/ui/Misc'
import { AppLayout } from './AppLayout'
import { bootstrap } from './bootstrap'
import { startRuntime } from './runtime'

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'))
const NotificationsPage = lazy(() => import('@/pages/shared/NotificationsPage'))
const ProfilePage = lazy(() => import('@/pages/shared/ProfilePage'))
const UserDashboard = lazy(() => import('@/pages/user/UserDashboard'))
const CatalogPage = lazy(() => import('@/pages/user/CatalogPage'))
const MyRequestsPage = lazy(() => import('@/pages/user/MyRequestsPage'))
const UserPrintersPage = lazy(() => import('@/pages/user/UserPrintersPage'))
const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'))
const InventoryPage = lazy(() => import('@/pages/admin/InventoryPage'))
const AdminRequestsPage = lazy(() => import('@/pages/admin/AdminRequestsPage'))
const AdminPrintersPage = lazy(() => import('@/pages/admin/AdminPrintersPage'))
const MaintenancePage = lazy(() => import('@/pages/admin/MaintenancePage'))
const AnalyticsPage = lazy(() => import('@/pages/admin/AnalyticsPage'))
const AlertsPage = lazy(() => import('@/pages/admin/AlertsPage'))
const UsersPage = lazy(() => import('@/pages/admin/UsersPage'))
const SimulationPage = lazy(() => import('@/pages/admin/SimulationPage'))

const homeFor = (role: Role) => (role === 'admin' ? '/admin' : '/user')

/** Guarda de ruta: exige sesión y el rol correcto; si no, redirige. */
function RequireRole({ role }: { role: Role }) {
  const user = useSession((s) => s.user)
  const status = useSession((s) => s.status)
  const location = useLocation()
  if (status === 'checking') return <Spinner label="Verificando tu sesión…" />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />
  return <AppLayout />
}

function HomeRedirect() {
  const user = useSession((s) => s.user)
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />
}

function NotFound() {
  const user = useSession((s) => s.user)
  return (
    <div className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <p className="font-display text-6xl font-semibold text-brand">404</p>
        <h1 className="mt-2 text-xl font-semibold">Esta página no existe</h1>
        <p className="mt-1 text-muted">Revisa la dirección o vuelve al inicio.</p>
        <a href={user ? homeFor(user.role) : '/login'} className="mt-5 inline-block">
          <Button variant="primary">Ir al inicio</Button>
        </a>
      </div>
    </div>
  )
}

function Splash({ error, onRetry }: { error?: string; onRetry: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center px-6 text-center">
      {error ? (
        <div className="max-w-sm">
          <h1 className="text-xl font-semibold">No pudimos preparar la base de datos local</h1>
          <p className="mt-2 text-sm text-muted">{error}</p>
          <p className="mt-2 text-sm text-muted">Revisa que tu navegador permita guardar datos del sitio (no uses una ventana privada restringida).</p>
          <Button variant="primary" className="mt-4" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      ) : (
        <Spinner label="Preparando la Sala STEAM… la primera vez tarda unos segundos." />
      )}
    </div>
  )
}

function Shell() {
  const [state, setState] = useState<{ ready: boolean; error?: string }>({ ready: false })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    bootstrap()
      .then(() => {
        if (cancelled) return
        setState({ ready: true })
        stop = startRuntime()
      })
      .catch((e: unknown) => !cancelled && setState({ ready: false, error: e instanceof Error ? e.message : String(e) }))
    return () => {
      cancelled = true
      stop?.()
    }
  }, [attempt])

  if (!state.ready) return <Splash error={state.error} onRetry={() => setAttempt((n) => n + 1)} />

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/user" element={<RequireRole role="user" />}>
        <Route index element={<UserDashboard />} />
        <Route path="catalogo" element={<CatalogPage />} />
        <Route path="solicitudes" element={<MyRequestsPage />} />
        <Route path="impresoras" element={<UserPrintersPage />} />
        <Route path="notificaciones" element={<NotificationsPage />} />
        <Route path="perfil" element={<ProfilePage />} />
      </Route>
      <Route path="/admin" element={<RequireRole role="admin" />}>
        <Route index element={<AdminDashboard />} />
        <Route path="inventario" element={<InventoryPage />} />
        <Route path="solicitudes" element={<AdminRequestsPage />} />
        <Route path="impresoras" element={<AdminPrintersPage />} />
        <Route path="mantenimiento" element={<MaintenancePage />} />
        <Route path="analitica" element={<AnalyticsPage />} />
        <Route path="alertas" element={<AlertsPage />} />
        <Route path="usuarios" element={<UsersPage />} />
        <Route path="simulacion" element={<SimulationPage />} />
        <Route path="notificaciones" element={<NotificationsPage />} />
        <Route path="perfil" element={<ProfilePage />} />
      </Route>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </BrowserRouter>
  )
}
