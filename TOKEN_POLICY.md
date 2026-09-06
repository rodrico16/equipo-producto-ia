# Politica de ahorro de tokens para Codex

Objetivo: reducir texto innecesario en contexto sin perder evidencia, seguridad ni capacidad de verificacion.

## Reglas operativas

- Usa el modelo mas simple suficiente: antes de delegar o continuar, clasifica la tarea por riesgo y contexto. Tareas mecanicas, de lectura acotada, validacion puntual, redaccion breve o cambios de bajo impacto deben poder ejecutarse con el modelo mas simple disponible. Reserva modelos mas capaces para decisiones ambiguas, arquitectura transversal, seguridad critica, depuracion profunda o integracion de multiples fuentes.
- Atomiza encargos: convierte trabajos grandes en mini tareas autocontenidas con un solo objetivo verificable, entradas minimas, archivos asignados, limite de salida, criterio de finalizacion y maximo una dependencia pendiente. Si no cabe en ese formato, primero pide o produce una particion.
- Reduce contexto por contrato: cada mini tarea debe recibir referencias a archivos y lineas, no documentos completos, salvo que el archivo sea pequeno o el contenido completo sea indispensable para decidir.
- Busca antes de leer: usa `rg`, `rg --files`, filtros por extension y lecturas por fragmentos antes de abrir archivos completos.
- Acota salidas de terminal: limita logs, pruebas y listados con opciones nativas, filtros o presupuestos de salida. Si el resultado es masivo, conserva comando, resumen, conteos, errores y ultimas lineas relevantes.
- Evita repetir contexto: no vuelvas a pegar briefs, PRD, diffs, logs o contratos completos si ya existen en archivos del repo. Referencia ruta y linea cuando alcance.
- Entrega compacto: cada agente debe devolver resultado, archivos, evidencia, supuestos, riesgos y pendientes en forma breve. Detalles extensos van a archivos versionados.
- Usa artefactos canonicos: mantén una unica version del brief, backlog, contratos, decisiones y reportes. Los agentes no deben crear copias paralelas salvo que el supervisor lo asigne.
- Separa evidencia de narracion: reporta solo comandos ejecutados, resultados observados y decisiones tomadas. No incluyas explicaciones pedagogicas si el usuario no las pidio.
- Recorta web y herramientas externas: extrae titulos, fechas, citas cortas y conclusiones necesarias; evita HTML crudo, transcripciones largas o dumps de API.
- Falla de forma informativa: si algo no se pudo verificar, dilo en una linea con causa y siguiente paso. No rellenes con especulacion.

## Presupuestos recomendados

- Actualizacion de progreso: 1 o 2 frases.
- Entrega de especialista: hasta 12 lineas salvo que el supervisor pida mas.
- Logs de comandos: errores completos si son pequenos; si son grandes, primeras causas, conteo y ultimas 40 lineas relevantes.
- Revision final: cambios, pruebas y pendientes. Evita repetir implementacion archivo por archivo si el diff ya es claro.

## Reglas para subagentes

El supervisor debe incluir esta politica en cada encargo cuando el trabajo pueda producir mucha salida. Cada subagente debe:

- aceptar tareas pequenas y pedir particion cuando el encargo requiera mucho contexto no acotado;
- declarar archivos de su propiedad antes de editar;
- preferir modificar artefactos existentes en lugar de crear documentos duplicados;
- no pegar codigo, contratos o tablas completas si basta con la ruta;
- devolver evidencia verificable, no texto decorativo;
- pedir mas contexto solo cuando bloquee una decision real.

## Herramientas externas

Repos como RTK, Caveman, context-mode o habilidades de medicion pueden ser utiles como inspiracion o integracion futura, pero este repo no depende de ellos por defecto. Antes de instalarlos, valida licencia, mantenimiento, compatibilidad con Codex y permisos de red/locales. La optimizacion base de este proyecto vive en instrucciones, scripts y disciplina de salida.
