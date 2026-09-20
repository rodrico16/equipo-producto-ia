# Messaging-first UX v1

## Objetivo

Transformar el Control Room en una experiencia de mensajería mobile-first inspirada en patrones conocidos de WhatsApp, sin copiar branding ni perder capacidades propias del producto.

Principio rector: **el usuario abre un chat con un equipo AI, define cómo trabaja y después conversa**.

## Alcance de esta PR

### P0 — Lista de chats
- Home mobile abre en lista de chats.
- Header `Chats` con creación rápida de conversación.
- Buscador por título, contenido, repo o proveedor.
- Filtros: Todos, Activos, Con error, Con PR, Repos, Copilot y ChatGPT.
- Cada fila muestra proveedor, modo, repo, último evento, hora y estado.

### P0 — Conversación
- Header compacto con acceso a configuración.
- Burbujas diferenciadas para usuario y agentes.
- Eventos de sistema compactos.
- Herramientas consecutivas agrupadas en un bloque colapsable.
- Card de entrega para diff / Pull Request.
- Composer fijo y mobile-first.

### P0 — Nuevo chat / configuración
- Crear chat abre un bottom sheet de configuración.
- Modos: Solo chat, Repo · borrador, Repo + PR.
- Proveedor, modelo, esfuerzo, repo y rama se guardan por conversación.
- Conexiones GitHub / ChatGPT disponibles dentro del mismo sheet.

### P1 — Estados
- Run activo visible sin llenar el timeline de ruido técnico.
- Error persistente y comprensible encima del composer.
- Estado de PR visible en la lista de chats.

## Fuera de alcance

- Cambios en `/api/run`, Copilot SDK, Codex o autenticación.
- Runner desacoplado para trabajos >5 minutos (PR separado).
- Swipe actions, favoritos, pin y archivado real.
- Backend de búsqueda.

## Criterios de aceptación

### Lista
1. En iPhone la primera pantalla es la lista de chats.
2. Crear un chat requiere un tap y abre configuración guiada.
3. Buscar no pierde el chat activo ni modifica datos.
4. Los filtros se pueden combinar con texto de búsqueda sin recargar.
5. Un chat activo/error/PR tiene estado visual identificable.

### Conversación
1. Mensajes de usuario y agentes se distinguen inmediatamente.
2. Los `tool.started` y fallos consecutivos no ocupan una burbuja por evento; aparecen agrupados.
3. El detalle técnico sigue disponible expandiendo el grupo.
4. El composer permanece accesible con teclado móvil abierto.
5. La configuración del chat se abre sin abandonar la conversación.

### Configuración
1. Cambiar modo no borra mensajes previos.
2. Copilot sigue requiriendo GitHub y ChatGPT sigue siendo opcional si Copilot está disponible.
3. Repo y rama siguen asociados al chat.
4. Crear repo continúa usando el endpoint existente.
5. Cerrar el sheet devuelve a la conversación sin navegación adicional.

### Regresión
1. Solo chat funciona con ChatGPT y Copilot según conexión.
2. Repo · borrador conserva el comportamiento actual.
3. Repo + PR sigue usando `/api/run` sin cambios de contrato.
4. Chats existentes en `epia_control_room_chats_v3` se preservan.
5. TypeScript y `next build` deben pasar.

## Backlog siguiente

### UX-02 — Runs resilientes
- desacoplar run del request HTTP;
- restaurar progreso por `runId`;
- tolerar Safari suspendido / cambio Wi-Fi ↔ 5G.

### UX-03 — Gestión de chats
- archivar;
- fijar;
- favoritos;
- swipe actions en mobile.

### UX-04 — Resultados
- vista dedicada de diff;
- historial de PR por chat;
- retry de ejecución fallida;
- continuar desde el último resultado.

### UX-05 — Polish
- animaciones de transición lista ↔ conversación;
- estados skeleton;
- accesibilidad VoiceOver;
- keyboard navigation desktop;
- ajuste fino de safe areas y teclado iOS.
