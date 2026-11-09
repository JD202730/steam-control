import { expect, test, type Page } from '@playwright/test'

// Cuentas ficticias de demostración (las mismas del README).
const ADMIN = { email: 'admin@steam.demo', password: 'Admin2026!' }
const USER = { email: 'usuario@steam.demo', password: 'Usuario2026!' }

async function login(page: Page, account: { email: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(account.email)
  await page.getByLabel('Contraseña').fill(account.password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  // El inicio de sesión es asíncrono (verifica el hash): esperar a llegar al panel antes de seguir.
  await page.waitForURL(/\/(admin|user)$/)
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Salir' }).click()
  await expect(page).toHaveURL(/\/login$/)
}

/** Lee el número grande de una tarjeta KPI del panel. */
async function kpi(page: Page, label: string): Promise<number> {
  const card = page.locator('main button').filter({ has: page.getByText(label, { exact: true }) })
  return Number(await card.locator('.font-display').first().innerText())
}

test.describe('acceso y permisos', () => {
  test('rechaza credenciales incorrectas y lleva a cada rol a su panel', async ({ page }) => {
    await page.goto('/')
    // La primera carga genera los datos de demostración: con dos navegadores arrancando a la vez puede tardar.
    await expect(page).toHaveURL(/\/login$/, { timeout: 60_000 })

    await page.getByLabel('Correo').fill(ADMIN.email)
    await page.getByLabel('Contraseña').fill('contraseña-equivocada')
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Credenciales incorrectas')

    await login(page, ADMIN)
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('heading', { name: 'Panel de administración' })).toBeVisible()
    await logout(page)

    await login(page, USER)
    await expect(page).toHaveURL(/\/user$/)
    await expect(page.getByRole('heading', { name: /Hola, Sofía/ })).toBeVisible()
  })

  test('un usuario no puede entrar a las pantallas de administración', async ({ page }) => {
    await login(page, USER)
    await expect(page).toHaveURL(/\/user$/)
    for (const path of ['/admin', '/admin/inventario', '/admin/usuarios', '/admin/simulacion']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/user$/)
    }
    const nav = page.getByRole('navigation', { name: 'Navegación principal' })
    await expect(nav.getByRole('link', { name: 'Catálogo' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Inventario' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Usuarios' })).toHaveCount(0)
  })

  test('sin sesión las rutas protegidas llevan al login y el administrador no ve las del usuario', async ({ page }) => {
    await page.goto('/admin/inventario')
    await expect(page).toHaveURL(/\/login$/)
    await login(page, ADMIN)
    await page.goto('/user/catalogo')
    await expect(page).toHaveURL(/\/admin$/)
  })
})

test.describe('flujo completo de una solicitud', () => {
  test('el usuario pide material, la administración aprueba y entrega, y el usuario recibe los avisos', async ({ page }) => {
    const purpose = `Prueba E2E ${Date.now()}`

    // 1. El usuario arma y envía la solicitud desde el catálogo.
    await login(page, USER)
    await page.goto('/user/catalogo')
    await page.getByRole('searchbox', { name: 'Buscar en el catálogo' }).fill('Cartón')
    await page.getByRole('button', { name: 'Agregar' }).first().click()
    await expect(page.getByText('En tu solicitud ×1')).toBeVisible()
    await page.getByLabel('¿Para qué lo necesitas?').fill(purpose)
    await page.getByRole('button', { name: 'Enviar solicitud' }).click()
    await expect(page).toHaveURL(/\/user\/solicitudes$/)
    const mine = page.locator('main').getByText(purpose)
    await expect(mine).toBeVisible()
    await expect(page.locator('main div').filter({ hasText: purpose }).getByText('Pendiente').first()).toBeVisible()

    // 2. Persistencia: tras recargar, la solicitud y la sesión siguen ahí.
    await page.reload()
    await expect(page.locator('main').getByText(purpose)).toBeVisible()
    await logout(page)

    // 3. La administración aprueba (reserva stock) y entrega.
    await login(page, ADMIN)
    await page.goto('/admin/solicitudes')
    const card = page.locator('main .rounded-xl').filter({ hasText: purpose })
    await card.getByRole('button', { name: 'Aprobar y reservar' }).click()
    await expect(page.getByText('Solicitud aprobada: el material quedó reservado.')).toBeVisible()
    await page.getByRole('tab', { name: /Por entregar/ }).click()
    await page.locator('main .rounded-xl').filter({ hasText: purpose }).getByRole('button', { name: 'Entregar material' }).click()
    await expect(page.getByText('Material entregado.')).toBeVisible()
    await page.getByRole('tab', { name: /Historial/ }).click()
    await expect(page.locator('main .rounded-xl').filter({ hasText: purpose }).getByText('Cerrada')).toBeVisible()
    await logout(page)

    // 4. El usuario ve las notificaciones generadas por cada paso.
    await login(page, USER)
    await page.goto('/user/notificaciones')
    await expect(page.getByRole('button', { name: /^Solicitud aprobada Sin leer/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Material entregado Sin leer Tu solicitud fue entregada/ })).toBeVisible()
  })

  test('aprobar desde el panel actualiza los indicadores al instante', async ({ page }) => {
    await login(page, ADMIN)
    await expect(page.getByRole('heading', { name: 'Panel de administración' })).toBeVisible()
    const pendingBefore = await kpi(page, 'Solicitudes por revisar')
    const toDeliverBefore = await kpi(page, 'Por entregar')
    expect(pendingBefore).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Aprobar' }).first().click()
    await expect(page.getByText('Solicitud aprobada: el material quedó reservado.')).toBeVisible()
    await expect.poll(() => kpi(page, 'Solicitudes por revisar')).toBe(pendingBefore - 1)
    await expect.poll(() => kpi(page, 'Por entregar')).toBe(toDeliverBefore + 1)
  })
})

