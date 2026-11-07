# Roadmap de OpenSport

Plan de desarrollo por fases, con tickets pequeños y entregables que se pueden usar desde el final de cada fase.

Referencias: [arquitectura.md](arquitectura.md) · [hallazgos.md](hallazgos.md) · [prototipos](prototipos/index.html)

## Visión general

| Fase | Objetivo | Entregable usable | Hito |
|---|---|---|---|
| **0 · Fundaciones** | Repositorio, CI y entornos listos | Despliegue vacío en Railway y Vercel | — |
| **1 · Backend en Railway** | Sincronizar y guardar las actividades en la nube | API con tus actividades, sincronizada sola cada 15 min | **M1: «mis datos viven en OpenSport»** |
| **2 · PWA MVP** | Ver las actividades en escritorio y móvil | PWA instalable con feed, detalle con mapa y botón Sync | **M2: «uso OpenSport en vez de Strava para ver mis actividades»** |
| **3 · Métricas avanzadas** | Las métricas «Premium», hechas por nosotros | Pantalla de estadísticas completa | **M3: «sé cómo voy de forma»** |
| **4 · Avisos, histórico y privacidad** | Notificaciones, todo el histórico y compartir con seguridad | Push, importación del ZIP de Strava, zonas de privacidad | **M4: «OpenSport sustituye a Strava»** |
| **5 · App Android (React Native)** | App con Expo sobre el código compartido, sincronización en segundo plano y FCM | App en Play Store (pruebas internas) | **M5: app Android** |
| **6 · Salud multifuente** | Sueño, VFC y datos diarios de Garmin y de Google Health (Fitbit Air), sin duplicados | Panel de salud | **M6: «veo mi recuperación, venga de donde venga»** |
| **7 · Asistente con IA** | Resúmenes, análisis y preguntas en lenguaje natural con un LLM pequeño (Claude Haiku 5.5) | Resumen por actividad, informe semanal y chat «Coach» | **M7: «le pregunto a OpenSport cómo voy»** |

**Estimación de tamaño:** S ≈ medio día · M ≈ 1–2 días · L ≈ 3–5 días.

**Reglas de trabajo:**
- Un ticket = una rama = una PR pequeña con tests.
- Cada fase termina con algo desplegado y usable.
- Todo lo que no sea crítico para el hito de la fase pasa a la siguiente.

---

## Ya hecho (fase de descubrimiento)

| Ticket | Qué | Resultado |
|---|---|---|
| OS-D01 | Investigar las fuentes de datos (Strava, Garmin, móvil, USB, intermediarios) | [hallazgos.md](hallazgos.md) |
| OS-D02 | Prototipo de sincronización con la Garmin Personal API | `sync/garmin_sync.py`, 72 actividades descargadas |
| OS-D03 | Validar que el FIT de la API es el original completo | Idéntico byte a byte al «Exportar archivo» |
| OS-D04 | Arquitectura (Railway + Vercel + Android) | [arquitectura.md](arquitectura.md) |
| OS-D05 | Prototipos de escritorio y móvil con datos reales | [prototipos/](prototipos/index.html) |

---

## Fase 0 · Fundaciones

**Objetivo:** cualquier cambio llega a producción con un `git push`.

- **OS-001 · Repositorio y estructura** (S)
  - Repositorio en GitHub (privado), monorepo con pnpm workspaces: `backend/`, `apps/web/`, `apps/mobile/` (vacío hasta la fase 5), `packages/core/`, `docs/` y `tools/`. `README`, licencia y `.gitignore` (incluidos `.env`, `data/` y `docs/prototipos/data.js`).
  - *Hecho cuando:* el repositorio existe y no contiene datos personales ni secretos.
- **OS-002 · Herramientas del backend** (S) · depende de OS-001
  - Python 3.12+, `uv`, `ruff`, `mypy` y `pytest`, con `pre-commit`.
  - *Hecho cuando:* `uv run pytest` y `ruff check` pasan en local.
- **OS-003 · Herramientas de la web** (S) · depende de OS-001
  - Vite + React + TypeScript, `eslint`, `prettier`, `vitest` y pnpm.
  - *Hecho cuando:* `pnpm dev`, `pnpm test` y `pnpm build` funcionan.
- **OS-008 · Paquete compartido `packages/core`** (S) · depende de OS-003
  - TypeScript estricto. Generación del cliente de la API desde OpenAPI, utilidades de formato y dominio (las del prototipo), tokens de diseño en JSON. Tests con vitest. La PWA lo consume desde el primer día.
- **OS-004 · CI en GitHub Actions** (S) · depende de OS-002 y OS-003
  - Lint, tests y build del backend y la web en cada PR.
  - *Hecho cuando:* una PR muestra los checks en verde.
