# PACTO — Protocolo de Accesibilidad y Convivencia con Trazabilidad Operativa

Prototipo de interfaz y flujos para la gestión de convivencias familiares con acompañamiento jurisdiccional.

PACTO explora cómo organizar digitalmente una convivencia familiar, registrar sus eventos, canalizar incidencias y facilitar la consulta de información por personal autorizado. El objetivo planteado en la presentación del proyecto es apoyar la operación de la justicia familiar y reducir la presión sobre la infraestructura presencial cuando la autoridad determine que una modalidad extramuros es apropiada.

Estado del repositorio: prototipo de aplicación web/PWA, no sistema judicial certificado ni solución lista para operar con expedientes reales. Algunas pantallas implementan flujos y cálculos; otras simulan controles o muestran garantías que el código todavía no demuestra. La autoridad conserva la decisión y la valoración del caso.

## 1. ¿Qué problema busca atender?

Las convivencias familiares supervisadas pueden requerir coordinación entre juzgados, centros de convivencia, personal de monitoreo y las partes. Cuando los recursos presenciales son limitados, los retrasos y traslados pueden afectar a las familias y a la operación institucional.

La propuesta PACTO explora un esquema complementario: organizar ciertos procesos mediante un expediente digital, una secuencia de estados, registros de eventos y atención humana de excepciones. No propone que el software sustituya al juez ni que todos los casos sean aptos para una convivencia extramuros.

La presentación conceptual incluye cifras de rezago y plantea efectos potenciales en costos y tiempos. Este repositorio no aporta, por sí mismo, las fuentes ni una evaluación de impacto que permitan dar por verificadas esas cifras o beneficios. Los resultados de una simulación tampoco equivalen a resultados de operación real.

## 2. ¿Qué contiene este repositorio?

Una aplicación web construida con React, TypeScript, Vite y Firebase, acompañada de un servidor Express. Contiene pantallas para distintos perfiles, un modelo de convivencia, cálculos de cribado y alertamiento, integración con servicios de Google, componentes de notaría criptográfica y soporte parcial para uso sin conexión.

La aplicación representa una parte del ecosistema descrito en el documento conceptual. Es importante distinguir entre:

· Código presente: funcionalidad que puede identificarse en los archivos, sujeta a configuración, permisos y pruebas.
· Simulación o demostración: lógica para ensayar un flujo sin demostrar la operación física o institucional que representa.
· Visión propuesta: características mencionadas en la presentación que requieren diseño, integración y validación antes de considerarse implementadas.

La inspección que acompaña este README es estática: no se verificó la aplicación ejecutándose ni se validaron sus conexiones a servicios externos.

## 3. Perfiles y espacios de trabajo

Perfil de interfaz Propósito en el prototipo Alcance observado
Juez Revisar el cribado, consultar eventos y trabajar con documentos y sellos. La vista reúne cribado A-PACTO, bóveda J-PACTO y Workspace/CSG. Los cálculos no constituyen una decisión judicial validada.
Monitorista Observar sesiones, revisar excepciones y atender condiciones de triage. Incluye controles explícitos para simular condiciones y una activación manual de PRC. No se identificó una integración real con C5.
Custodio Acceder al flujo de convivencia correspondiente. La interfaz pide un folio de ocho dígitos y busca entre las sesiones que la cuenta ya puede consultar.
Conviviente Participar en el flujo de convivencia y registrar ciertas acciones. Comparte el portal de estados; la verificación facial mostrada es simulada, no una biometría implementada.
Auditor Consultar información de trazabilidad. Las reglas contemplan accesos de lectura; sus restricciones y la integridad efectiva necesitan pruebas con el emulador y revisión independiente.
S-ADMIN Administrar configuraciones, roles e incidencias. Existen interfaces y reglas para esas tareas, pero el código no demuestra la «ceguera pericial absoluta» descrita conceptualmente.

Perfiles visuales y permisos no son lo mismo. Las reglas de Firestore son las que deben limitar el acceso a los datos; ocultar un botón en la interfaz no es una barrera de seguridad suficiente. El código contempla un administrador inicial identificado por correo en las reglas y en la aplicación. Esa configuración debe revisarse antes de cualquier despliegue institucional.

## 4. Flujo general de una convivencia

El modelo de datos declara una máquina de estados. En términos sencillos, el recorrido representado es:

1. Ingesta (STATE_0_INGESTA): cribado y creación de una convivencia a partir de datos capturados.
2. Onboarding (STATE_1_ONBOARDING): aceptación de condiciones y preparación de la sesión.
3. Desacoplamiento (STATE_1_TIMEOUT): ventana temporal mostrada en la interfaz.
4. Convivencia activa (STATE_2_ACTIVE): operación de la sesión y registro de eventos.
5. Triage (STATE_3_TRIAGE): atención de excepciones y condiciones definidas por el prototipo.
6. Cierre (STATE_4_CLOSED): registro del cierre y consulta posterior.

Los estados y transiciones existentes permiten explorar la experiencia y su lógica, pero no prueban que el proceso completo se ejecute automáticamente ni que sus controles sean adecuados para un caso real. Las reglas actuales no constituyen una máquina de estados judicial completa verificada: se requiere validar transiciones, actores y consecuencias.

## 5. Módulos principales

### 5.1 Cribado A-PACTO y simulación

La pantalla de cribado combina exclusiones, un índice ponderado M-ARR y umbrales por grupo de edad declarados en src/types/pacto.ts: 85 para primera infancia, 60 para edad escolar y 45 para adolescencia. evaluateEligibility compara las entradas con esos parámetros y devuelve un resultado de elegibilidad.

También existe una simulación Monte Carlo con 10,000 iteraciones por defecto y semilla 2026. Utiliza distribuciones y parámetros definidos en el propio código para variables como adopción, fallas, reducción de traslados y riesgo legal.

Interpretación correcta: son cálculos y escenarios de prototipo. Los umbrales, las ponderaciones y las distribuciones no se presentan aquí como criterios judiciales, clínicos o estadísticos validados. Una evaluación real requeriría fundamentos, revisión multidisciplinaria y evidencia independiente.

### 5.2 Portal de convivencia

FsmPortalView.tsx reúne acciones asociadas al flujo por estados, captura o actualización de datos, eventos, comunicación y funciones experimentales de imagen. El proyecto incluye una pantalla de lectura de QR y generación gráfica de códigos.

El texto de la interfaz describe una verificación óptica local; sin embargo, handleOpticalOnboarding espera 450 ms y marca tviVerified como verdadero. No implementa en ese paso extracción facial, cotejo biométrico ni prueba de conocimiento cero. El resultado mostrado debe tratarse como simulación.

### 5.3 Monitoreo, retorno y triage

El código incluye:

· Cálculo de distancia mediante Haversine.
· Una regla A-RPA que compara el tiempo restante con un tiempo estimado de traslado y un margen de resguardo.
· Controles para simular pérdida de GPS, intentos de chat y fallas de prueba de vida.
· Evaluación de cuatro condiciones para habilitar una activación manual de PRC.

El tiempo de tráfico aparece como un valor editable en la interfaz; no se identificó una conexión a un proveedor de tráfico en ese flujo. Tampoco se verificó una recepción de telemetría continua de dispositivos. El texto de despacho a C5 representa una acción del prototipo y un registro asociado; no debe interpretarse como evidencia de un enlace operativo real con servicios de emergencia.

### 5.4 Bóveda y línea de tiempo

La vista J-PACTO permite seleccionar una convivencia, introducir una K-JUEZ y consultar eventos clasificados por categorías. La aplicación guarda kJuez como campo de la convivencia y la compara en el cliente. Esto es una compuerta de interfaz: no demuestra cifrado de extremo a extremo ni una bóveda judicial cifrada.

La pantalla de integridad genera un SHA-256 a partir de algunos datos generales y el número de eventos, y muestra un mensaje de integridad. No recalcula y compara individualmente el contenido y la cadena de todos los eventos contra una referencia confiable: por ello el mensaje no demuestra ausencia de alteraciones.

### 5.5 Workspace y notaría CSG

WorkspaceCaseNotaryView.tsx incorpora operaciones con Google Tasks, Google Docs y Google Drive, sujetas al consentimiento y permisos de la cuenta. El token de acceso de Workspace se mantiene en memoria de la aplicación.

src/lib/csgNotary.ts contiene una implementación en navegador de sellos compatibles con el esquema denominado csg-sello-v1: canonicalización, SHA3-256, firmas Ed25519 y funciones de verificación. La sesión genera sus claves en memoria: los sellos pueden registrarse en Firestore.