test.describe('impresoras y mantenimiento', () => {
  test('no permite reservar dos veces la misma franja', async ({ page }) => {
    await login(page, USER)
    await page.goto('/user/impresoras')
    await page.getByLabel('Impresora').selectOption({ label: 'Creality K1' })

    await page.getByLabel('¿Qué vas a imprimir?').fill('Primera reserva')
    await page.getByRole('button', { name: 'Reservar', exact: true }).click()
    await expect(page.getByText('Reserva confirmada.')).toBeVisible()

    await page.getByLabel('¿Qué vas a imprimir?').fill('Segunda reserva en la misma hora')
    await page.getByRole('button', { name: 'Reservar', exact: true }).click()
    await expect(page.getByText(/ya está reservada/)).toBeVisible()
  })

  test('una falla genera alerta y mantenimiento correctivo, y al repararla la impresora vuelve a estar disponible', async ({ page }) => {
    await login(page, ADMIN)
    await page.goto('/admin/impresoras')
    const prusa = page.locator('main .rounded-xl').filter({ has: page.getByRole('heading', { name: 'Prusa MK4' }) }).first()
    await prusa.getByRole('button', { name: 'Falla' }).click()
    await page.getByLabel('¿Qué pasó?').fill('La boquilla se obstruyó')
    await page.getByRole('button', { name: 'Reportar falla' }).click()
    await expect(page.getByText(/Falla registrada/)).toBeVisible()
    await expect(prusa.getByText('Con falla')).toBeVisible()

    await page.goto('/admin/alertas')
    await expect(page.getByText('Prusa MK4 con falla')).toBeVisible()

    await page.goto('/admin/mantenimiento')
    const row = page.locator('tbody tr').filter({ hasText: 'Reparación: La boquilla se obstruyó' })
    await expect(row).toContainText('Por falla')
    await row.getByRole('button', { name: 'Iniciar' }).click()
    await expect(page.getByText('Mantenimiento iniciado.')).toBeVisible()
    await row.getByRole('button', { name: 'Completar' }).click()
    await page.getByRole('button', { name: 'Completar', exact: true }).last().click()
    await expect(page.getByText('Mantenimiento completado.')).toBeVisible()

    await page.goto('/admin/impresoras')
    await expect(page.locator('main .rounded-xl').filter({ has: page.getByRole('heading', { name: 'Prusa MK4' }) }).first().getByText('Disponible')).toBeVisible()
  })
})

test.describe('inventario y análisis', () => {
  test('el administrador registra una entrada de stock, queda en el historial y la coherencia se mantiene', async ({ page }) => {
    await login(page, ADMIN)
    await page.goto('/admin/inventario')
    const row = page.locator('tbody tr').filter({ hasText: 'Cables jumper' })
    await row.getByRole('button', { name: 'Entrada de Cables jumper' }).click()
    await page.getByLabel('Cantidad').fill('50')
    await page.getByRole('button', { name: 'Registrar', exact: true }).click()
    await expect(page.getByText('Entrada registrada.')).toBeVisible()

    await row.getByRole('button', { name: 'Movimientos de Cables jumper' }).click()
    await expect(page.getByRole('dialog').getByText('Compra').first()).toBeVisible()
    await page.getByRole('button', { name: 'Cerrar' }).first().click()

    await page.getByRole('button', { name: 'Verificar coherencia' }).click()
    await expect(page.getByText('Inventario coherente')).toBeVisible()
  })

  test('las gráficas se dibujan y se pueden ver como tabla', async ({ page }) => {
    await login(page, ADMIN)
    await page.goto('/admin/analitica')
    await expect(page.getByRole('heading', { name: 'Analítica' })).toBeVisible()
    await expect(page.locator('svg.recharts-surface').first()).toBeVisible()
    expect(await page.locator('svg.recharts-surface').count()).toBeGreaterThanOrEqual(6)
    await page.getByRole('button', { name: 'Ver tabla' }).first().click()
    await expect(page.locator('main table').first()).toBeVisible()
    await page.getByRole('tab', { name: '30 días' }).click()
    await expect(page.getByText('Últimos 30 días').first()).toBeVisible()
  })
})

test.describe('simulación', () => {
  test('al iniciarla el tiempo se acelera, ocurre actividad y el inventario sigue coherente', async ({ page }) => {
    await login(page, ADMIN)
    await page.goto('/admin/simulacion')
    await page.getByRole('radio', { name: /Semana de proyectos/ }).click()
    await page.getByRole('radio', { name: '×300' }).click()
    await page.getByRole('button', { name: 'Iniciar simulación' }).click()
    await expect(page.getByText('Simulación ×300')).toBeVisible()

    // Tras unos segundos se han ejecutado pasos y han ocurrido cosas en la sala.
    const steps = page.locator('li').filter({ hasText: 'Pasos de simulación' }).locator('.num')
    await expect.poll(async () => Number(await steps.innerText()), { timeout: 30_000 }).toBeGreaterThan(3)

    await page.getByRole('button', { name: 'Pausar simulación' }).click()
    await expect(page.getByText('Simulación ×300')).toHaveCount(0)
    await page.getByRole('button', { name: 'Verificar coherencia del inventario' }).click()
    await expect(page.getByText('Inventario coherente')).toBeVisible()
  })
})
