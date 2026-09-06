# Metricas de tokens por sesion

Objetivo: medir si las mejoras de `TOKEN_POLICY.md` reducen el consumo real de Codex.

## Capacidades del supervisor

### 1. Costo de tokens de una sesion

El supervisor debe registrar cada sesion relevante en `token-sessions.csv` con:

- `fecha`: fecha local `YYYY-MM-DD`.
- `sesion`: identificador corto elegido por el usuario o supervisor.
- `producto`: producto, tarea o flujo trabajado.
- `modelo`: modelo de Codex usado en la interaccion o sesion, tal como lo reporte la app o la configuracion visible. Si hubo varios modelos, registrar una fila por interaccion/modelo o usar `mixto` y detallar en `notas`.
- `tokens_entrada`: tokens de entrada reportados por Codex o herramienta de medicion.
- `tokens_salida`: tokens de salida reportados por Codex o herramienta de medicion.
- `tokens_total`: suma de entrada y salida.
- `costo_usd`: costo reportado o calculado externamente, si existe.
- `politica_version`: version o descripcion breve de reglas aplicadas.
- `notas`: cambios, anomalías o contexto necesario.

Si Codex no expone tokens exactos para la sesion, el supervisor debe marcar el dato como no medido y no inventarlo.

### 2. Promedio de tokens por sesion

El supervisor debe usar `medir-tokens.ps1` para calcular:

- sesiones registradas;
- promedio de tokens totales por sesion;
- promedio de entrada y salida;
- costo promedio si hay costos;
- promedios por `modelo` para saber si las mini tareas permiten usar modelos mas simples;
- comparacion entre una linea base y sesiones posteriores cuando existan etiquetas en `politica_version`.

## Flujo recomendado

1. Antes de optimizar, registra 3 a 5 sesiones como linea base.
2. Aplica cambios de `TOKEN_POLICY.md`.
3. Registra cada sesion comparable con la misma granularidad y el modelo usado.
4. Compara promedios por tipo de trabajo y por modelo, no mezcles tareas pequeñas con entregas grandes sin anotarlo.
5. Reporta mejora solo como dato medido: porcentaje = `(baseline_promedio - nuevo_promedio) / baseline_promedio * 100`.

## Checkpoint de aprobación

Cada vez que el supervisor pida aprobación al usuario, debe incluir este bloque compacto:

```text
Checkpoint
- Tiempo: [duracion real del proceso]
- Tokens usados: [valor real o no medido]
- Uso disponible Codex: [porcentaje real o no disponible]
```

El porcentaje disponible se calcula como `100 - usedPercent` cuando Codex expone el dato. Si hay ventana principal y semanal, reporta ambas de forma breve.

## Limitaciones

Este repo no puede extraer por si solo tokens historicos de sesiones de Codex si la aplicacion no los expone en archivos, UI o herramienta disponible. La fuente de verdad debe ser el contador/reportes de Codex, una herramienta instalada o un registro manual verificable.
