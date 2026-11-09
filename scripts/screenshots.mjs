// Genera las capturas del README: `node scripts/screenshots.mjs` (con `npm run dev` en marcha).
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = 'docs/img'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'msedge' })

async function session(colorScheme, account) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme, locale: 'es-ES', timezoneId: 'America/Bogota' })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`)
  await page.getByLabel('Correo').waitFor({ timeout: 60_000 })
  return { ctx, page, account }
}

async function login(page, account) {
  await page.getByLabel('Correo').fill(account.email)
  await page.getByLabel('Contraseña').fill(account.password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL(/\/(admin|user)$/)
}

async function shot(page, path, name, wait = 1800) {
  await page.goto(`${BASE}${path}`)
  await page.waitForTimeout(wait)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('captura', name)
}

const ADMIN = { email: 'admin@steam.demo', password: 'Admin2026!' }
const USER = { email: 'usuario@steam.demo', password: 'Usuario2026!' }

// Modo claro
{
  const { ctx, page } = await session('light')
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/login.png` })
  console.log('captura login')
  await login(page, ADMIN)
  await shot(page, '/admin', 'admin-panel')
  await shot(page, '/admin/inventario', 'admin-inventario')
  await shot(page, '/admin/solicitudes', 'admin-solicitudes')
  await shot(page, '/admin/impresoras', 'admin-impresoras')
  await shot(page, '/admin/mantenimiento', 'admin-mantenimiento')
  await shot(page, '/admin/analitica', 'admin-analitica', 2600)
  await shot(page, '/admin/simulacion', 'admin-simulacion')
  await ctx.close()
}
{
  const { ctx, page } = await session('light')
  await login(page, USER)
  await shot(page, '/user', 'usuario-panel')
  await shot(page, '/user/catalogo', 'usuario-catalogo')
  await shot(page, '/user/impresoras', 'usuario-impresoras')
  await ctx.close()
}
// Modo oscuro
{
  const { ctx, page } = await session('dark')
  await login(page, ADMIN)
  await shot(page, '/admin', 'admin-panel-oscuro')
  await shot(page, '/admin/analitica', 'admin-analitica-oscuro', 2600)
  await ctx.close()
}
// Teléfono
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', locale: 'es-ES', timezoneId: 'America/Bogota', isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`)
  await page.getByLabel('Correo').waitFor({ timeout: 60_000 })
  await login(page, USER)
  await shot(page, '/user/catalogo', 'movil-catalogo')
  await page.getByRole('button', { name: 'Abrir menú' }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/movil-menu.png` })
  console.log('captura movil-menu')
  await ctx.close()
}
await browser.close()