La verificación de firma demuestra la correspondencia con la clave pública incluida, no que esa clave pertenezca a una autoridad confiable. La comparación del contenido y del hash anterior solo se hace si se suministran esos valores al verificador. Para uso institucional se necesita una cadena de confianza de claves, custodia, verificación independiente, control de identidad y un análisis específico de compatibilidad e interoperabilidad con la implementación CSG que se pretenda usar. La presencia de este código no prueba una integración con un servicio CSG independiente.

### 5.6 Incidencias y auditoría

El proyecto contiene creación de incidencias, estados de atención y registros de auditoría en Firestore. Las reglas prohíben actualizar o borrar documentos de logs_auditoria desde el cliente sujeto a esas reglas; de forma semejante restringen modificaciones de ciertos eventos y notarías.

Eso es una política append-only en reglas, no una garantía absoluta de inmutabilidad frente a administradores de infraestructura o cambios de reglas. Además, el control denominado «Verificar Cadena Merkle WORM» comprueba longitudes de campos de hash, no reconstruye ni verifica una cadena Merkle. El currentHash se calcula con Date.now(), pero ese valor exacto no se guarda como campo para permitir una recomputación directa equivalente. La pantalla, por tanto, no prueba por sí sola la integridad completa ni la ausencia de borrados.

## 6. Imagen contextual y privacidad

En el flujo de imagen, el navegador carga una imagen, la reduce y aplica un desenfoque de 36 píxeles en un canvas. Después llama a encryptInRamAesGcm, que crea una clave efímera y devuelve datos de resumen del cifrado. La solicitud HTTP posterior envía el JPEG desenfocado en base64, no el ciphertext generado por esa función. El servidor lo envía a la API de Gemini para obtener un análisis contextual.

Consecuencias importantes:

· El desenfoque no demuestra por sí solo anonimización irreversible ni ausencia de personas reconocibles.
· La clave efímera y el resumen AES no implementan una custodia cifrada ni cifrado de extremo a extremo de ese envío. La protección en tránsito depende de la configuración de HTTPS del despliegue.
· El servidor confía en que la imagen recibida ya fue desenfocada: la ruta no lo comprueba de manera independiente.
· Hay una llamada a un proveedor externo; esto no equivale a procesamiento exclusivamente local ni a ausencia de servicios de terceros.
· El servidor usa el identificador de modelo gemini-4-hydrogen; su disponibilidad y comportamiento no fueron verificados.
· POST /api/analyze-context no contiene autenticación o autorización explícitas en server.ts; deben añadirse controles apropiados antes de exponerlo.

No se deben cargar fotografías, expedientes ni datos de niñas, niños o familias reales para probar este prototipo sin un entorno autorizado, análisis jurídico y medidas de seguridad verificadas.

## 7. Operación sin conexión

La aplicación incorpora un service worker con Workbox y una caché local en IndexedDB. Hay código para conservar sesiones e incidencias consultadas y encolar reportes cuando se pierde la conexión. Al volver en línea, la ventana de la aplicación intenta sincronizarlos; el service worker también puede avisar a ventanas abiertas mediante Background Sync cuando el navegador lo admite.

Esto no garantiza sincronización cuando la aplicación está completamente cerrada, ni disponibilidad, confidencialidad o borrado seguro en todos los navegadores. La caché persistente de Firestore y la propia base IndexedDB implican datos locales, por lo que no es correcto describir el sistema actual como «sin rastros locales».

## 8. Arquitectura y tecnologías

```text
Navegador / PWA
├─ React + TypeScript: vistas y flujos
├─ Web Crypto / noble: hashes, operaciones AES y sellos de demostración
├─ IndexedDB + Firestore local cache: datos y pendientes locales
├─ Firebase Authentication + Cloud Firestore
├─ Google Tasks / Docs / Drive: acceso directo con OAuth
└─ POST /api/analyze-context
   ↓
Express + Gemini API
```

Dependencias principales: React 19, Vite 8, Firebase, Express 4, Tailwind CSS 4, Workbox/Vite PWA, @google/genai, @noble/ed25519, @noble/hashes, qrcode y jsqr. Las versiones exactas dependen del archivo de bloqueo y de la instalación utilizada.

## 9. Estructura del repositorio