- **OS-005 · Proyecto en Railway** (S) · depende de OS-002
  - Servicio API con Dockerfile, Postgres, volumen `/data` y variables de entorno (`GARMIN_PERSONAL_API_KEY`, `JWT_SECRET`, `DATABASE_URL`). Despliegue automático desde `main`.
  - *Hecho cuando:* `GET /api/health` responde en la URL de Railway.
- **OS-006 · Proyecto en Vercel** (S) · depende de OS-003 y OS-005
  - Build de `web/`, `vercel.json` con `rewrites /api/* → Railway` y previsualizaciones por PR.
  - *Hecho cuando:* la web vacía llama a `/api/health` a través del proxy.
- **OS-007 · Rotar la clave de Garmin** (S)
  - Borrar la clave que se pegó en el chat, crear otra y guardarla solo en Railway y en el `.env` local.
  - *Hecho cuando:* la clave antigua da 401.

## Fase 1 · Backend en Railway → **M1**

**Objetivo:** las actividades se sincronizan solas y quedan guardadas, parseadas y servidas por la API.

- **OS-101 · Paquete `opensport` y configuración** (S) · depende de OS-002
  - Estructura `opensport/{api,sync,fit,metrics,db,core}`. Configuración con `pydantic-settings` y logging estructurado.
- **OS-102 · Esquema de base de datos y migraciones** (M) · depende de OS-101
  - SQLAlchemy + Alembic. Tablas `activities`, `laps`, `streams`, `sync_runs`, `settings`, `users` y `devices` (modelo de [arquitectura.md](arquitectura.md)).
  - *Hecho cuando:* `alembic upgrade head` crea el esquema en local y en Railway.
- **OS-103 · Cliente de la Garmin Personal API** (M) · depende de OS-101
  - Pasar `garmin_sync.py` a un módulo: token con caché (en la base de datos, no en un fichero), lista paginada, descarga del ZIP y extracción del FIT, reintentos ante 429.
  - *Hecho cuando:* tests con respuestas grabadas (VCR) cubren token, lista y descarga.
- **OS-104 · Almacén de FIT originales** (S) · depende de OS-101
  - `/data/raw/{activityId}.fit` inmutable, con su `sha256` guardado. Interfaz que permita cambiar a almacenamiento de objetos más adelante.
- **OS-105 · Parser FIT → modelo normalizado** (M) · depende de OS-102
  - Sesión, vueltas, series a 1 Hz (lat, lon, distancia, altitud, FC, cadencia ×2, velocidad, potencia, temperatura) y dispositivo. Semicírculos → grados.
  - *Hecho cuando:* tests con los FIT de carrera, fuerza y ROUVY cuadran con las cifras de Garmin.
- **OS-106 · Ingesta: guardar actividad, vueltas y series** (M) · depende de OS-104 y OS-105
  - Idempotente por `activityId`. Series comprimidas. Recorrido simplificado para miniaturas y `bbox`.
- **OS-107 · Métricas básicas al importar** (M) · depende de OS-106
  - Ritmo y velocidad suavizados, parciales por km y mejores tiempos (400 m … maratón), validados con las cifras de Strava de [hallazgos.md](hallazgos.md).
- **OS-108 · Orquestador de sincronización** (M) · depende de OS-103 y OS-106
  - `sync_run` con estado y progreso, incremental desde la última sincronización y bloqueo para que no haya dos a la vez.
  - *Hecho cuando:* `python -m opensport.sync` importa lo nuevo y una segunda ejecución no hace nada.
- **OS-109 · Cron en Railway** (S) · depende de OS-108
  - Cron Job cada 15 min.
  - *Hecho cuando:* una actividad nueva del reloj aparece en la base de datos sin intervención.
- **OS-110 · Autenticación** (L) · depende de OS-102
  - Un usuario. Inicio de sesión con contraseña + TOTP (las passkeys, en OS-405). Cookie de sesión `httpOnly` para la web y token de acceso y de refresco para Android. Límite de intentos.
  - *Hecho cuando:* todas las rutas salvo `/health` y `/auth/*` devuelven 401 sin sesión.
- **OS-111 · API de actividades** (M) · depende de OS-107 y OS-110
  - `GET /api/activities` (paginado por cursor y con filtros), `GET /api/activities/{id}`, `/streams` (gzip) y `/fit`. OpenAPI publicado.
- **OS-112 · API de sincronización** (S) · depende de OS-108 y OS-110
  - `POST /api/sync` y `GET /api/sync/{id}` con el progreso.
- **OS-113 · Carga inicial del histórico de Garmin** (S) · depende de OS-108
  - Comando `sync --since AAAA-MM-DD`, con pausas, para traer todo lo que haya en Garmin Connect.
- **OS-114 · Observabilidad y copias de seguridad** (S) · depende de OS-005
  - Registros de errores (Sentry o similar), alerta si la sincronización falla 3 veces seguidas, copia diaria de Postgres y del volumen.
