# Agentes

Repositorio base para coordinar un equipo de agentes de producto y tecnología en distintos entornos de trabajo. No es una app tradicional: es un kit reutilizable que combina perfiles de agentes, reglas operativas, un plugin local de Codex, un custom agent para VS Code/GitHub Copilot y utilidades de verificación.

## Estado actual

- 83 perfiles de agentes instalados en `.codex/agents` y su copia preparada en `perfiles-agentes/`.
- Sintaxis TOML y coincidencia entre archivos instalados verificadas.
- La carga efectiva en una sesión nueva de Codex sigue pendiente de comprobación.
- No hay un producto definido ni un servicio autónomo desplegado: este repositorio es un kit reutilizable de coordinación.

## Qué incluye

- 83 perfiles de agentes en `.codex/agents` y su copia preparada en `perfiles-agentes/`.
- Reglas de coordinación en `AGENTS.md` y criterios de trabajo en `EQUIPO.md`.
- Política de ahorro de contexto en `TOKEN_POLICY.md`.
- Métricas y medición de uso en `METRICAS_TOKENS.md`, `token-sessions.csv` y `medir-tokens.ps1`.
- Empaquetado como plugin local de Codex/ChatGPT en `.codex-plugin/plugin.json`.
- Custom agent portable para VS Code y otros proveedores compatibles en `.github/agents/supervisor.agent.md`.
- Ayudas operativas en `instalar-agentes.ps1`, `instalar-agentes.sh`, `instalar-global-agentes.ps1`, `instalar-global-agentes.sh`, `preparar-agentes.ps1`, `iniciar-ssh-github.ps1` y `validar_agentes.py`.
- Un visor auxiliar en `AgentInteractionViewer/` para inspección local.

## Capacidades del repositorio

Este proyecto está pensado para:

1. Coordinar trabajo con un rol `supervisor` que reparte tareas entre especialistas.
2. Definir productos nuevos con un flujo ordenado de brief, backlog, diseño, implementación y verificación.
3. Trabajar con criterios claros para roles como producto, arquitectura, seguridad, UX, UI, ingeniería, QA, SRE, administración no-code, KPIs y datos/BI.
4. Aplicar una política explícita de reducción de tokens y contexto innecesario.
5. Medir uso real de sesiones cuando haya datos disponibles, sin inventar métricas.
6. Reutilizar el mismo equipo en Codex, ChatGPT Work y VS Code/GitHub Copilot.

## Instalación local

### Opción recomendada: instalar en este proyecto

1. Abrí una terminal en la raíz del repositorio.
2. Ejecutá:

```powershell
.\instalar-agentes.ps1
```

3. Si querés sincronizar cambios nuevos sobre perfiles ya instalados, usá:

```powershell
.\instalar-agentes.ps1 -Actualizar
```

En Linux o macOS:

```sh
./instalar-agentes.sh
```

Y para sincronizar perfiles ya instalados:

```sh
./instalar-agentes.sh --actualizar
```

### Instalación global

Si querés usar el mismo equipo desde otras carpetas:

```powershell
.\instalar-global-agentes.ps1
```

Para sincronizar una versión nueva:

```powershell
.\instalar-global-agentes.ps1 -Actualizar
```

En Linux o macOS:

```sh
./instalar-global-agentes.sh
```

O para sincronizar perfiles globales ya existentes:

```sh
./instalar-global-agentes.sh --actualizar
```

### Preparación de perfiles

Si editás la tabla de roles en `EQUIPO.md`, regenerá los perfiles con:

```powershell
.\preparar-agentes.ps1
```

Después validá la estructura si hace falta:

```powershell
python .\validar_agentes.py
```

## Uso en Codex

1. Abrí este repositorio como proyecto en Codex.
2. Pedile al agente `supervisor` que coordine el trabajo.
3. Para tareas nuevas, indicá producto, usuarios, problema, restricciones y resultado esperado.

Ejemplo de arranque:

> Usá el agente supervisor de este proyecto para coordinar esta tarea. Leé `AGENTS.md`, `EQUIPO.md` y `TOKEN_POLICY.md`, definí problema, usuarios, alcance y criterios de éxito, y delegá solo las subtareas necesarias.

Si el perfil `supervisor` no aparece como agente cargado, seguí usando las instrucciones de `AGENTS.md` y revisá la instalación local antes de asumir que la configuración del proveedor quedó lista.

## Uso en VS Code

El agente portable vive en `.github/agents/supervisor.agent.md`.

Flujo básico:

1. Abrí esta carpeta en VS Code.
2. Activá un proveedor compatible con custom agents, como GitHub Copilot o Codex.
3. Elegí el agente `supervisor` en Chat.
4. Si no aparece, recargá la ventana y revisá las personalizaciones del workspace.

Más detalle en [`VSCODE.md`](./VSCODE.md).

## Variables de entorno y configuración

Este repositorio no debe guardar secretos ni credenciales reales. La regla general es:

- `.env.example` documenta nombres de variables.
- `.env` local contiene los valores reales.
- `.env` no se versiona.

### Variables sugeridas

El archivo `.env.example` hoy solo define un contrato mínimo. A medida que el proyecto incorpore integraciones, agregá variables con este criterio:

- `SERVICE_API_KEY`: clave privada de una integración externa.
- `SERVICE_BASE_URL`: URL base de un servicio configurable.
- `SERVICE_TIMEOUT_MS`: tiempo de espera para llamadas de red.
- `GITHUB_TOKEN`: token personal si algún flujo lo requiere.
- `SSH_KEY_PATH`: ruta local a la clave SSH autorizada para GitHub.

Si una variable es sensible:

- no la escribas en el repositorio,
- no la imprimas en logs,
- no la hardcodees en scripts,
- y si falta, devolvé un error accionable.

### Buenas prácticas

- Usá rutas relativas o parámetros cuando sea posible.
- Evitá asumir nombres de usuario, carpetas o cuentas concretas.
- Mantené la configuración pública en el repo y la sensible fuera de él.

## Medición de tokens

Si querés controlar el costo de contexto y salida:

```powershell
.\medir-tokens.ps1
```

Para comparar etapas:

```powershell
.\medir-tokens.ps1 -Baseline baseline -Comparar token-policy-v1
```

Los números deben salir de medición real. Si no hay datos, reportá `no medido`.

## Estructura principal

- `AGENTS.md`: reglas de coordinación.
- `EQUIPO.md`: roles, entregables y criterios.
- `TOKEN_POLICY.md`: política de contexto y salidas.
- `METRICAS_TOKENS.md`: cómo medir uso.
- `skills/equipo-agentes/SKILL.md`: skill principal del equipo.
- `skills/equipo-agentes/push-github-ssh.md`: procedimiento seguro para publicar en GitHub por SSH.
- `.codex-plugin/plugin.json`: definición del plugin local.
- `.github/agents/supervisor.agent.md`: custom agent portable.
- `instalar-agentes.sh` y `instalar-global-agentes.sh`: instalación portable en Unix-like.

## Recomendación de trabajo

Para usar bien este repositorio:

1. Definí primero el problema y el tipo de producto.
2. Leé solo los archivos relevantes para esa tarea.
3. Delegá en mini tareas con objetivo único.
4. Verificá cambios con evidencia, no con supuestos.
5. Tratá secretos, rutas locales e integraciones como configuración externa.

## Documentación complementaria

- [`LEEME.md`](./LEEME.md)
- [`VSCODE.md`](./VSCODE.md)
- [`EQUIPO.md`](./EQUIPO.md)
- [`AGENTS.md`](./AGENTS.md)
