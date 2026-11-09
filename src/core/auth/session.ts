import { create } from 'zustand'
import { db } from '../db/db'
import { authenticate, type SessionUser } from './authService'

const KEY = 'steam-session'
const TTL_MS = 8 * 60 * 60 * 1000

function load(): SessionUser | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as { user: SessionUser; expiresAt: number }
    if (!stored.user || stored.expiresAt < Date.now()) {
      sessionStorage.removeItem(KEY)
      return null
    }
    return stored.user
  } catch {
    return null
  }
}

function save(user: SessionUser | null): void {
  try {
    if (user) sessionStorage.setItem(KEY, JSON.stringify({ user, expiresAt: Date.now() + TTL_MS }))
    else sessionStorage.removeItem(KEY)
  } catch {
    /* sessionStorage no disponible: la sesión vive solo en memoria */
  }
}

interface SessionState {
  user: SessionUser | null
  /** 'checking' mientras se revalida la sesión guardada contra la base de datos. */
  status: 'checking' | 'ready'
  login: (email: string, password: string) => Promise<SessionUser>
  logout: () => void
  /** Revalida la sesión guardada: si el usuario ya no existe o está desactivado, la cierra. */
  refresh: () => Promise<void>
}

const initial = load()

export const useSession = create<SessionState>((set, get) => ({
  user: initial,
  status: initial ? 'checking' : 'ready',

  async login(email, password) {
    const user = await authenticate(email, password)
    save(user)
    set({ user, status: 'ready' })
    return user
  },

  logout() {
    save(null)
    set({ user: null, status: 'ready' })
  },

  async refresh() {
    const current = get().user
    if (!current) {
      set({ status: 'ready' })
      return
    }
    const fresh = await db.users.get(current.id)
    if (!fresh || fresh.status !== 'active') {
      get().logout()
      return
    }
    // El rol siempre se toma de la base de datos, no del valor guardado en el navegador.
    const user: SessionUser = { id: fresh.id, name: fresh.name, email: fresh.email, role: fresh.role }
    save(user)
    set({ user, status: 'ready' })
  },
}))