- **OS-115 · Cola de trabajos y worker** (M) · depende de OS-102
  - Tabla `jobs` en Postgres (con `SKIP LOCKED`), reintentos con espera y un worker que es el mismo contenedor arrancado en modo worker en Railway. La sincronización y la ingesta pasan a ser trabajos.
  - *Hecho cuando:* importar 70 actividades no bloquea la API y un fallo se reintenta solo.

**M1 está listo cuando** las actividades del reloj aparecen solas en la API de Railway, con métricas básicas, en menos de 15 minutos.

## Fase 2 · PWA MVP → **M2**

**Objetivo:** usar OpenSport a diario en escritorio y móvil.

- **OS-201 · Esqueleto de la app** (M) · depende de OS-003 y OS-006
  - Router, TanStack Query, cliente de la API generado desde OpenAPI y estructura de tokens de diseño (los temas completos van en OS-214).
- **OS-202 · Layout adaptable** (M) · depende de OS-201
  - Escritorio con barra lateral y dos columnas. Móvil con barra superior y pestañas abajo. Barras de desplazamiento con estilo y áreas seguras del móvil.
- **OS-214 · Sistema de temas** (M) · depende de OS-201
  - Tokens de diseño en un único fichero fuente (JSON) (en `packages/core`) del que se generan las variables CSS y el tema de la app React Native. Temas Sistema, Claro, Oscuro, Negro OLED, Alto contraste, Bosque, Océano y Atardecer. Selector con vista previa en Ajustes.
  - Sin parpadeo al cargar (script en línea que aplica el tema guardado antes de pintar), preferencia sincronizada con el backend y respeto de `prefers-color-scheme` y `prefers-contrast`.
  - Mapa (estilo claro u oscuro) y gráficas adaptados a cada tema.
  - *Hecho cuando:* cambiar de tema no deja ningún color fijo a la vista y todos los temas pasan el contraste WCAG AA en CI.
- **OS-203 · Pantalla de acceso** (M) · depende de OS-110 y OS-201
  - Diseño del prototipo: en escritorio, panel de marca a la izquierda y formulario a la derecha; en móvil, en una columna.
  - Paso 1: correo y contraseña (mostrar u ocultar, «recordar este dispositivo 30 días»). Paso 2: código TOTP de 6 dígitos con avance automático, pegado del código entero y enlace a un código de recuperación. Botones «Continuar con Google» (OS-220) y «Entrar con passkey» (se activa con OS-405).
  - Errores claros sin revelar si falla el correo o la contraseña, límite de intentos con espera creciente y `autocomplete` correcto (`username`, `current-password`, `one-time-code`) para gestores de contraseñas.
  - **La pantalla de acceso no muestra ningún dato del usuario** (ni cifras ni recorridos): es lo único visible sin sesión.
  - Todas las rutas redirigen al acceso si no hay sesión. «Cerrar sesión» está en Ajustes y en el perfil. Al ser una instancia personal, la contraseña se restablece con un comando en el servidor (`opensport reset-password`), sin correos.
  - *Hecho cuando:* no se puede ver ningún dato sin sesión (comprobado con tests end-to-end) y el flujo de contraseña + TOTP funciona con un gestor de contraseñas.
- **OS-204 · Feed** (M) · depende de OS-111 y OS-202
  - Resumen de la semana, filtros por deporte, tarjetas con miniatura del recorrido y scroll infinito.
- **OS-217 · Cabecera «Tu semana» y destacados** (M) · depende de OS-204
  - Encima del feed: los 7 días de la semana (actividad con el icono del deporte, hoy marcado, días futuros), racha de semanas seguidas y cifras de la semana (actividades, km, tiempo, esfuerzo).
  - Carrusel de destacados: estado de forma con la barra de las últimas 4 semanas, carga semanal frente a tu media, objetivo semanal con proyección, VO₂máx y FTP estimados, récords recientes. Las tarjetas que dependen del motor (fase 3) aparecen cuando sus datos existen.
- **OS-219 · Filtros por periodo y búsqueda en el feed** (M) · depende de OS-204
  - Año (con el número de actividades de cada uno), mes y «últimos 12 meses», más deporte y búsqueda por nombre o descripción. Resumen del periodo filtrado y lista agrupada por mes con sus totales.
  - En la API: `GET /api/activities?from=&to=&sport=&q=` paginado, con índices por fecha y búsqueda de texto en Postgres. Los filtros se reflejan en la URL para poder compartirlos y volver atrás.
  - *Hecho cuando:* filtrar entre 1800+ actividades responde al instante y la URL conserva el filtro.
