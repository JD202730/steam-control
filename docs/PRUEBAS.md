# Pruebas

## Cómo ejecutarlas

```bash
npm run typecheck   # tipos (TypeScript estricto)
npm run lint        # análisis estático
npm test            # unitarias y de integración (Vitest + IndexedDB simulado)
npm run e2e         # extremo a extremo (Playwright, navegador real)
npm run build       # compilación de producción
```

## Estrategia

| Nivel | Qué cubre | Dónde |
|---|---|---|
| **Servicios con base de datos real** (Vitest + `fake-indexeddb`) | Reglas de negocio, permisos, validación, transacciones, eventos y coherencia del inventario | `src/**/*.test.ts` |
| **Datos de demostración y simulación** | El historial generado es coherente; la simulación acelerada mantiene el inventario cuadrado tras cientos de pasos | `src/seed/seed.test.ts` |
| **Extremo a extremo** (Playwright + Edge/Chromium) | Flujos completos desde la interfaz, permisos por rol, persistencia tras recargar, gráficas, simulación | `e2e/flows.spec.ts` |

Las pruebas de servicios usan la base de datos de verdad (no *mocks*) y un reloj congelado, así que los casos de tiempo (avance de impresiones, vencimientos, horas de mantenimiento) son deterministas.

## Qué se verifica

- **Permisos**: un usuario no puede aprobar, entregar, crear artículos ni usuarios, ni cancelar solicitudes ajenas; sin sesión no se puede nada; las rutas de administración redirigen a un usuario; el administrador no entra a las del usuario.
- **Inventario**: invariantes del stock, movimientos atómicos (un fallo no deja rastro), SKU duplicado, entradas y ajustes con motivo, eventos de stock bajo/agotado, y que `verifyLedger` detecta una alteración manual.
- **Solicitudes**: flujo completo de consumibles y de herramientas (con devolución parcial), aprobación todo-o-nada, cancelación que libera stock, transiciones inválidas, validaciones, fusión de líneas repetidas y devoluciones vencidas.
- **Impresoras**: reservas sin solapes y franjas contiguas, límites de duración y de reservas por usuario, inicio de trabajos con reserva de filamento, avance por reloj, cancelación y falla a mitad de trabajo, y mantenimiento preventivo automático por horas.
- **Mantenimiento**: programar marca las reservas afectadas, cancelar las restaura, no se puede iniciar con la impresora imprimiendo, repuestos que descuentan stock, completar reinicia las horas, y reparación completa tras una falla.
- **Notificaciones y alertas**: cada evento avisa a quien corresponde; las alertas aparecen y desaparecen al cambiar los datos y el reconocimiento se limpia al resolverse el problema.
- **Persistencia**: los datos y la sesión sobreviven a recargar la página (E2E).
- **Gráficas y alertas reaccionan**: aprobar una solicitud desde el panel cambia los indicadores al instante (E2E); las gráficas se dibujan y se pueden ver como tabla (E2E).

## Resultado de la última ejecución

- `npm run typecheck`: sin errores.
- `npm test`: **69 pruebas** en 7 archivos, todas correctas.
- `npm run e2e`: **10 pruebas**, todas correctas.
- `npm run build`: compila sin errores.

## Qué no cubre

- Pruebas visuales automatizadas (las capturas de `docs/img` se generan con `scripts/screenshots.mjs` pero no se comparan).
- Compatibilidad con navegadores distintos de Chromium en las pruebas E2E.
- Pruebas de carga o de grandes volúmenes de datos.
