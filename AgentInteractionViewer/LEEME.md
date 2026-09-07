# Visor de interacción de agentes

Aplicación Windows local para inspeccionar cómo está coordinado el equipo de agentes del proyecto.

## Estado actual

- Detecta los 53 agentes instalados en `.codex/agents`.
- Puede mostrar referencias entre perfiles y menciones en la documentación del proyecto.
- No lee telemetría interna de Codex ni conversaciones privadas no expuestas como archivos.

## Ejecutar

```powershell
.\AgentInteractionViewer\bin\AgentInteractionViewer.exe (Get-Location).Path
```

## Compilar de nuevo

```powershell
.\AgentInteractionViewer\build.ps1
```

## Qué muestra

- Agentes instalados en `.codex/agents`.
- Referencias entre agentes dentro de perfiles TOML.
- Menciones de agentes en `AGENTS.md`, `EQUIPO.md`, `TOKEN_POLICY.md`, `METRICAS_TOKENS.md` y `LEEME.md`.
- Estado del archivo local `token-sessions.csv`.

## Límite actual

El visor no lee telemetría interna de Codex ni conversaciones privadas no expuestas como archivos. Las interacciones se dividen entre evidencia local observada e inferencias por menciones/referencias en los artefactos del proyecto.