- **OS-218 · Pantalla de perfil** (M) · depende de OS-203 y OS-111
  - Cabecera con avatar, nombre, ubicación, racha y dispositivo. Cifras del año. Pestañas: Resumen (año por deporte, récords, datos físicos), Objetivos, Estimaciones (con su explicación y actividad de origen), Equipo, Cuenta y fuentes (Garmin, Google Health, importar, exportar, sesiones).
  - Editar perfil (nombre, ubicación, nacimiento, sexo, peso, altura). En móvil es la pestaña «Tú» y da acceso a Ajustes.
- **OS-205 · Detalle de actividad: cabecera y cifras** (S) · depende de OS-204
- **OS-206 · Mapa del recorrido** (M) · depende de OS-205
  - MapLibre con estilo propio. Color por ritmo, FC, potencia o altitud. Salida y llegada. Alternativa sin WebGL.
- **OS-215 · Base de gráficos** (M) · depende de OS-214
  - ECharts con un tema generado desde los tokens de cada tema de OpenSport. Componentes SVG propios para los gráficos estáticos (miniatura del recorrido, minigráficas, barra de zonas). Animaciones que respetan `prefers-reduced-motion`, carga perezosa fuera de pantalla y resumen accesible.
  - *Hecho cuando:* hay un catálogo de componentes con un ejemplo de cada tipo (estático, pasivo y activo) en todos los temas.
- **OS-207 · Perfil y gráficas sincronizadas con el mapa** (M) · depende de OS-206 y OS-215
- **OS-208 · Vueltas, mejores tiempos y zonas en el detalle** (S) · depende de OS-205
- **OS-209 · Botón Sync con progreso** (S) · depende de OS-112 y OS-202
  - Hoja de progreso consultando cada 2 s. El feed se refresca al terminar.
- **OS-210 · PWA instalable** (S) · depende de OS-201
  - Manifiesto, iconos y pantalla de arranque con `vite-plugin-pwa`.
- **OS-211 · Funcionamiento sin conexión** (M) · depende de OS-210 y OS-204
  - Service worker para la app, IndexedDB para las actividades vistas y sus series, caché de teselas y aviso de «sin conexión».
- **OS-220 · Acceso con cuenta de Google** (M) · depende de OS-110 y OS-203
  - «Continuar con Google» con OpenID Connect (flujo de código con PKCE y `state`/`nonce`), con solo los permisos `openid email profile`. El backend valida el token de identidad (emisor, audiencia, caducidad, `email_verified`) y lo compara con el `sub` de Google vinculado: **solo tu cuenta puede entrar**, aunque otra persona tenga Google.
  - Se vincula y desvincula desde Perfil → Cuenta y fuentes → Métodos de acceso. Desvincular exige tener otro método activo (contraseña con 2FA o passkey).
  - Entrar con Google no pide el código TOTP: cuenta como verificación fuerte porque Google ya aplica su propia verificación en dos pasos.
  - Mismo proyecto de Google Cloud que la Google Health API (OS-603), pero con un cliente OAuth propio y sin permisos de salud.
  - *Ojo:* Google exige URLs de retorno fijas. Funciona en producción y en local, pero no en las previsualizaciones de Vercel (URLs cambiantes), donde se entra con contraseña.
  - *Hecho cuando:* entrar con tu cuenta de Google funciona y cualquier otra cuenta recibe un rechazo genérico.
- **OS-212 · Ajustes básicos** (S) · depende de OS-203
  - FC máx/reposo, unidades, estado de la clave de Garmin y su caducidad, dispositivos con sesión abierta.
- **OS-216 · Seleccionar un tramo en el perfil** (S) · depende de OS-207
  - Arrastrar sobre el perfil para elegir un tramo: muestra su distancia, tiempo, ritmo, FC y desnivel, y lo resalta en el mapa.
- **OS-213 · Calidad** (M) · depende de OS-204…OS-209
  - Tests end-to-end (Playwright) de los flujos principales, Lighthouse en móvil (≥ 90 en rendimiento y PWA) y accesibilidad básica.

**M2 está listo cuando** abres la PWA instalada en el móvil, ves la actividad de hoy con su mapa y todo funciona sin cobertura para lo ya visto.

## Fase 3 · Métricas avanzadas → **M3**

