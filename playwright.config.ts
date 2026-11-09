import { defineConfig } from '@playwright/test'

/**
 * Pruebas de extremo a extremo (navegador real). Cada prueba abre un contexto limpio, así que
 * carga sus propios datos de demostración. En local usa Microsoft Edge (ya instalado en Windows);
 * en CI usa Chromium (`npx playwright install chromium`).
 *
 * Para probar un sitio ya desplegado: E2E_BASE_URL=https://steam-control.vercel.app npm run e2e
 */
const remote = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: remote ?? 'http://localhost:5173',
    channel: process.env.CI ? undefined : 'msedge',
    locale: 'es-ES',
    timezoneId: 'America/Bogota',
    trace: 'retain-on-failure',
  },
  webServer: remote
    ? undefined
    : {
        command: 'npm run dev -- --port 5173 --strictPort',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 60_000,
      },
})
