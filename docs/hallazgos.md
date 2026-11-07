# Hallazgos: cómo obtener los datos de las actividades

Investigación del 6–7 de noviembre de 2026 para OpenSport. Dispositivo de referencia: Garmin fēnix 6X Pro (firmware 28.02), con Garmin Connect y Strava gratuito.

**Conclusión:** la fuente principal será la **Garmin Connect Personal API**, que es oficial, gratuita y devuelve el FIT original sin recortes. Ya está probada con datos reales ([sync/garmin_sync.py](../sync/garmin_sync.py)). La arquitectura está en [arquitectura.md](arquitectura.md).

---

## 1. Resumen de las vías evaluadas

| Vía | Resultado | Motivo |
|---|---|---|
| **Garmin Personal API** | ✅ **Elegida** | Oficial, para particulares, sin aprobación. FIT idéntico al "Exportar archivo" de Garmin |
| Exportación desde la web de Garmin Connect (manual) | ✅ Como respaldo | Funciona, pero cada descarga necesita un clic (y Chrome pide confirmar dónde guardar) |
| Exportación masiva de Strava (ZIP) | ✅ Solo para el histórico | Gratis y permitida, pero no es el original completo (ver §3) |
| API de Strava | ❌ | Desde junio de 2026 exige suscripción de pago, también para apps personales |
| Automatizar la web de Strava o Garmin (agent-browser) | ❌ | La copia del perfil de Chrome no conserva las sesiones (las cookies están cifradas con el llavero del sistema), salta la comprobación antibots de Cloudflare y las condiciones de uso prohíben el acceso automatizado |
| Claude in Chrome con la sesión real | ⚠️ Funciona, no automatizable | Útil para pruebas; depende del navegador abierto y de un clic en el diálogo de guardar |
| App Garmin Connect en el móvil (adb por wifi) | ❌ | Las actividades están en el almacenamiento privado de la app (necesita root). Fuera de él solo hay una caché de mapas. La app no exporta el FIT. Leer la pantalla con `uiautomator` solo da resúmenes |
| Health Connect (Android) | ❌ | Garmin escribe ahí sesiones, FC, distancia y velocidad, pero **no la ruta GPS**, y leerlo exige una app Android propia |
| intervals.icu como intermediario | ❌ | Desde octubre de 2026 es probable que pierda el acceso a los datos de Garmin por API, y Garmin le envía FIT recortados (sin Training Effect, VO₂máx…) |
| python-garminconnect (no oficial) | ❌ Descartada | Frágil: su librería de login (garth) está abandonada, dejó de funcionar en marzo de 2026 y depende de simular un navegador |
| Reloj por USB (`GARMIN/Activity/*.fit`) | ⏸ Aparcada | Válida y 100 % local, pero el equipo no reconoce el reloj (`Cannot enable. Maybe the USB cable is bad?`): falla el cable o el puerto |
| Gadgetbridge | ⏸ Aparcada | Todo en local, pero sustituye a Garmin Connect en el emparejamiento del reloj |

## 2. Garmin Connect Personal API (la vía elegida)

- **Qué es:** el nivel "Personal" del Garmin Connect Developer Program, abierto en octubre de 2026. Es para particulares que quieren acceder a sus propios datos, de solo lectura y no comercial.
- **Clave:** se crea en https://connect.garmin.com/app/settings/personalApiToken → *Create Key*. Caduca a los 30, 90 o 180 días o a 1 año, y solo se muestra una vez.
- **Autenticación:**
  1. `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token` con la cabecera `Authorization: ApiKey <clave>`.
  2. La respuesta es el token en texto plano (un JWT): no viene en JSON. Dura como máximo 24 h, según su campo `exp`. No hay token de renovación: se vuelve a pedir con la misma clave.
  3. Las peticiones de datos llevan `Authorization: Bearer <token>`.
