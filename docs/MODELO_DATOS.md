# Modelo de datos

Base de datos local `steam-control` (IndexedDB, esquema versionado en `src/core/db/db.ts`). Todas las fechas se guardan como ISO 8601 en UTC.

## Entidades

| Tabla | Campos clave | Relaciones |
|---|---|---|
| `users` | nombre, correo (único), hash de contraseña, rol, estado, área | — |
| `categories` | nombre (único) | agrupa artículos |
| `items` | sku (único), nombre, tipo (consumible, herramienta, equipo, filamento), unidad, **existencias**, **reservado**, mínimo, costo, activo | categoría |
| `movements` | artículo, tipo, cantidad, **delta de existencias y de reservado**, saldos tras el movimiento, motivo, origen (solicitud, trabajo, mantenimiento), actor, fecha | artículo |
| `requests` / `requestLines` | solicitante, propósito, fechas, estado, decisión / artículo, cantidad, entregado, devuelto, ¿se devuelve? | usuario, artículos |
| `printers` | nombre, modelo, estado, horas totales y desde el último mantenimiento, intervalo de mantenimiento, trabajo actual | — |
| `reservations` | impresora, usuario, inicio, fin, estado, trabajo | impresora, usuario |
| `jobs` | reserva, impresora, usuario, filamento, gramos estimados y usados, duración, avance, estado | reserva, artículo |
| `maintenance` / `partUses` | impresora, tipo, origen (manual, horas, falla), estado, horario, costos / tarea, artículo, cantidad, costo unitario | impresora, artículos |
| `notifications` | destinatario, tipo, gravedad, texto, referencia, leída | usuario |
| `alertAcks` | clave de alerta, quién la vio | — |
| `audit` | actor, acción, entidad, fecha | cualquiera |
| `sim`, `meta` | estado de la simulación, bandera de datos cargados | — |

Las **alertas no se guardan**: se calculan desde los datos (`modules/notifications/alerts.ts`). Solo se guarda su reconocimiento.

## Máquinas de estados

```
Solicitud   pending → approved → delivered → closed
            pending → rejected | cancelled
            approved → cancelled          (libera la reserva)
            (sin nada que devolver, delivered pasa directo a closed)

Reserva     confirmed → in_progress → completed
            confirmed → cancelled | expired | affected (por mantenimiento) ⇄ confirmed

Trabajo     printing → completed | failed | cancelled

Mantenim.   scheduled → in_progress → done
            scheduled → cancelled

Impresora   idle ⇄ printing · idle ⇄ offline · idle/printing → error → maintenance → idle
```

Las transiciones válidas están codificadas (`REQUEST_TRANSITIONS`) y cada servicio rechaza las demás con un error `CONFLICT`.

## Cómo se garantiza la coherencia

1. **Un único punto de entrada para el stock.** Nadie escribe `onHand` ni `reserved` directamente: todo pasa por `applyMovement`, que escribe el movimiento y actualiza el artículo en la **misma transacción**. Invariantes siempre verdaderas: `existencias ≥ 0`, `0 ≤ reservado ≤ existencias`.

   | Movimiento | Existencias | Reservado |
   |---|---|---|
   | entrada / devolución | + | |
   | salida | − | |
   | reserva | | + |
   | liberación | | − |
   | entrega (de lo reservado) | − | − |
   | ajuste por conteo (±) | ± | |

2. **El libro cuadra con las existencias.** `verifyLedger()` suma los movimientos de cada artículo y compara con lo guardado; detecta cualquier alteración manual.
3. **Todo o nada.** Aprobar una solicitud reserva todas sus líneas en una transacción: si una línea no alcanza, no se reserva ninguna. Cancelar libera; entregar convierte lo reservado en salida.
4. **Reservas sin solapes.** La comprobación se hace dentro de la transacción; una franja `afectada` por mantenimiento sigue ocupada, y no se puede reservar durante un mantenimiento programado.
5. **Mantenimiento coherente.** Iniciarlo pone la impresora en `maintenance` (y no se permite si está imprimiendo); completarlo la deja `idle` y reinicia su contador de horas; los repuestos descuentan stock por el mismo servicio de inventario. Cancelar o completar devuelve a "confirmada" las reservas que ya no chocan.
6. **Los trabajos de impresión consumen filamento por avance.** Al iniciar se reserva; con el reloj se entrega proporcionalmente; si falla o se cancela, el resto se libera.
7. **Sin borrados que rompan el historial.** Lo que tiene historia se desactiva, no se borra; no se puede desactivar un artículo con reservas abiertas ni quitar al último administrador.
8. **Validación en la frontera.** Zod valida cada entrada de los servicios; los mensajes están en español.
9. **Auditoría.** Cada acción relevante queda en la bitácora.
