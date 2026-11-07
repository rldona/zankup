# Análisis de los exports de Strava (FIT vs GPX)

Actividad de referencia: **"Carrera de noche"**, 27/10/2026, Garmin Fēnix 6X, Strava gratuito (actividad 20754337343).
Ficheros: `Carrera_de_noche.fit` (Export original) y `Carrera_de_noche.gpx` (Export GPX), más capturas de la web.

## Contenido de cada fichero

| | FIT (Export original) | GPX (Export GPX) |
|---|---|---|
| Puntos | 2257, uno por segundo | Los mismos 2257 (posición, altitud, FC y hora idénticas) |
| Por cada punto | Posición, altitud barométrica, velocidad, **distancia acumulada**, FC, cadencia, temperatura, longitud de zancada | Posición, altitud, hora, FC, cadencia, temperatura |
| Vueltas | 7 vueltas automáticas de 1 km (FC, cadencia, desnivel, calorías, zancadas) | ❌ |
| Resumen de la sesión | 6615 m, +60/−74 m, 574 kcal, Training Effect 3.5, carga de entrenamiento 104 | ❌ |
| Zonas de FC y tiempo en cada zona | ✅ | ❌ |
| Dispositivo y sensores | Fēnix 6X, barómetro, GPS, sensor de pulso en la muñeca… | Solo `creator="StravaGPX"` |
| Perfil del usuario | Peso, altura, sexo, FC en reposo | ❌ |

## Correspondencia con la web de Strava

- **Resumen** (6,61 km · 37:37 · 5:41/km · 60 m · 574 kcal): coincide con el resumen de sesión del FIT. Strava usa el desnivel del reloj, no lo recalcula.
- **Pestaña Parciales**: son las vueltas del FIT, tal cual (por ejemplo, 340 s = 5:40).
- **Parciales por km del resumen**: Strava los calcula con la distancia acumulada.
- **Mejores tiempos**: recalculados con la distancia acumulada del FIT, salen idénticos:

  | Distancia | Strava | Recalculado |
  |---|---|---|
  | 400 m | 2:03 | 2:03 |
  | ½ milla | 4:18 | 4:18 |
  | 1 km | 5:27 | 5:27 |
  | 1 milla | 8:47 | 8:47 |
  | 2 millas | 17:57 | 17:56 (redondeo) |
  | 5 km | 28:06 | 28:06 |

- **Cadencia de 164 ppm**: el FIT guarda 82 por pierna, así que hay que multiplicar por 2.

## Limitaciones del GPX

- **Distancia**: sumando la distancia entre puntos con haversine salen 6730 m en vez de 6615 m (+1,7 %, por el ruido del GPS). Hace falta suavizar el track.
- **Desnivel**: sumando la altitud en bruto salen +106 m en vez de +60 m. Hace falta un filtro o un umbral de histéresis.
- No trae vueltas, resumen ni zonas.

## Lo que solo existe en Strava (no está en ningún export)

- Segmentos (base de datos de Strava; en esta actividad aparecen 13).
- Esfuerzo Relativo (de pago), Flybys, kudos, zapatillas y su kilometraje, descripción de la actividad.

> **Corrección (7 nov 2026):** la exportación masiva sí incluye descripciones, fotos, el equipo usado en cada actividad e incluso el valor del Esfuerzo Relativo. Lo que no exporta son los esfuerzos en segmentos. Detalle en [hallazgos.md](hallazgos.md#10-exportación-masiva-de-strava-comprobada-con-tu-histórico).

## Privacidad

- En la web, el inicio y el final aparecen como **"Oculto"** por la zona de privacidad, pero **los dos exports incluyen el recorrido completo**, también el punto de salida.
- El FIT incluye datos personales del perfil (peso, altura).
- Para OpenSport: tratar estos ficheros como datos sensibles, implementar zonas de privacidad propias para lo que se comparta y no subirlos a repositorios públicos.

## Conclusiones para OpenSport

1. **Usar el FIT como fuente principal**: con él se reproducen todas las métricas que muestra Strava gratis, y además trae vueltas, zonas y Training Effect.
2. **Usar el GPX como respaldo** para otras fuentes, procesándolo para obtener distancia y desnivel creíbles.
3. **Calcular las zonas de FC con la configuración de OpenSport**: el reloj tiene un umbral de lactato de 86 ppm, que no es realista, y por eso el FIT pone todo el tiempo en la zona 5.
4. Para leer FIT en Python funciona bien `fitdecode` (las coordenadas vienen en semicírculos: grados = valor × 180 / 2³¹).
