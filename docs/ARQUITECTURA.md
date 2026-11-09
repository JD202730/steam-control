# Arquitectura

## Decisión principal: aplicación de navegador con base de datos local

STEAM Control es un **simulador**. Para poder desplegarlo sin servidores, sin secretos y con pruebas reproducibles, toda la lógica corre en el navegador y los datos viven en **IndexedDB** (a través de Dexie). La capa de servicios tiene la forma que tendría una API, de modo que migrar a un backend (Supabase, Postgres…) no obliga a reescribir la interfaz.

Consecuencias aceptadas:

- Los datos no se comparten entre dispositivos (cada navegador tiene su sala).
- Los roles protegen la lógica de la aplicación, pero no son seguridad de servidor.

## Capas

```
pages  →  modules  →  core  →  shared
(finas)   (dominio)   (infra)   (UI, formatos)
```

- **`pages/`**: pantallas finas que componen componentes y llaman a servicios.
- **`modules/<x>/`**: cada funcionalidad con sus tipos, su servicio (reglas de negocio) y sus componentes. Los servicios reciben siempre el *actor* (quién actúa) como primer argumento.
- **`core/`**: base de datos (`db`), transacciones (`runTx`), reloj (`clock`), bus de eventos, permisos, autenticación y utilidades.
- **`app/`**: arranque (`bootstrap`), rutas con guardas y el proceso en segundo plano (`runtime`).

> Nota sobre los repositorios: la capa de acceso a datos son las tablas tipadas de Dexie (`core/db/db.ts`); los servicios las usan directamente y la lectura "en vivo" para la interfaz está en `modules/data-hooks.ts`.

## Comunicación entre módulos

Los módulos no se llaman entre sí para reaccionar a cambios: publican **eventos de dominio** (`core/events`) y quien le interese se suscribe.

| Evento | Quién reacciona |
|---|---|
| `request.created` | Notificaciones → administración |
| `request.approved` / `rejected` / `delivered` / `closed` / `cancelled` | Notificaciones → solicitante |
| `stock.low` / `stock.out` | Notificaciones → administración |
| `printer.failed` | **Mantenimiento** abre una tarea correctiva · Notificaciones → administración y dueño del trabajo |
| `maintenance.due` | **Mantenimiento** programa un preventivo · Notificaciones → administración |
| `reservation.affected` | Notificaciones → dueño de la reserva |
| `job.completed`, `maintenance.started` / `completed` | Notificaciones |

Los eventos se **encolan dentro de la transacción y se publican al confirmarla** (`runTx`), de modo que quien reacciona siempre ve datos consistentes.

## Transacciones: una regla importante de Dexie

`runTx(tablas, fn)` ejecuta `fn` en una sola transacción atómica. Con `async/await` nativo, Dexie pierde el rastro de la transacción si se **anidan funciones `async` propias** dentro de otras (lanza `PrematureCommitError`). Por eso, dentro de `runTx`:

1. Solo se usan las tablas declaradas.
2. No se espera nada ajeno a Dexie (`fetch`, `crypto`, temporizadores).
3. Las funciones auxiliares que se llaman desde la transacción (`applyMovement`, `writeAudit`, `saveSettlement`…) **solo esperan operaciones de Dexie**, nunca otra función `async` propia.

El código está estructurado para cumplirlo (por ejemplo, la liquidación de un trabajo de impresión se divide en funciones puras que calculan y funciones de un solo nivel que guardan). Las pruebas recorren todas las rutas para detectar cualquier violación.

## Autenticación y roles

- Inicio de sesión con correo y contraseña. Las contraseñas se guardan con **PBKDF2-SHA256** (100 000 iteraciones, sal aleatoria) y se comparan en tiempo constante.
- La sesión vive en `sessionStorage` con caducidad de 8 horas y se **revalida contra la base de datos** al cargar (el rol siempre sale de la base, no del valor guardado).
- Roles `admin` y `user` con una tabla de permisos finos (`core/permissions/roles.ts`). Cada servicio llama a `assertCan(actor, permiso)` antes de hacer nada; la interfaz además oculta lo que no corresponde (`<Can>`) y las rutas tienen guardas por rol.
- No se guarda ninguna credencial real: las cuentas de demostración son ficticias.

## Reloj y simulación

Todo el dominio lee la hora de `clock`, que admite:

- **Velocidad** (×1, ×10, ×60, ×300) sin saltos: un ancla (`real`, `virtual`, `speed`).
- **Congelar** el tiempo (pruebas y generación del historial).
- Restaurarse al abrir la app (mientras estuvo cerrada el tiempo corre a velocidad real).

El **motor de simulación** (`modules/simulation`) usa un generador pseudoaleatorio con semilla y actúa **a través de los mismos servicios** que la interfaz (crea solicitudes, las aprueba, entrega, imprime, reporta fallas, repone stock, inicia mantenimientos). Por eso cada paso respeta —y prueba— las reglas de coherencia.

El **proceso en segundo plano** (`app/runtime.ts`) corre cada segundo: avanza los trabajos de impresión según el reloj, vence reservas y ejecuta un paso de la simulación. Con varias pestañas abiertas solo una lo ejecuta (Web Locks); las demás sincronizan su reloj.

## Datos de demostración

`seed/seed.ts` genera ~35 días de historial **"viajando en el tiempo"**: congela el reloj en cada fecha y ejecuta solicitudes, aprobaciones, entregas, devoluciones, reservas, impresiones, fallas y mantenimientos con los servicios reales. El resultado es coherente por construcción (lo verifica `verifyLedger`).

## Interfaz

React 19 + Tailwind CSS 4. Identidad visual propia ("cuaderno de taller"), modo claro y oscuro, navegación lateral por rol, páginas cargadas bajo demanda. Las gráficas usan una paleta categórica validada para daltonismo, leyenda siempre presente y alternancia **gráfica / tabla**.
