# ChatGPT / Codex en Control Room

El Control Room puede ejecutar el mismo equipo de agentes con dos proveedores de IA:

- **GitHub Copilot:** usa la sesión GitHub OAuth del usuario y los modelos disponibles en su suscripción Copilot.
- **ChatGPT / Codex:** usa **Sign in with ChatGPT** mediante el flujo oficial de device authorization de Codex y los modelos que `model/list` expone para esa cuenta.

## Conectar ChatGPT

1. Iniciá sesión en el Control Room con GitHub.
2. Elegí **ChatGPT / Codex** como proveedor.
3. Tocá **Conectar ChatGPT**.
4. El Control Room muestra el código de dispositivo y el enlace de autorización.
5. Abrí el enlace, iniciá sesión en ChatGPT e ingresá el código.
6. Al completarse la autorización, la UI carga automáticamente los modelos y niveles de razonamiento habilitados para la cuenta.

Si el flujo de device authorization está deshabilitado para la cuenta o workspace, debe habilitarse desde la configuración de seguridad de ChatGPT antes de conectar.

## Seguridad

La autenticación de ChatGPT no se guarda en variables de entorno, GitHub ni `localStorage`. Codex administra su sesión dentro de un **Vercel Sandbox persistente nombrado por usuario**.

Para ejecutar una tarea, el Control Room crea un **fork efímero** de ese sandbox autenticado, clona el repositorio objetivo con credenciales temporales, sanea el remote y ejecuta Codex en `workspace-write`. Al terminar, el Control Room crea commit, rama y Pull Request usando la sesión GitHub del usuario. Nunca hace merge automático.

## Variables de entorno

No se necesita `OPENAI_API_KEY`, `CHATGPT_TOKEN` ni ningún secreto OpenAI. En Vercel siguen siendo obligatorias solamente:

```env
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
SESSION_SECRET=
```

## Modelos

Los modelos ChatGPT/Codex no están hardcodeados. El endpoint `/api/chatgpt/models` consulta `model/list` del Codex App Server y devuelve los modelos disponibles para la cuenta autenticada, junto con el modelo recomendado y sus niveles de razonamiento soportados.

En la UI, **Auto** no fuerza `model_reasoning_effort`: deja que Codex use el valor recomendado para el modelo efectivo. Los niveles explícitos solo se envían cuando el modelo activo los reporta como soportados; si el usuario cambia de proveedor o modelo y el esfuerzo deja de ser compatible, el Control Room lo descarta antes de ejecutar.

## Endpoints

- `POST /api/chatgpt/login` inicia device authorization.
- `GET /api/chatgpt/status` informa `disconnected`, `pending`, `connected`, `failed` o `expired`.
- `GET /api/chatgpt/models` devuelve los modelos Codex disponibles para la cuenta.
- `POST /api/chatgpt/logout` revoca la sesión Codex del sandbox persistente.
- `POST /api/run` acepta `provider: "copilot" | "chatgpt"` y ejecuta el pipeline común de cambios + PR.