**Objetivo:** las métricas «Premium», calculadas con tu configuración. El **motor de cálculo histórico** «cocina» todo el historial en segundo plano: estimaciones, curvas, progresos y eventos (ver [arquitectura.md](arquitectura.md#motor-de-cálculo-histórico-cocinar-los-datos)).

- **OS-313 · Motor de cálculo incremental** (L) · depende de OS-115 y OS-107
  - Al importar una actividad se encadenan sus métricas, los días afectados, las curvas, las estimaciones y los progresos, recalculando solo lo que depende de ella. Las tablas calculadas llevan `metrics_version`.
  - *Hecho cuando:* una actividad nueva actualiza forma, récords y estimaciones en menos de 30 s, y ninguna pantalla calcula nada al abrirse.
- **OS-314 · Recálculo completo y versionado** (M) · depende de OS-313
  - Al cambiar ajustes (FC, zonas, FTP) o la versión de un algoritmo, se reprocesa todo desde los FIT originales en segundo plano, con progreso visible en la app. Idempotente.

- **OS-301 · Modelo de zonas configurable** (M) · depende de OS-212
  - FC (% máx, reserva o umbral), ritmo y potencia (FTP). Al cambiarlo se recalcula todo el histórico en segundo plano.
- **OS-302 · Esfuerzo relativo (TRIMP)** (S) · depende de OS-301
- **OS-303 · Forma, fatiga y frescura (CTL/ATL/TSB)** (M) · depende de OS-302 y OS-313
  - Tabla `daily_load` con recálculo incremental y API `GET /api/stats/fitness`.
- **OS-304 · Récords personales y su evolución** (M) · depende de OS-107
  - Récord histórico y por temporada, y aviso «🏆 récord» al importar.
- **OS-305 · Ritmo ajustado a pendiente (GAP)** (M) · depende de OS-105
  - Modelo de Minetti con la altitud barométrica suavizada.
- **OS-306 · Curva de potencia** (S) · depende de OS-105
  - Por actividad e histórica (bici y ROUVY).
- **OS-307 · Predicción de carrera** (S) · depende de OS-304
- **OS-308 · Volumen y tendencias** (S) · depende de OS-111
  - Por día, semana, mes y año, y por deporte, precalculado en el motor para responder al instante con años de histórico.
- **OS-309 · Rutas repetidas** (L) · depende de OS-106
  - Agrupar actividades por similitud del recorrido y comparar tiempos.
- **OS-310 · Mapa de calor personal** (M) · depende de OS-106
- **OS-311 · Pantalla de estadísticas** (M) · depende de OS-303…OS-308 y OS-320
  - Forma, volumen, récords, predicción y curva de potencia, como en el prototipo.
- **OS-312 · Métricas nuevas en el detalle de actividad** (S) · depende de OS-302, OS-305 y OS-306
- **OS-315 · Curvas de mejor esfuerzo por periodo** (M) · depende de OS-313
  - Ritmo, potencia y FC para duraciones de 5 s a 2 h, en 42 días, 90 días, temporada e histórico.
- **OS-316 · Estimaciones de rendimiento** (L) · depende de OS-315
  - FTP estimado, ritmo umbral y crítico, FC umbral (LTHR), FC máxima observada, VO₂máx (VDOT) y predicciones de 5K a maratón. Cada una con método, confianza y actividades de origen, para explicar en la app de dónde sale («a partir de tu mejor 20 min del 12 de octubre»).
  - *Hecho cuando:* las estimaciones se validan con tus datos reales (por ejemplo, FTP frente a la curva de potencia de ROUVY) y se recalculan solas.
- **OS-317 · Progresos y comparativas** (M) · depende de OS-313
  - Comparación con el mismo periodo del año anterior, tendencia de cada estimación, eficiencia aeróbica (ritmo a igual FC), desacoplamiento y rutas repetidas cada vez más rápidas.
- **OS-318 · Objetivos y rachas** (M) · depende de OS-313 y OS-218
  - Objetivos de km u horas por semana, mes o año, con proyección de fin de periodo y rachas de semanas activas.
- **OS-319 · Eventos del motor** (S) · depende de OS-313
  - «Nuevo récord», «tu FTP estimado sube», «rampa de carga alta». Los consumen las notificaciones (OS-401) y la IA (fase 7).
- **OS-321 · Estadísticas por periodo** (M) · depende de OS-308 y OS-219
  - Selector de periodo (todo, últimos 12 meses, año, mes) que se aplica a toda la pantalla: resumen con comparación frente al mismo periodo del año anterior, forma y frescura del periodo, volumen por año, mes o día (en horas o km), mejores tiempos del periodo frente a los récords de siempre, y curva de potencia del periodo sobre la histórica.
  - Endpoints `GET /api/stats/*?from=&to=` servidos desde las tablas precalculadas del motor (OS-313).
- **OS-322 · Progreso anual comparado** (S) · depende de OS-321
  - Distancia acumulada por día del año, una línea por año (el seleccionado resaltado), por deporte. Al pasar el cursor compara todos los años en la misma fecha.
- **OS-320 · Gráficos dinámicos de estadísticas** (L) · depende de OS-215, OS-315 y OS-316
  - Según el catálogo de [arquitectura.md](arquitectura.md#gráficos): forma y frescura (animada al cargar y tras el Sync, cursor por día, clic → actividades), volumen con transiciones de periodo, curvas de mejor esfuerzo comparando periodos, evolución de récords y estimaciones, objetivos animados.

**M3 está listo cuando** la pantalla de estadísticas muestra la forma y la frescura de hoy, tus estimaciones (FTP, ritmo umbral, predicciones) con su explicación y tus progresos, todo calculado de antemano y actualizado solo tras cada actividad.

## Fase 4 · Avisos, histórico y privacidad → **M4**

**Objetivo:** no echar de menos nada de Strava.

- **OS-401 · Notificaciones web** (M) · depende de OS-210 y OS-108
  - Claves VAPID, suscripción por dispositivo y avisos de actividad nueva, récord y error de sincronización.
- **OS-402 · Preferencias de notificaciones** (S) · depende de OS-401
- **OS-403 · Aviso de caducidad de la clave de Garmin** (S) · depende de OS-401
  - Notificación 14 días antes y aviso en ajustes.
- **OS-404 · Importador de FIT y ZIP** (M) · depende de OS-106
  - Subida de FIT sueltos y ZIP de Garmin. Deduplicado por hora de inicio y dispositivo.
- **OS-405 · Passkeys (WebAuthn)** (M) · depende de OS-110
  - Registro y acceso con passkey en la PWA (validadas con huella o reconocimiento facial del dispositivo), sincronizadas por el gestor de contraseñas (Google o iCloud). Se gestionan en Perfil → Métodos de acceso.
  - El identificador del servicio (RP ID) es el dominio de producción de OpenSport, que debe ser estable: así **la misma passkey sirve luego en la app Android** (OS-503), enlazada con `/.well-known/assetlinks.json`.
- **OS-406 · Importar el ZIP de Strava** (M) · depende de OS-404
  - Probado con tu exportación real: 1816 actividades (2011–2026), 1635 FIT, 127 TCX y 53 GPX comprimidos o no. Lee `activities.csv` (104 columnas, hora en UTC) y descomprime los ficheros al vuelo.
  - Deduplica frente a Garmin por hora de inicio (±2 min): gana el FIT de Garmin y se conservan de Strava el nombre, la descripción, el equipo, las fotos y la meteorología. Importa también lo que solo está en Strava (por ejemplo, sesiones de fuerza grabadas con otra app).
  - Distancia y desnivel suavizados en los GPX y TCX. Guarda el Esfuerzo Relativo y la distancia ajustada de Strava como referencia para validar nuestras métricas.
- **OS-407 · Zonas de privacidad en el servidor** (M) · depende de OS-111
  - Recortar al servir y exportar cualquier cosa compartible, y configurarlas en ajustes.
- **OS-408 · Compartir una actividad** (M) · depende de OS-407
  - Enlace firmado y con caducidad, o imagen. Privacidad aplicada.
- **OS-409 · Editar actividad** (S) · depende de OS-111
  - Nombre, descripción, tipo y equipo. El FIT original nunca se toca.
- **OS-410 · Equipo y kilometraje** (S) · depende de OS-409 y OS-406
  - Zapatillas y bicis, con aviso de kilometraje. Se precarga desde `bikes.csv`, `shoes.csv` y el equipo de cada actividad de la exportación de Strava.
- **OS-411 · Exportar todos tus datos** (S) · depende de OS-104
  - ZIP con los FIT originales y JSON.

**M4 está listo cuando** tienes todo tu histórico en OpenSport, te llegan avisos y puedes compartir una actividad sin desvelar dónde vives.

## Fase 5 · App Android (React Native + Expo) → **M5**

**Objetivo:** mejor experiencia en el móvil (segundo plano, notificaciones fiables, Health Connect, widget) reutilizando `packages/core`.

- **OS-501 · Prueba de concepto de rendimiento** (M) · depende de OS-008 y OS-111
  - En 2–3 días, solo el detalle de actividad en Expo: mapa MapLibre, perfil dibujado con Skia, cursor sincronizado con Reanimated y selección de tramo, con datos reales.
  - *Hecho cuando:* en un móvil de gama media el arranque en frío baja de 1,5 s, el arrastre va a 60 fps y la memoria es razonable. Si no se cumple: decidir si se pasa a Kotlin antes de seguir.
- **OS-502 · Proyecto Expo en el monorepo** (M) · depende de OS-501
  - `apps/mobile` con Expo Router, arquitectura nueva y Hermes. EAS Build y EAS Update. CI con lint, tests y build. Tema generado desde los tokens de `packages/core` (OS-214), más color dinámico de Android.
- **OS-503 · Autenticación en la app** (L) · depende de OS-502, OS-110, OS-220 y OS-405
  - **Primer acceso**, con tres opciones:
    - **Google nativo** con `@react-native-google-signin/google-signin` (Credential Manager de Android: hoja de cuentas con un toque). La app envía el token de identidad a `POST /api/auth/google/mobile` y el backend aplica la misma regla de solo la cuenta vinculada.
    - **Contraseña + TOTP.**
    - **Passkey** con `react-native-passkey`: la misma de la PWA, gracias al `assetlinks.json` publicado en el dominio.
  - **Día a día con huella:** el token de refresco se guarda en `expo-secure-store` con `requireAuthentication`, ligado al almacén seguro de Android y liberado solo tras validar la biometría (`expo-local-authentication`). Abrir la app es poner la huella.
  - **Biometría fuerte por defecto** (clase 3). En muchos Samsung el reconocimiento facial es de clase débil y no libera claves, así que allí se usará la huella. Opción en ajustes para aceptar biometría débil solo como bloqueo de la app.
  - Si cambian las huellas registradas, hay varios fallos o el token caduca, se vuelve a pedir Google, contraseña o passkey.
  - Configuración: cliente OAuth de Android en Google Cloud con el nombre del paquete y las huellas SHA-1 de los certificados de EAS y de Play Store.
  - *Hecho cuando:* en tu S26 entras la primera vez con Google y después abres la app solo con la huella, y una cuenta de Google no vinculada recibe un rechazo.
- **OS-504 · Feed, cabecera «Tu semana» y detalle** (L) · depende de OS-503
  - Paridad con la PWA usando los hooks de `packages/core`. FlashList, MapLibre nativo y gráficos con Skia.
- **OS-505 · Funcionamiento sin conexión** (M) · depende de OS-504
  - Caché persistente de TanStack Query y `expo-sqlite` para las series.
- **OS-506 · Sincronización en segundo plano** (S) · depende de OS-505
  - `expo-background-task` (WorkManager por debajo).
- **OS-507 · Notificaciones con FCM** (M) · depende de OS-401 y OS-503
  - `expo-notifications`. En el backend, envío por FCM además de Web Push.
- **OS-508 · Estadísticas y perfil** (M) · depende de OS-311, OS-218 y OS-504
- **OS-509 · Widget de pantalla de inicio** (M) · depende de OS-505
  - Última actividad y forma de hoy, con `react-native-android-widget` o un módulo de Expo en Kotlin.
- **OS-510 · Publicación en pruebas internas de Play Store** (S) · depende de OS-504…OS-507
  - Con EAS Submit.

**M5 está listo cuando** la app Android sustituye a la PWA en tu móvil, con avisos fiables y sincronización en segundo plano.

## Fase 6 · Salud multifuente → **M6**

**Objetivo:** sueño, VFC, FC en reposo y datos diarios de todas tus fuentes en un mismo modelo, sin duplicados.

- **OS-601 · Modelo de datos de salud** (M) · depende de OS-102
  - Tablas `sleep_sessions` (fases), `daily_health` (FC en reposo, VFC, SpO₂, respiración, pasos), `sources` y `source_priority`. Cada dato guarda su fuente y su `external_id`.
- **OS-602 · Garmin: sueño, VFC y datos diarios desde la Personal API** (M) · depende de OS-601 y OS-103
- **OS-603 · Conector de Google Health API (Fitbit Air)** (L) · depende de OS-601
  - OAuth 2.0 de Google con permisos de solo lectura y mínimos (sueño, FC, VFC, SpO₂, actividad). Tokens cifrados en la base de datos. Sincronización incremental.
  - *Ojo:* una app OAuth de Google en modo «Testing» da tokens de refresco que caducan a los 7 días. Hay que comprobar si para uso personal basta con eso (volver a autorizar cada semana) o hay que pasar la verificación de Google para permisos de salud.
- **OS-604 · Webhooks de Google Health** (M) · depende de OS-603
  - Endpoint en Railway que recibe los avisos de datos nuevos, con verificación de firma. El cron queda como respaldo.
- **OS-605 · Reglas de prioridad y deduplicado entre fuentes** (M) · depende de OS-602 y OS-603
  - Ejemplos: sueño → Fitbit Air si lo llevaste puesto esa noche; actividades → Garmin; FC en reposo → la fuente con más horas de datos. Configurable en ajustes.
- **OS-606 · Panel de salud** (M) · depende de OS-605
  - Tendencias de sueño (fases y puntuación), VFC, FC en reposo y «preparación» combinada con la frescura (TSB) de la fase 3.
- **OS-607 · Lectura de Health Connect desde la app Android** (M) · depende de OS-502
  - Con `react-native-health-connect`.
  - Alternativa local a la API de Google para la app nativa.
- **OS-608 · Importar desde el reloj por USB** con una herramienta de escritorio o un script local (S)
- **OS-609 · Evaluar descargas de mapas sin conexión** para rutas (M)
- **OS-610 · Evaluar grabar actividades con el GPS del móvil** en Android (L)

**M6 está listo cuando** el panel de salud muestra tu sueño y tu VFC de anoche, aunque vengan de dispositivos distintos, sin duplicados.

## Fase 7 · Asistente con IA → **M7**

**Objetivo:** que OpenSport explique tus datos en lenguaje natural, con un LLM pequeño y barato vía API, sin mandar más datos de los necesarios.

Puede empezar en cuanto esté M3 (necesita las métricas), en paralelo con las fases 4 a 6.

- **OS-701 · Cliente de LLM en el backend** (S) · depende de OS-101
  - SDK oficial `anthropic` con `claude-haiku-5-5`. Clave en las variables de Railway. Reintentos y errores tipados. Registro de tokens y coste por llamada en la tabla `llm_calls`.
- **OS-702 · Minimización de datos** (M) · depende de OS-701
  - Una capa que construye el contexto para el LLM **sin coordenadas ni datos de perfil**: solo cifras agregadas (distancia, tiempos, zonas, TRIMP, forma, récords, sueño). Con tests que garanticen que nunca sale una latitud ni una longitud.
- **OS-703 · Resumen automático de cada actividad** (M) · depende de OS-702 y OS-304
  - 2–3 frases al importar: qué fue, cómo fue respecto a lo habitual y algún récord. Con salida estructurada (`output_config.format`): `{titulo_sugerido, resumen, destacados[]}`. Se puede desactivar.
- **OS-704 · Informe semanal** (M) · depende de OS-703 y OS-303
  - Cada lunes: volumen, carga, forma y frescura, sueño y una recomendación. Generado en lote (Batch API, a mitad de precio) y enviado como notificación.
- **OS-705 · «Coach»: preguntas en lenguaje natural** (L) · depende de OS-702
  - Chat en la PWA. El modelo no recibe todo el historial: usa **herramientas** que llaman a nuestra propia API (`buscar_actividades`, `estadisticas_forma`, `records`, `salud_diaria`), y responde con cifras y enlaces a las actividades. Respuesta en streaming.
- **OS-706 · Caché de prompts y control de coste** (S) · depende de OS-705
  - Prompt de sistema y definición de herramientas estables y cacheados. Límite mensual de gasto con aviso. Medir `cache_read_input_tokens`.
- **OS-707 · Evaluación de calidad** (M) · depende de OS-703 y OS-705
  - Un conjunto de 30–50 actividades y preguntas reales con las respuestas esperadas. Se comprueba que las cifras citadas coinciden con la base de datos (sin inventar). Se ejecuta antes de cambiar el prompt o el modelo.
- **OS-708 · Privacidad y transparencia** (S) · depende de OS-702
  - Interruptor general «usar IA» en ajustes, explicación de qué datos se envían, y no guardar en el proveedor nada que no haga falta.

**M7 está listo cuando** cada actividad nueva llega con su resumen, el lunes recibes el informe semanal y el Coach responde con cifras correctas a preguntas como «¿cómo voy para un 10K?».

---

## Orden recomendado para empezar

1. **OS-007** (rotar la clave), **OS-001 → OS-006** (fundaciones).
2. **OS-101 → OS-109**: es el camino crítico de M1 y se puede probar sin interfaz.
3. **OS-110 → OS-112**, en paralelo con **OS-201 → OS-202** (web).
4. El resto de la fase 2 por orden de número.

## Dependencias externas y riesgos por fase

| Fase | Riesgo | Mitigación |
|---|---|---|
| 1 | Límites no publicados de la Personal API | Sincronización incremental, pausas y reintentos ante 429. Medir en producción |
| 1 | La clave caduca (máx. 1 año) | OS-403 y fecha visible en ajustes (OS-212) |
| 2 | Límites del proxy de Vercel | Consultar el progreso cada 2 s y paginar. Plan B: subdominio `api.` |
| 2 | WebGL no disponible | Alternativa con Leaflet ya probada en el prototipo |
| 4 | Web Push en iOS solo con la PWA instalada | Documentarlo. La app de la fase 5 es Android, pero con Expo se podría publicar en iOS más adelante |
| 5 | Rendimiento de React Native en el detalle de actividad | Prueba de concepto OS-501 con criterios medibles antes de construir el resto |
| 5 | Política de Play Store y datos de salud | Pruebas internas y declaración de datos sensibles |
| 6 | Tokens de Google OAuth de 7 días en modo «Testing» y verificación de permisos de salud | Probarlo primero en OS-603. Si es inviable: Health Connect desde Android (OS-607) |
| 6 | Datos duplicados o contradictorios entre Garmin y Fitbit Air | Reglas de prioridad configurables (OS-605) y la fuente siempre visible |
| 7 | El LLM se inventa cifras | Herramientas que devuelven datos reales, evaluación con comprobación de cifras (OS-707) |
| 7 | Datos de salud enviados a un tercero | Minimización (OS-702), sin coordenadas, interruptor general (OS-708) |
