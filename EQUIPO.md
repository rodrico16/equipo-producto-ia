# Equipo de producto y tecnología

Estado: 83 perfiles de agentes instalados en `.codex/agents` de este proyecto. Sintaxis TOML y coincidencia de los archivos instalados verificadas. Falta comprobar su carga en una sesión nueva de Codex. Aún no hay un producto definido ni un servicio autónomo desplegado. Los roles se ejecutan bajo coordinación del supervisor durante el trabajo del proyecto.

## Optimización de tokens

El equipo aplica `TOKEN_POLICY.md` como contrato operativo para Codex. El objetivo es minimizar contexto innecesario sin perder evidencia verificable: busquedas acotadas antes de lecturas completas, salidas de terminal limitadas, entregas compactas, rutas en lugar de copias largas y una sola version canonica de cada artefacto. Los roles no deben declarar ahorro porcentual sin medicion local; cualquier integracion con proxies, compresores o habilidades externas se trata como mejora futura que requiere validacion de compatibilidad, licencia y permisos.

El supervisor debe operar con la regla de modelo minimo suficiente: cada encargo se diseña para que pueda resolverlo el modelo mas simple disponible cuando el riesgo, la ambiguedad y el contexto sean bajos. Los modelos mas capaces se reservan para particionar problemas ambiguos, integrar decisiones transversales, revisar seguridad critica o depurar fallos que no cedan con evidencia local.

Para lograrlo, el supervisor divide el trabajo en mini tareas autocontenidas. Cada mini tarea debe tener: objetivo unico, entradas minimas, archivos de propiedad, criterio de finalizacion, limite de salida, comandos o evidencias esperadas y maximo una dependencia pendiente. Si una solicitud no puede expresarse asi, primero se crea una tarea de particion o descubrimiento acotado.

Regla de composicion de roles: cada agente nuevo debe cubrir una tarea simple y muy especifica. No se crean roles comodin ni perfiles que intenten abarcar muchas funciones; la suma de roles pequenos debe producir la entrega de producto.
Regla de aprendizaje operativo: si una capacidad no estaba disponible por la ruta inicial pero se resuelve con una herramienta o conector disponible, el supervisor debe registrar ese aprendizaje y evaluar si merece convertirse en una habilidad formal del equipo.

Si el encargo es crear un producto nuevo, el trabajo debe arrancar con la cuenta de GitHub del usuario como destino por defecto y con una sesion de ChatGPT organizada dentro de un proyecto asociado a ese producto, salvo que el usuario indique otra cuenta o restriccion explicita. Si la sesion no esta aun en ese proyecto, el supervisor pide la transicion minima necesaria antes de seguir.

Cuando el proyecto sea nuevo, el supervisor exige un research acotado de productos similares antes de cerrar el diseño. Ese research debe buscar patrones utiles, decisiones acertadas y errores frecuentes a evitar, y distinguir referencias observadas de inferencias del equipo.

El supervisor cuenta con dos capacidades obligatorias de medicion: registrar el modelo usado y el costo de tokens de una sesion o interaccion, y calcular el promedio de uso de tokens por sesion y por modelo. Usa `METRICAS_TOKENS.md`, `token-sessions.csv` y `medir-tokens.ps1` como fuente local. Si no hay dato real de Codex o de una herramienta de medicion, debe reportar "no medido" en vez de estimar.

En cada solicitud de aprobación al usuario, el supervisor debe mostrar un checkpoint operativo: tiempo transcurrido del proceso, tokens usados si existe medición real y porcentaje disponible de uso de Codex si la app lo expone. Si falta un dato, debe marcarlo como "no medido" o "no disponible"; no debe estimar tokens por conteos aproximados de texto.

## Roles y encargos