- **Endpoints usados** (los mismos que la [librería oficial](https://github.com/garmin/connect-personal-api-python)):
  - `GET /activitylist-service/activities/search/activities?start=&limit=&startDate=&endDate=`: lista de actividades, paginada con `start` y `limit`, fechas en formato `AAAA-MM-DD`.
  - `GET /download-service/files/activity/{activityId}`: ZIP que contiene `{id}_ACTIVITY.fit`.
  - `GET /activity-service/activity/{activityId}`: detalle de una actividad (aún sin usar).
- **Metadatos del listado:** unos 80 campos por actividad, entre ellos `activityId`, `activityName`, `activityType.typeKey`, `startTimeLocal`, `startTimeGMT`, `distance`, `duration`, `movingDuration`, `elevationGain`, `averageHR`, `maxHR`, `aerobicTrainingEffect`, `activityTrainingLoad`, `hrTimeInZone_1..5`, `fastestSplit_1000/1609/5000`, `startLatitude` y `startLongitude`, y `locationName`.
- **Prueba real (7 nov 2026):** 5 actividades desde el 25 de octubre, listadas y descargadas sin errores (3 de fuerza, 1 carrera, 1 rodillo ROUVY).
- **Por confirmar:** límites de uso (no están publicados) y si Garmin llegará a recortar también los FIT de esta API, como hace con los que envía a terceros.

## 3. ¿Cuál es el "original" de verdad? Comparación de FIT

| Comparación | Resultado |
|---|---|
| Fuerza 4 nov: Personal API ↔ "Exportar archivo" de Garmin Connect | **Idénticos byte a byte** (mismo SHA-256, 41 445 bytes) |
| Carrera 27 oct: Personal API ↔ "Export original" de Strava | Mismo resumen, mismos 2257 puntos, FC y GPS, pero **120 KB frente a 93 KB**: **a Strava le faltan 11 tipos de mensaje propietarios de Garmin**, entre ellos 2268 registros del tipo 233 (probablemente intervalos entre latidos) |

➡️ **Garmin es mejor fuente que Strava** incluso para las actividades que ya están en Strava.

## 4. Qué hay en cada formato

| | FIT original de Garmin | FIT "original" de Strava | GPX de Strava |
|---|---|---|---|
| Puntos a 1 Hz (posición, altitud, FC, cadencia, temperatura) | ✅ | ✅ | ✅ |
| Distancia acumulada del reloj | ✅ | ✅ | ❌ |
| Vueltas, resumen de sesión, tiempo en zonas | ✅ | ✅ | ❌ |
| Training Effect y carga de entrenamiento | ✅ | ✅ | ❌ |
| Mensajes propietarios (posible VFC…) | ✅ | ❌ | ❌ |
| Perfil del usuario (peso, altura) | ✅ | ✅ | ❌ |

Con el GPX solo, la distancia sale un 1,7 % alta (6730 m frente a 6615 m, por el ruido del GPS) y el desnivel casi el doble (+106 m frente a +60 m). Hay que suavizar ambos.

## 5. Las cifras de Strava se pueden reproducir

Con el FIT se reproducen todas las métricas de la web gratuita de Strava:

- **Resumen** (6,61 km · 37:37 · 5:41/km · 60 m · 574 kcal): coincide con el resumen de sesión del FIT. El desnivel es el del reloj.
- **Parciales**: son las vueltas automáticas de 1 km del FIT.
- **Mejores tiempos**: calculados con la distancia acumulada, salen idénticos (400 m 2:03 · ½ milla 4:18 · 1 km 5:27 · 1 milla 8:47 · 5 km 28:06). Las 2 millas dan 17:56 frente a 17:57, una diferencia de redondeo.
- **Cadencia**: el FIT guarda pasos por pierna, así que hay que multiplicar por 2 (82 → 164 ppm).
- **Solo existen en la web de Strava:** los esfuerzos en segmentos, los Flybys y los kudos. El Esfuerzo Relativo, el equipo, las descripciones y las fotos sí salen en la exportación masiva (ver §10).

Más detalle en [analisis-export-strava.md](analisis-export-strava.md).

## 6. Otros detalles técnicos

- **Coordenadas en el FIT:** vienen en semicírculos; grados = valor × 180 / 2³¹.
- **Zonas de FC del reloj:** no son fiables. El FIT de la carrera las calcula sobre un umbral de lactato de 86 ppm, así que todo cae en Z5. El de fuerza usa el % de FC máxima (185) y sí sale coherente. **OpenSport calculará sus propias zonas.**
- **Lectura de FIT en Python:** `fitdecode` funciona bien. Los mensajes propietarios aparecen como `unknown_N`.
- **Garmin Connect web:** la descarga interna usa `gc-api/download-service/files/activity/{id}` con tokens de la sesión del navegador. No se puede reutilizar desde un backend.

## 7. Privacidad y seguridad

- **Las zonas de privacidad de Strava no protegen los ficheros exportados:** el FIT y el GPX llevan el recorrido completo, incluida la salida cerca de casa. OpenSport debe recortar los tramos al **generar** cualquier cosa que se comparta, no solo ocultarlos en pantalla.
- El FIT lleva datos personales: peso, altura, sexo y FC en reposo.
- La clave de la API va en `.env` (permisos `600`, fuera de git). El token temporal se guarda en `data/.garmin_token.json` (`600`). `data/` está en `.gitignore`.
- ⚠️ **La clave actual se pegó en una conversación**: conviene borrarla y generar otra cuando acaben las pruebas.

## 8. Otras fuentes de salud: Google Health API (Fitbit Air)

- En mayo de 2026 Google lanzó la **Google Health API** junto con la Fitbit Air: unos 31 tipos de datos (sueño con fases, FC, VFC, SpO₂, respiración, ejercicio), permisos de lectura granulares y webhooks.
- La **antigua Fitbit Web API dejó de dar soporte el 30 de septiembre de 2026 y se apagó el 2 de noviembre de 2026**, así que hay que integrarse con la API nueva. Sus esquemas son distintos de los de Fitbit y elimina las mediciones no válidas (devuelve menos puntos de SpO₂).
- **A comprobar:** en modo «Testing» las apps OAuth de Google emiten tokens de refresco que caducan a los 7 días, y los permisos de salud pueden requerir la verificación de Google. Alternativa: Health Connect desde la app Android.

## 9. LLM pequeño para tratar los datos

- **Elegido: Claude Haiku 5.5** (`claude-haiku-5-5`): 0,10 $ por millón de tokens de entrada y 0,50 $ por millón de salida (prompts de hasta 100K tokens). Admite salida estructurada, herramientas, caché de prompts y Batch API (−50 %).
- Coste estimado: unos 0,0005 $ por resumen de actividad, es decir, céntimos al mes para un usuario.
- Diseño: el modelo no recibe coordenadas ni datos de perfil. Para preguntas, consulta nuestra API mediante herramientas, en lugar de recibir el historial completo. Detalle en [arquitectura.md](arquitectura.md#capa-de-ia-llm-pequeño-vía-api).

## 10. Exportación masiva de Strava (comprobada con tu histórico)

Exportación del 7 nov 2026 (`strava/export_95859`, 370 MB, **fuera de git**):

| Contenido | Detalle |
|---|---|
| **Actividades** | **1816**, de jul 2011 a nov 2026: 827 carreras, 307 de bici, 236 de bici virtual, 183 de pesas, 145 caminatas, 104 de remo, 11 de natación y otras |
| **Ficheros** | 1635 `.fit.gz`, 127 `.tcx.gz` y 53 `.gpx`/`.gpx.gz` (uno sin fichero) |
| **Volumen** | Unos 6950 km de carrera, 14 600 km de bici en exterior y 7065 km de bici virtual |
| **`activities.csv`** | 104 columnas. Además de las cifras básicas: **Esfuerzo Relativo** (en 1721 actividades), **equipo usado** (1270), **descripciones** (102), **meteorología** (686), potencia ponderada (441), distancia ajustada a la pendiente (693) y esfuerzo percibido (31) |
| **Equipo** | Bicis: Canyon Aeroad CFR Disc eTap y Wahoo KICKR Bike Pro. Zapatillas: New Balance Fresh Foam (820 actividades) y Adidas Adizero Boston (137) |
| **Otros** | Objetivos (62), rutas (7, en GPX), fotos y vídeos (111), comentarios, reacciones, segmentos marcados como favoritos, perfil, **zonas de privacidad (con dirección y coordenadas)** |
| **No incluye** | Los esfuerzos en segmentos ni las clasificaciones |

**Corrige lo que dije al principio:** la exportación masiva **sí** trae descripciones, fotos y equipo. Las fuentes que consulté entonces estaban desactualizadas o eran incompletas.

**Cruce con Garmin en 2026:** 189 actividades en Strava y 206 en Garmin. **177 coinciden** por hora de inicio (±2 min). La hora de `activities.csv` está en UTC.
- **Solo en Strava (12):** sesiones de fuerza y Hyrox (por ejemplo «GRIT») grabadas con otra app. El importador debe traerlas.
- **Solo en Garmin (29):** sobre todo fragmentos cortos de ROUVY que no llegaron a Strava.

**Cómo lo usa OpenSport:**
1. **Histórico anterior a Garmin** (1627 actividades de 2011 a 2025), con su FIT, TCX o GPX (importador OS-406).
2. **Deduplicado** por hora de inicio. Cuando coinciden, gana el FIT de Garmin (más completo) y de Strava se conservan el nombre, la descripción, el equipo y las fotos.
3. **Equipo con su kilometraje real** desde el primer día (OS-410).
4. **Validación:** el Esfuerzo Relativo y la distancia ajustada a la pendiente de Strava sirven para contrastar nuestro TRIMP y nuestro GAP.
5. **Zonas de privacidad:** se pueden importar como punto de partida. ⚠️ Contienen tu dirección: no salen nunca del servidor.

## 11. Fuentes

- Garmin: [Developer Program](https://developer.garmin.com/gc-developer-program/overview/), [Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api/), [librería Python oficial](https://github.com/garmin/connect-personal-api-python)
- [DC Rainmaker: Garmin abre su API](https://www.dcrainmaker.com/2026/10/garmin-connect-api-revamps-connect-developer.html), [the5krunner: Personal API](https://the5krunner.com/2026/10/22/garmin-personal-api/)
- [heise: la API de Strava pasa a ser de pago](https://www.heise.de/en/news/Strava-API-access-only-with-paid-subscription-in-the-future-11315017.html)
- [intervals.icu: acceso a la API](https://forum.intervals.icu/t/api-access-to-intervals-icu/609), [garmin-intervals-bridge](https://github.com/futureweb/garmin-intervals-bridge)
- Google Health API: [sueño](https://developers.google.com/health/data-types/sleep), [especificaciones y migración](https://developers.google.com/health/migration/api-specifications), [guía de Terra](https://tryterra.co/blog/everything-you-need-to-know-about-google-health-new-api)
- [garth abandonada](https://github.com/matin/garth/discussions/222), [Gadgetbridge y Garmin](https://freeyourgadget.codeberg.page/gadgetbridge_org/basics/topics/garmin/)
