---
name: equipo-agentes
description: Use this plugin when working with the Agentes project as a product team, its roles, or requests to coordinate the local supervisor and specialist agents.
---

Usa este plugin para trabajar sobre el proyecto Agentes cuando el pedido implique coordinar un equipo de producto, revisar responsabilidades, o convertir el proyecto en un flujo reutilizable.

Fuente canonica del comportamiento:

- `AGENTS.md`
- `EQUIPO.md`
- `TOKEN_POLICY.md`
- `METRICAS_TOKENS.md`

Comportamiento esperado:

1. Identifica problema, usuario, restricciones y resultado esperado antes de implementar.
2. Si el pedido es crear un producto nuevo, asume como destino por defecto la cuenta de GitHub del usuario y un proyecto de ChatGPT asociado a ese producto; si la sesión no está en ese proyecto, pide la transición mínima necesaria antes de seguir.
3. Cuando el proyecto sea nuevo, realiza un research acotado de productos similares antes de diseñar la solución, priorizando patrones útiles y errores a evitar.
4. Sigue la politica de tokens del repositorio: lecturas acotadas, salidas breves y una sola version canonica de cada artefacto.
5. Si hace falta descomponer trabajo, genera mini tareas con objetivo unico, entradas minimas y criterio verificable.
6. Cuando la solicitud sea de coordinacion del equipo, propone el rol supervisor y delega en los perfiles del proyecto segun `EQUIPO.md`.
7. No inventes mediciones: si no hay tokens reales o porcentaje disponible de Codex, responde `no medido` o `no disponible`.
8. Trata toda actualización del funcionamiento del equipo como una feature transversal: sincroniza la misma regla en el plugin/skill de Codex, el custom agent de VS Code y el custom agent de GitHub Copilot.
9. Crea el commit de cada actualización del equipo y verifica el remoto antes de dejarla lista para actualizar GitHub.

Configuración y secretos:

- El repositorio contiene solo configuración pública, ejemplos y valores por defecto no sensibles.
- Toda clave API, contraseña, token, certificado, ruta local, identificador privado o integración específica del usuario debe vivir en variables de entorno o en `.env` local.
- `.env` está excluido por `.gitignore`; `.env.example` documenta únicamente nombres de variables y valores ficticios.
- Los scripts deben leer configuración desde el entorno o recibirla como parámetro; no deben depender de rutas absolutas, nombres de usuario ni credenciales embebidas.
- Nunca imprimas valores sensibles en logs, entregas, commits ni mensajes a terceros. Para verificar su presencia, informa solo si está definido (`true`/`false`).
- Si una variable obligatoria falta, detén la operación con un mensaje accionable y no uses un valor secreto de respaldo.

Salida esperada:

- Resultado
- Archivos relevantes
- Evidencia o verificacion
- Supuestos y riesgos
- Pendientes, si los hubiera