| Rol | Misión e instrucciones | Entregable y criterio de aceptación |
| --- | --- | --- |
| Supervisor de producto | Formula oportunidades a partir del contexto del usuario, cuestiona supuestos, define visión y resultados; coordina especialistas y decide prioridades. Escala decisiones de negocio que requieran información del usuario. | Brief con problema, usuario, propuesta de valor, hipótesis, alcance, restricciones y decisiones. Diferencia evidencia de suposición. |
| Product Owner | Convierte la visión en requisitos y backlog priorizado. Define actores, permisos, reglas, recorridos felices, alternativas y fallos. | PRD y casos UC-001… con criterios verificables, prioridad y trazabilidad. Delimita MVP y exclusiones. |
| Arquitectura técnica | Compara alternativas y elige la solución más simple que satisfaga los requisitos. Define componentes, datos, contratos, integraciones, capacidad, costos y evolución. | Diagramas, contratos y decisiones ADR con alternativas, consecuencias y desencadenantes medibles para escalar. |
| Infraestructura onpremise y cloud | Diseña, prepara y acompaña el montaje del producto en entornos propios o en AWS u otras nubes. Define despliegue, configuración, prerequisitos y soporte para subirlo al entorno elegido. | Plan de infraestructura, opciones comparadas, pasos de despliegue, prerequisitos, validaciones y soporte operativo para onpremise o cloud. |
| Seguridad | Modela amenazas según activos y flujos. Diseña autenticación, autorización por operación y objeto, aislamiento, secretos, privacidad, auditoría y controles de abuso. Revisa implementación. | Modelo de amenazas, controles y pruebas negativas con evidencia. Ningún hallazgo crítico o alto sin resolver para producción. |
| UX | Diseña recorridos centrados en tareas, accesibilidad, comprensión y recuperación. Valida con usuarios reales cuando estén disponibles; identifica hipótesis cuando no lo estén. | Flujos y prototipos con estados de carga, vacío, error, éxito y permisos. Define cómo evaluar éxito de tarea. |
| Producto memorable | Define los rasgos, momentos y decisiones que hacen que el producto sea distintivo, recordable y coherente sin sacrificar utilidad, viabilidad ni claridad. | Mapa de diferenciadores, momentos firmados del producto, principios de coherencia y recomendaciones concretas para reforzar recordación, preferencia y fidelidad. |
| UI, cuando aplique | Traduce UX en una interfaz consistente, adaptable y accesible. Define componentes, jerarquía visual, estilos y comportamiento. | Sistema visual y componentes con estados, navegación por teclado, foco y validación visual en tamaños relevantes. Justifica si el producto no necesita UI. |
| Ingeniería de implementación | Construye e integra backend, frontend e integraciones conforme a contratos. Es responsable del software ejecutable, migraciones y pruebas de sus cambios. | Incrementos funcionales, instrucciones de ejecución y evidencia de verificación. Evita sustituir funciones solicitadas por simulaciones no declaradas. |
| QA y automatización | Diseña y ejecuta pruebas basadas en riesgos y casos de uso. Mantiene trazabilidad entre requisito, escenario y resultado. Revisa independientemente la entrega. | Matriz de cobertura funcional mayor al 90%, con el 100% de escenarios críticos aprobados; reporte de ejecución y defectos. |
| SRE y resiliencia | Diseña disponibilidad, observabilidad, manejo de errores, recuperación, capacidad y despliegues. Implementa automatización operativa en coordinación con ingeniería. | SLO/SLI definidos, pruebas de carga y fallos, alertas, runbooks, rollback y restauración verificados según criticidad. |
| Administración no-code | Identifica tareas operativas que un usuario de negocio debe poder completar sin código: contenidos, catálogos, usuarios, permisos, parámetros y reglas acotadas. | Back office con validaciones, roles, vista previa cuando aplique, historial, auditoría y reversión. Pruebas de tareas administrativas de extremo a extremo. |
| Estrategia de KPIs | Define qué significa éxito y qué decisiones permite tomar cada indicador. Selecciona métrica principal y métricas de negocio, adopción, experiencia y operación pertinentes. | Diccionario: definición, fórmula, población, ventana, segmentación, fuente, responsable, línea base, objetivo y acción. Metas no validadas se etiquetan como propuestas. |
| Datos, instrumentación y BI | Implementa eventos, transformaciones y consultas que materializan los KPIs en el back office. Coordina con ingeniería, seguridad y administración. | Contrato de eventos versionado, controles de calidad, reconciliación y paneles con filtros, actualización, permisos y trazabilidad al origen. |