```text
.
├── .env.example # Variables de ejemplo
├── package.json # Dependencias y scripts
├── bun.lock # Archivo de bloqueo de Bun
├── server.ts # Express, health y análisis contextual
├── vite.config.ts # Vite y configuración PWA
├── firebase-applet-config.json # Configuración cliente Firebase
├── firebase-blueprint.json # Modelo/configuración declarativa
├── firestore.rules # Reglas de acceso y validación
├── firestore.rules.test.ts # Matriz declarativa de 12 escenarios
├── security_spec.md # Especificación y escenarios de seguridad
├── public/ # Íconos, documentos y otros recursos
├── src/
│   ├── App.tsx # Autenticación, perfiles y navegación
│   ├── components/ # Vistas, escáner e incidencias
│   ├── hooks/ # Conectividad e instalación PWA
│   ├── lib/
│   │   ├── pactoAlgorithms.ts # Cálculos y simulación
│   │   ├── pactoStore.ts # Operaciones Firestore
│   │   ├── csgNotary.ts # Sellado y verificación local
│   │   ├── firebase.ts # Inicialización Firebase
│   │   ├── googleWorkspaceApi.ts # Cliente Tasks/Docs/Drive
│   │   ├── workspaceAuth.ts # OAuth y token en memoria
│   │   └── offlineCache.ts # IndexedDB y cola local
│   ├── types/pacto.ts # Tipos, estados y parámetros
│   └── sw.ts # Service worker
```

Revisión de recursos: public/assets/aistudio/ incluye varios PDF y un archivo de audio cuyo nombre no parece relacionado con PACTO. Los archivos bajo public/ pueden distribuirse con la aplicación; conviene revisar su contenido, derechos y pertinencia antes de publicar o desplegar el prototipo.

## 10. Instalación y ejecución local

Estos comandos se derivan de los archivos del proyecto; la instalación y compilación no fueron completadas durante esta revisión. Pueden requerir ajustes en el entorno y configuración adicional de Firebase/Google. No uses datos reales en pruebas.

Requisitos

· Un entorno con Bun o con Node.js y npm compatibles con las dependencias instaladas. El repositorio no declara una versión mínima en engines; comprueba los requisitos de Vite y del resto de dependencias en la instalación elegida.
· Acceso a una configuración Firebase propia de prueba, con Authentication/Google y Firestore habilitados.
· Para la integración de Workspace, APIs habilitadas, cliente OAuth, dominios autorizados y permisos acordes con el entorno de prueba.
· Para el análisis contextual, una clave de Gemini válida configurada en el servidor y un modelo disponible. Esa integración puede fallar si el modelo configurado no está disponible.

Inicio con Bun

```bash
git clone https://github.com/dcpracmatic-prog/pacto_ui-ux.git
cd pacto_ui-ux
bun install
cp .env.example .env
bun run dev
```

El repositorio es privado: la clonación requiere autorización de GitHub. El servidor usa el puerto 3000 por defecto, o el valor de PORT si está configurado. Abre http://localhost:3000.

Si prefieres npm, el proyecto también declara scripts compatibles con npm (npm install, npm run dev), pero no incluye package-lock.json; la resolución resultante puede diferir de la instalación con bun.lock.

Variables y servicios

>``
Variable Uso observado
GEMINI_API_KEY Clave usada por el servidor para solicitar el análisis contextual de imagen. Configúrala solo en el entorno servidor; no la publiques.
APP_URL Figura en .env.example, pero en el código revisado no se observó su uso operativo.
PORT Puerto de Express; si no se establece, usa 3000.
NODE_ENV Selecciona middleware Vite fuera de producción o archivos estáticos de dist en producción.
DISABLE_HMR Permite desactivar HMR en la configuración de Vite.
>``
La configuración cliente Firebase está en firebase-applet-config.json: apunta actualmente a un proyecto concreto. Para una instalación independiente, sustitúyela por la configuración del entorno autorizado y revisa reglas, índices, acceso y dominios. No apuntes pruebas a una base productiva existente.

Scripts disponibles
```
Comando Acción declarada
bun run dev Ejecuta tsx server.ts, con Express y Vite en modo de desarrollo.
bun run build Ejecuta vite build para generar los recursos de la PWA.
bun run preview Sirve la compilación con vite preview; no equivale necesariamente al servidor Express y sus rutas API.
bun run lint Ejecuta tsc --noEmit: comprobación de tipos, no ESLint.
bun run clean Elimina dist y server.js.
bun run start Ejecuta node server.ts; no se verificó su compatibilidad en el entorno de ejecución. No debe asumirse como despliegue de producción probado.
```
El build definido solo invoca Vite; no declara una compilación separada de server.ts. Antes de publicar, define y prueba expresamente el empaquetado y arranque del servidor, además del proxy, HTTPS y controles de acceso.

