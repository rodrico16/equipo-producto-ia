# Revisión UX/UI v2

## Contexto y alcance

Producto: Control Room web para configurar y supervisar un equipo de agentes que trabaja sobre repositorios.

La revisión es estática y se basa en la interfaz actual. Excluye el zoom del campo de escritura, que ya fue corregido, y no sustituye pruebas con usuarios ni validaciones en dispositivos reales.

## Mejoras priorizadas

### 1. P0 — Hacer accesibles los controles y el foco

- **Evidencia:** hay botones representados solo por iconos sin nombre accesible y los campos eliminan el `outline`; no existe un estilo `:focus-visible` consistente.
- **Propuesta:** agregar nombres accesibles y ayudas contextuales a los controles de icono, además de un anillo de foco visible de al menos 2 px y contraste mínimo 3:1.
- **Impacto / esfuerzo:** alto / bajo.
- **Criterio de aceptación:** todos los controles tienen un nombre accesible único y el recorrido completo con `Tab` conserva un indicador de foco visible.

### 2. P0 — Convertir la configuración en un diálogo accesible

- **Evidencia:** el panel de configuración se presenta como un `aside`, sin semántica de diálogo modal, cierre con `Escape` ni gestión explícita del foco.
- **Propuesta:** implementar `role="dialog"`, `aria-modal`, título asociado, foco inicial, contención del foco, cierre con `Escape` y retorno al control que lo abrió.
- **Impacto / esfuerzo:** alto / medio.
- **Criterio de aceptación:** el diálogo se puede abrir, recorrer y cerrar solo con teclado; el foco no escapa mientras está abierto y vuelve al disparador al cerrar.

### 3. P1 — Anunciar estados y permitir recuperar errores

- **Evidencia:** los estados de ejecución y los errores cambian visualmente, pero no usan regiones vivas; el error informa el fallo sin ofrecer una acción de recuperación.
- **Propuesta:** usar `role="status"` o `aria-live` para el progreso, `role="alert"` para errores y una acción **Reintentar** que conserve borrador, proveedor, repositorio y contexto.
- **Impacto / esfuerzo:** alto / medio.
- **Criterio de aceptación:** el lector de pantalla anuncia cada cambio relevante una sola vez y reintentar no pierde ninguna entrada del usuario.

### 4. P1 — Mostrar un vacío útil al buscar

- **Evidencia:** cuando la búsqueda no encuentra chats, la lista queda vacía aunque ya existe un estilo de estado vacío.
- **Propuesta:** mostrar “Sin resultados para …”, una breve explicación y la acción **Limpiar búsqueda**.
- **Impacto / esfuerzo:** medio / bajo.
- **Criterio de aceptación:** una consulta sin coincidencias muestra el estado vacío y recupera la lista completa con una sola acción.

### 5. P1 — Mejorar legibilidad y contraste

- **Evidencia:** metadatos, horas, mensajes de sistema y errores usan tamaños funcionales de 7 a 10 px, difíciles de leer en pantallas pequeñas.
- **Propuesta:** elevar el texto funcional a una base mínima de 12 px, revisar altura de línea y asegurar contraste WCAG AA.
- **Impacto / esfuerzo:** alto / medio.
- **Criterio de aceptación:** el texto alcanza contraste 4.5:1 y la interfaz funciona al 200 % de zoom y en anchos de 320, 768 y 1440 px sin pérdida de contenido o acciones.

## Evidencia y validación pendiente

Archivos revisados: `README.md`, `components/supervisor-workspace.tsx` y `components/supervisor-workspace.module.css`.

Antes de implementar, validar las prioridades con analítica o usuarios reales. Después de implementar, probar con teclado, lector de pantalla y dispositivos representativos.