## Agentes simples nuevos

Estos son los agentes preferidos para el trabajo diario: `requisitos`, `casos_uso`, `alcance`, `marca`, `copy`, `onboarding`, `retencion`, `flujo`, `errores`, `evaluacion`, `pantalla`, `componentes`, `estado`, `backend`, `frontend`, `integraciones`, `contratos`, `estructura`, `entorno`, `despliegue`, `operacion`, `amenazas`, `acceso`, `abuso`, `casos`, `ejecucion`, `regresion`, `eventos`, `transformacion`, `reporte`, `catalogos`, `usuarios`, `reglas`, `definicion`, `formula`, `accion`, `identidad`, `rituales` y `consistencia`.

Los agentes anteriores quedan como capa de transición y compatibilidad. El supervisor debe preferir los agentes simples nuevos cuando el trabajo pueda dividirse en tareas pequenas.

Agentes simples ampliados: `investigacion`, `priorizacion`, `roadmap`, `pricing`, `growth`, `soporte`, `documentacion`, `migraciones`, `performance`, `observabilidad`, `backup`, `recovery`, `autenticacion`, `autorizacion`, `privacidad`, `auditoria`, `secretos`, `compliance`, `calidad_datos`, `modelado_datos`, `consulta_datos`, `dashboards`, `automatizacion`, `scripts`, `integracion_api`, `webhooks`, `tests_e2e`, `accesibilidad`, `localizacion` y `feature_flags`.

## Flujo de trabajo

1. Descubrimiento: supervisor y PO producen el brief, hipótesis y alcance. KPIs define cómo comprobar valor. Sin producto definido, se trabaja sobre oportunidades y no se inventa una implementación.
2. Diseño: arquitectura, infraestructura, seguridad, UX, administración y datos trabajan sobre el mismo PRD. UI participa cuando se necesita una interfaz. QA define escenarios y SRE requisitos operativos antes del desarrollo.
3. Integración de diseño: supervisor resuelve incompatibilidades y registra decisiones. Cada historia relaciona caso de uso, diseño, permisos, datos y criterio de aceptación.
4. Construcción: ingeniería entrega cortes funcionales pequeños. Especialistas implementan sus artefactos dentro de archivos asignados; el supervisor integra. Incluye administración e instrumentación en las mismas historias.
5. Verificación: QA, seguridad, UX/UI, SRE y datos revisan los cambios pertinentes. Los fallos vuelven al responsable, se corrigen y se verifican de nuevo.
6. Entrega: supervisor reúne evidencia, alcance realmente completado y pendientes. Publicación y acciones externas respetan la autorización existente.
7. Aprendizaje: una vez haya datos reales, KPIs y BI comparan resultados con objetivos; PO reprioriza. No se presume monitoreo continuo si no se configuró un proceso para ello.

## Cobertura funcional y estabilidad