Rutas del servidor
```
· GET /api/health: devuelve estado básico del proceso Express; no verifica Firebase ni servicios externos.
· POST /api/analyze-context: recibe imagen base64 y metadatos para pedir un análisis a Gemini. Requiere clave y conexión externa; no tiene autenticación explícita en el archivo revisado.
```
## 11. Pruebas y validación

security_spec.md describe doce escenarios adversariales. firestore.rules.test.ts contiene un arreglo declarativo con esos escenarios y sus resultados esperados; no es por sí mismo una suite que ejecute las reglas ni demuestra que hayan pasado. En package.json no se declara un script test para ejecutar esa matriz.

Antes de tratar el sistema como piloto operativo, se recomienda:

```
1. Implementar y ejecutar pruebas automatizadas de reglas con el emulador Firestore, incluyendo lecturas, consultas, escrituras, restricciones por sede, roles y casos cerrados.
2. Probar los flujos de varios usuarios con cuentas distintas: creación judicial del expediente, asignación a cada parte, acceso por folio y revocación. La consulta de sesiones de usuarios no privilegiados filtra por ownerId; crear un expediente como juez no demuestra que las otras partes puedan acceder con sus propias cuentas.
3. Construir y probar una verificación reproducible de la cadena de auditoría y de cada evento, con datos completos, orden y referencias confiables: ensayar alteraciones, eliminaciones y concurrencia.
4. Revisar el aislamiento real de S-ADMIN y juez, incluyendo el hecho de que K-JUEZ se almacena en el documento de convivencia y se compara en el cliente.
5. Implementar controles de autenticación, autorización, límites de uso y validación del contenido para la API de imagen, evaluar el flujo de datos y el proveedor externo.
6. Validar accesibilidad, experiencia en dispositivos móviles, pérdida de conexión, sincronización y borrado local con dispositivos y navegadores reales.
7. Revisar legalidad, proporcionalidad y seguridad infantil de cualquier geolocalización, captura multimedia, clasificación o alerta, y establecer supervisión y posibilidad de revisión humana.
8. Realizar auditoría de seguridad y privacidad independiente antes de procesar información sensible. Ninguna captura de pantalla o resultado simulado sustituye esa validación.
>
```
## 12. Relación con la propuesta conceptual

La presentación compartida describe una arquitectura institucional con roles, supervisión proporcional por arquetipo, trazabilidad, privacidad, eventual integración de emergencias y una adopción gradual. También plantea soberanía tecnológica y un posible modelo de compra pública de innovación.

Este repositorio aporta un prototipo para explorar parte de esos flujos. No demuestra por sí solo una app Android nativa, monitoreo GPS continuo confiable, geocercas operativas, audio en tiempo real, enlace real con C5, custodia institucional soberana, cero conocimiento criptográfico, ni una reducción medida del rezago o de costos. El perfil de riesgo alto del documento se presenta como fase 2, no como capacidad acreditada de este repositorio.

Una implementación institucional requeriría definir formalmente jurisdicción, responsabilidades, gobernanza de datos, infraestructura, contratación, controles técnicos y evaluación con evidencia. La propiedad de un eventual desarrollo y la titularidad de los datos dependerían de los acuerdos aplicables; no se deducen del prototipo.

## 13. Estado de la revisión y licencia

Este README se preparó con base en la rama main, commit 89faf5bb6e008c71684d6eddb67b07ec3fc6d552, y en la presentación conceptual proporcionada junto con la solicitud. Se inspeccionaron los archivos fuente y de configuración; no se realizaron cambios al repositorio.

No se completó una instalación ni se ejecutaron compilación, pruebas, emulador Firebase o flujos end-to-end durante esta revisión. Las observaciones sobre seguridad describen lo que se ve en el código, no sustituyen una auditoría integral.

No se identificó un archivo LICENSE en el árbol revisado. La disponibilidad del código en un repositorio no equivale a una licencia abierta: consulta al titular para conocer los permisos de uso, modificación y distribución.
