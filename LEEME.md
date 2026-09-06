# Cómo usar el equipo

Los 12 agentes están instalados en `.codex/agents` de esta carpeta. Cada archivo TOML contiene nombre, descripción e instrucciones del agente. `AGENTS.md` establece la coordinación y `EQUIPO.md` detalla los criterios de trabajo.

Este repositorio también se empaqueta ahora como plugin local de Codex/ChatGPT en `.codex-plugin/plugin.json`, con una skill principal en `skills/equipo-agentes/SKILL.md` y un marketplace local en `.agents/plugins/marketplace.json`.

`TOKEN_POLICY.md` agrega reglas para ahorrar tokens en Codex: lecturas acotadas, salidas de terminal resumidas, entregas breves y artefactos canonicos. Los perfiles generados la referencian automáticamente.

`METRICAS_TOKENS.md` define cómo medir el consumo real. Registra sesiones en `token-sessions.csv` y ejecuta `.\medir-tokens.ps1` para ver promedios. Para comparar dos etapas: `.\medir-tokens.ps1 -Baseline baseline -Comparar token-policy-v1`.

Cuando el supervisor pida aprobación, debe incluir un checkpoint con tiempo transcurrido, tokens usados medidos y porcentaje disponible de Codex. Los tokens no se estiman: si la app no los expone, se informa `no medido`.

## Configuración segura

No guardes claves API, contraseñas, tokens, certificados ni claves SSH en el repositorio. Usa variables de entorno o un archivo `.env` local; `.env` y los datos locales de sesiones están excluidos por `.gitignore`. El archivo `.env.example` solo documenta nombres de variables y nunca debe contener valores reales.

El plugin aplica esta separación en cada producto: configuración pública en el repositorio y configuración sensible o específica del entorno en variables de entorno o `.env` local. Los scripts deben aceptar rutas y valores variables por parámetros o entorno, sin asumir nombres de usuario ni carpetas concretas.

## Primera comprobación

Abrí una sesión nueva de Codex usando esta carpeta como proyecto y enviá:

> Usá el agente supervisor de este proyecto para revisar la estructura del equipo y devolver sus responsabilidades y dependencias. No comiences a construir ningún producto. Indicá si pudiste cargar el perfil supervisor o si estás usando solamente las instrucciones de AGENTS.md.

La instalación verificó sintaxis y archivos; la carga efectiva de perfiles por la aplicación debe confirmarse en esa sesión. Los agentes trabajan cuando reciben encargos, no quedan ejecutándose permanentemente.

## Uso con una idea

> Usá el supervisor y delegá en los agentes de este proyecto para trabajar sobre esta idea: [idea]. Primero definí el problema, usuarios, alcance y criterios de éxito; luego coordiná los especialistas necesarios.

## Perfiles

`supervisor`, `product_owner`, `arquitectura`, `seguridad`, `ux`, `ui`, `ingenieria`, `qa`, `sre`, `administracion_nocode`, `kpis`, `datos_bi`.

No se fijaron modelos ni se modificaron permisos. Los perfiles heredan la configuración de la sesión. Esta instalación se aplica a este proyecto; no configura automáticamente otras carpetas.

## Uso global en cualquier proyecto Codex

Para usar este equipo en cualquier proyecto, instala los perfiles como agentes personales:

```powershell
.\instalar-global-agentes.ps1
```

Si ya existen perfiles globales y querés sincronizar esta versión:

```powershell
.\instalar-global-agentes.ps1 -Actualizar
```

Después abrí cualquier proyecto de Codex y pedí algo como:

> Usá el agente supervisor para coordinar este producto. Delegá en los agentes necesarios y aplicá la política de tokens.

Codex identifica los agentes personalizados por el campo `name` de cada TOML. Si la interfaz no ofrece mención directa con `@`, usá el nombre textual del agente: `supervisor`, `ingenieria`, `qa`, `seguridad`, etc.

Los archivos de `perfiles-agentes` son la copia preparada para instalación. `preparar-agentes.ps1` los regenera desde la tabla de EQUIPO.md; `instalar-agentes.ps1` copia al destino y evita sobrescribir perfiles diferentes. Usa `.\instalar-agentes.ps1 -Actualizar` solo cuando quieras sincronizar cambios generados sobre `.codex/agents`. No regeneres sobre personalizaciones sin revisarlas previamente.

Para instalar este proyecto como plugin local, abre el marketplace `.agents/plugins/marketplace.json` desde Codex y añade el plugin `equipo-agentes` desde la raíz del repositorio.

Documentación oficial: https://learn.chatgpt.com/docs/agent-configuration/subagents.
