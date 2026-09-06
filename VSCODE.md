# Usar el equipo en VS Code

Este repositorio incluye un custom agent agnostico al proveedor: `.github/agents/supervisor.agent.md`. VS Code lo detecta como agente del workspace y puede ejecutarlo con GitHub Copilot, Codex u otro proveedor compatible con custom agents.

## Instalación del custom agent

1. Abrí VS Code.
2. Abrí esta carpeta desde `File > Open Folder...`:
   `C:\Users\rodri\OneDrive\Documentos\ChatGPT\Agentes`
3. Instalá o habilitá el proveedor que quieras usar, por ejemplo GitHub Copilot o Codex.
4. Abrí Chat y seleccioná `supervisor` en el selector de agentes.
5. Si no aparece, ejecutá `Chat: Open Customizations` y revisá los agentes del workspace, o abrí el diagnóstico de personalizaciones.

El archivo estándar vive en `.github/agents`, por lo que se versiona junto al proyecto y queda disponible para el equipo. El proveedor aporta el modelo, las herramientas, los permisos y la capacidad de delegar subagentes; el archivo aporta el rol y el proceso.

No guardes claves API ni credenciales en el repositorio. Si el proveedor no soporta `*.agent.md`, usá las instrucciones canónicas de `AGENTS.md` y el prompt base de esta guía.

## Si no aparece `supervisor`

El custom agent no funciona como una extensión independiente. Primero debe estar instalado y habilitado un proveedor que ofrezca Chat y custom agents. Después:

1. Ejecutá `Developer: Reload Window` desde `Ctrl+Shift+P`.
2. Abrí Chat y comprobá el selector de agentes.
3. Ejecutá `Chat: Open Customizations` y revisá los agentes del workspace.
4. Abrí el diagnóstico de personalizaciones desde el menú contextual de Chat y comprobá si hay errores de carga.
5. Confirmá que la carpeta abierta sea la raíz del repositorio y contenga `.github/agents/supervisor.agent.md`.

Desde una terminal también podés comprobar los proveedores instalados:

```powershell
code --list-extensions | Select-String -Pattern "copilot|codex"
```

Si el comando no devuelve nada, instalá o habilitá GitHub Copilot, Codex u otro proveedor compatible y repetí la recarga.

## Qué reutiliza VS Code

- `AGENTS.md`: coordinación general.
- `EQUIPO.md`: roles, criterios y verificación.
- `TOKEN_POLICY.md`: reglas de ahorro de contexto.
- `METRICAS_TOKENS.md`: medición de uso.
- `.codex-plugin/plugin.json`: empaquetado local del proyecto.
- `skills/equipo-agentes/SKILL.md`: comportamiento principal del equipo.

## Flujo recomendado

1. Abrí esta carpeta en VS Code y confirmá que el proveedor esté trabajando sobre ella.
2. Seleccioná el custom agent `supervisor` y pedile que delegue según `EQUIPO.md`.
3. Para tareas de desarrollo y pruebas, pedile que:
   - lea solo los archivos relevantes,
   - cambie solo los archivos asignados,
   - ejecute las pruebas necesarias,
   - devuelva evidencia breve y verificable.

Usá el modo de chat para analizar o planificar, y un modo de agente con permisos acotados para implementar. Revisá el diff antes de aceptar cambios y creá un checkpoint de Git antes de una tarea importante.

## Prompt base sugerido

> Usá el custom agent `supervisor` de este proyecto para coordinar esta tarea. Leé `AGENTS.md`, `EQUIPO.md` y `TOKEN_POLICY.md`, identificá problema, alcance y criterios de éxito, y después delegá solo las subtareas necesarias. Mantené secretos fuera del repositorio, no inventes pruebas ni métricas, y devolvé evidencia breve con archivos modificados y verificación.

## Primera prueba

Después de abrir el proveedor, seleccioná `supervisor` y enviá este mensaje:

> Leé `AGENTS.md`, `EQUIPO.md` y `TOKEN_POLICY.md`. No modifiques archivos: devolvé las responsabilidades de los roles, las dependencias principales y confirmá si pudiste cargar el custom agent `supervisor`.

Luego probá una tarea pequeña:

> Usá el supervisor. Revisá el cambio que tengo seleccionado, proponé una corrección acotada, ejecutá únicamente las pruebas relevantes y mostrame el diff antes de aplicar cambios.