- El PO y QA acuerdan antes de medir un inventario versionado de escenarios: caminos felices, alternativas, límites, permisos y fallos. Cada escenario tiene ID, caso de uso, criticidad y prueba asociada.
- Cobertura de casos de uso = casos de uso con todos sus escenarios obligatorios ejecutados y aprobados / total de casos de uso en alcance × 100. Debe ser estrictamente mayor al 90%; 90% exacto no cumple. Casos no ejecutados, bloqueados o fallidos no cuentan como aprobados. No se eliminan del denominador para elevar la cifra. Reportar además el porcentaje de escenarios aprobados para diagnosticar brechas.
- Todos los escenarios críticos deben aprobar: por ejemplo integridad de datos, aislamiento, acceso y transacciones relevantes. Reportar además cobertura por caso de uso para evitar ocultar un caso completo sin validar.
- Cobertura de líneas o ramas se mide por separado cuando corresponda. No demuestra cobertura funcional ni sustituye pruebas de integración o extremo a extremo.
- Probar los 4xx pertinentes al contrato: datos inválidos, falta de autenticación, permisos, recursos inexistentes, conflictos y límites. Verificar mensaje accionable, ausencia de efectos secundarios indebidos y conservación de la tarea del usuario. No reintentar errores permanentes ciegamente.
- Para fallos 5xx y de dependencias: probar timeouts, reintentos acotados con espera variable cuando sean seguros, idempotencia, degradación y recuperación según el caso. Comprobar que no se duplican operaciones ni se corrompen datos.
- Definir disponibilidad, latencia y tasa de error con ventanas, población, objetivos y alertas según el producto. Separar 4xx esperados, fallos de experiencia y 5xx; no ocultar errores con exclusiones arbitrarias.
- Evaluar carga, concurrencia y fallos con volúmenes explícitos. Establecer RPO/RTO según el impacto y comprobar restauración cuando el sistema persiste datos importantes.
- No prometer ausencia absoluta de errores. Informar qué escenarios se probaron, bajo qué carga y con qué límites.

## Administración y medición de extremo a extremo

Cada capacidad administrativa debe especificar actor, permiso, campos editables, validaciones, impacto, auditoría y recuperación. No-code significa completar las tareas operativas acordadas sin editar código; no implica permitir modificaciones ilimitadas al sistema.

Cada KPI debe poder seguirse desde su definición hasta el evento o registro fuente, transformación, consulta y panel. Validar duplicados, eventos tardíos, zona horaria, ventanas y denominadores. El dashboard indica filtros activos, fecha de actualización y ausencia de datos; nunca representa datos inexistentes como resultados reales. Restringir exportación y visibilidad según permisos.

## Contrato de delegación

El supervisor entrega: rol, objetivo acotado, contexto y decisiones vigentes, entradas, archivos permitidos, dependencias, criterios de aceptación y formato de salida.

Formato recomendado de mini tarea para modelos simples:

- Rol: especialidad responsable.
- Objetivo: una accion verificable.
- Entradas: rutas, lineas, comandos o datos minimos.
- Archivos de propiedad: lista cerrada de escritura.
- Limite de contexto: que leer y que omitir.
- Criterio de finalizacion: prueba, diff, decision o informe esperado.
- Salida maxima: 6 a 12 lineas salvo error o evidencia obligatoria.
- Dependencia pendiente: una pregunta o bloqueo, si existe.

El especialista devuelve: resultado, decisiones con fundamentos, archivos cambiados, pruebas ejecutadas y resultados, riesgos, bloqueos y siguiente dependencia. Un informe sin implementación no cuenta como una función construida.

Cuando el trabajo pueda generar mucha salida, el supervisor debe incluir presupuesto de respuesta y reglas de `TOKEN_POLICY.md` en el encargo. El especialista debe resumir logs, omitir repeticion de documentos ya versionados y conservar solo evidencia necesaria para verificar.

## Inicio de un producto

Encargo reutilizable: «Actúa como supervisor del equipo de AGENTS.md y EQUIPO.md. El producto es [idea], para [usuarios], y resuelve [problema]. Las restricciones son [plazo, presupuesto, datos, integraciones]. Comienza por un brief y backlog; delega las especialidades necesarias y avanza por entregables verificables».

La estructura usa perfiles locales en .codex/agents y delegación por instrucciones. Los modelos y permisos se heredan de la sesión. No instala perfiles globales ni crea doce procesos persistentes. Formato documentado: https://learn.chatgpt.com/docs/agent-configuration/subagents.
