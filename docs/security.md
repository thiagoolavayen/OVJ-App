# Seguridad de OVJ App

OVJ App ejecuta contenido remoto de HaxBall y tiene funciones locales de escritorio. El límite principal es mantener esas dos superficies separadas. Estas decisiones se refieren al proyecto con Electron 45.3.3; las pruebas concretas y el estado del artefacto distribuido deben registrarse por separado.

## Ventana remota del juego

La ventana de HaxBall se crea explícitamente con `sandbox: true`, `nodeIntegration: false`, `contextIsolation: true` y `webSecurity: true`. La ventana remota no carga un preload de OVJ App y no expone un puente de IPC privilegiado a la página. Tampoco se habilita integración Node en workers o subframes. La aplicación de producción no usa `--no-sandbox`, `--disable-web-security`, excepciones de certificados ni otras banderas para rebajar aislamiento. El harness de pruebas local admite una excepción explícita para contenedores Linux sin sandbox utilizable; esa prueba no valida el sandbox de Windows.

La navegación de nivel superior se restringe a HTTPS y a los hosts exactos de HaxBall previstos por la app. La comprobación usa `URL`, host y protocolo completos; una coincidencia de texto como `includes("haxball.com")` aceptaría dominios ajenos. Un cambio de ruta o parámetros de sala dentro del origen permitido sigue sujeto a ese control. Las redirecciones del frame principal y las ventanas emergentes también requieren validación. Una sala de HaxBall abierta desde un popup solicita confirmación antes de reemplazar la sesión actual; otros enlaces HTTP(S) siguen el diálogo para el navegador externo.

Un enlace externo HTTP o HTTPS se abre en el navegador del sistema únicamente después de confirmar su destino. Se rechazan esquemas como `file:`, `javascript:`, `data:`, `shell:` y protocolos de aplicaciones. Ningún argumento arbitrario del renderer se pasa a una línea de comandos. `shell.openExternal` solo recibe una URL analizada y autorizada por el proceso principal. Las ventanas emergentes no obtienen una nueva ventana Electron con privilegios heredados.

El evento `will-download` solo permite archivos con extensión `.hbr2`, `.hbs` o `.txt`, para conservar exportación de repeticiones, estadios y texto. Esas descargas presentan el diálogo de guardado del sistema; no se ejecutan ni se abren automáticamente. Las demás extensiones se bloquean. La extensión es una restricción de guardado y no certifica el contenido del archivo. Los permisos de captura y acceso a medios se deniegan; pantalla completa se autoriza solamente a la ventana y origen previstos del juego. Tanto el manejador de solicitud como el de comprobación de permisos deben aplicar la misma política. Las solicitudes de captura de pantalla tampoco se autorizan implícitamente. WebRTC de datos para la partida no requiere que la app conceda acceso al micrófono o cámara.

La política de navegación anterior se refiere a la navegación principal. HaxBall puede cargar recursos, iframes de autenticación, endpoints y conexiones WebRTC del servicio. Una lista rígida que bloquee toda solicitud distinta del host de la página puede romper esas funciones y no debe confundirse con el control de navegación. La compatibilidad debe comprobarse contra el servicio real sin desactivar la seguridad de Chromium.

## Ventana local de configuración e IPC

Los ajustes se muestran en una ventana local separada, con sandbox, aislamiento de contexto e integración Node desactivada. Solo su preload obtiene una API mínima basada en canales IPC conocidos. No se exponen `ipcRenderer`, `require`, lectura de archivos genérica, ejecución de código ni un método que reciba nombres de canales elegidos por la página.

El proceso principal es la autoridad de cada operación. Antes de leer o modificar ajustes comprueba que el mensaje proviene del `webContents` de configuración esperado y de su frame principal, que su URL corresponde al recurso local autorizado y que los argumentos cumplen el esquema previsto. Un renderer de HaxBall, subframe, ventana cerrada o sitio externo no pasa esa comprobación. Los identificadores de ventana o banderas declaradas por el propio emisor no son una prueba de identidad.

Los valores se validan por tipo, longitud y rango. Las claves desconocidas se descartan al recuperar un archivo almacenado y se rechazan al guardar una solicitud nueva; las inválidas no se reinterpretan mediante coerciones permisivas. La validación ocurre en el proceso principal aunque la interfaz ya valide. La interfaz representa mensajes externos como texto y no los inserta como HTML. La política CSP local restringe scripts y recursos a lo necesario; no se habilita ejecución dinámica para comodidad de desarrollo.

## Archivos e imágenes

La selección de un diseño de pelota usa un diálogo nativo iniciado desde la ventana de ajustes autorizada. El renderer remoto no elige rutas arbitrarias. El proceso principal controla el tamaño del archivo, verifica que decodifique como imagen admitida y limita sus dimensiones antes de crear el recurso de uso interno. No se ejecutan SVG, HTML ni scripts como diseños. Una extensión de archivo por sí sola no prueba su contenido.

Las preferencias y el diseño importado se guardan en la ubicación de datos de la app del usuario actual; la aplicación no requiere administrador para jugar ni modifica registro, drivers, prioridad global o configuración de seguridad. La persistencia debe usar sustitución atómica y permitir recuperación ante un archivo inválido. No se guardan contraseñas por cuenta de OVJ App. El perfil Chromium puede conservar cookies y almacenamiento que HaxBall necesite, sujetos a su propio funcionamiento.

El logo oficial de Ovejeros FC proviene del archivo aportado por el usuario. No se sustituye por un recurso de Internet ni por un emblema inventado. La conversión a formatos de distribución no autoriza alterar el diseño.

## Personalización de pelota

La personalización es una modificación visual local optativa. El modo competitivo la desactiva. Al iniciar en modo competitivo no se instala el interceptor de recursos ni el adaptador de pelota. El tema negro y blanco de los menús sí se instala una vez por documento, mediante un único elemento style sin acceso nativo, observadores ni temporizadores. Solo cambia colores de HTML; conserva geometría, píxeles del canvas y colores informativos de equipos y estados. Si el usuario vuelve al modo competitivo después de cargar el adaptador, la imagen se desactiva inmediatamente y la interfaz solicita recargar para retirar también el código visual ya cargado. Una versión desconocida del juego conserva el renderer original sin modificaciones. No altera físicas, radio de colisión, velocidad, timestep, sincronización, entradas, autenticación ni paquetes. Esa separación técnica no constituye una aprobación de las reglas de una liga; se utiliza el modo competitivo sin adaptador para partidos que exijan cliente original.

El adaptador requiere un SHA-256 conocido del JavaScript oficial recibido y una coincidencia literal única del fragmento de dibujo esperado. Debe verificar ambos antes de reemplazar; cero coincidencias, coincidencias múltiples o un hash distinto cancelan la modificación. La sustitución se hace en memoria y conserva el recurso original en caso de no reconocerlo. No se distribuye el JavaScript de HaxBall dentro del paquete. No se usan `eval` o sustituciones amplias que modifiquen partes desconocidas del juego. Mientras se habilita un diseño efectivo fuera del modo competitivo, el adaptador reenvía solicitudes HTTPS a través de `session.fetch` de esa misma sesión con `bypassCustomProtocolHandlers: true` y `redirect: "manual"`. Así evita recursión y conserva las respuestas de redirección para que Chromium procese sus destinos. Al desactivar el diseño retira el handler; el inicio competitivo conserva el camino nativo de red. Este reenvío opcional requiere comprobaciones de autenticación y compatibilidad reales, además de los tests del reemplazo de código.

La imagen optimizada se conserva en memoria para evitar lectura de disco por solicitud de recurso. El diagnóstico opcional ejecuta un colector de `requestAnimationFrame` dentro del frame del juego, con duración y cantidad de muestras limitadas, sin exponer Node ni IPC a ese frame. Su método de parada en JavaScript de página no concede capacidades del sistema.

Un hash reconocido identifica bytes examinados; no garantiza que el proveedor no cambie el recurso mañana. Una actualización de HaxBall puede desactivar la función hasta revisar y probar el nuevo renderer. La app debe comunicar ese estado sin inventar que el diseño está aplicado.

## Discord y datos de sesión

La presencia se conecta al Discord local mediante el mecanismo de RPC/IPC correspondiente y un Application ID público. No requiere contraseña, token de usuario ni credenciales de bot. El ID no es un secreto. No se envían cookies, contraseñas, rutas de archivos ni contenido de conversaciones a Discord. Un fallo o ausencia de Discord no debe cerrar ni bloquear el juego.

Las reconexiones son limitadas y se limpian al cerrar. El estado describe apertura y duración de la sesión de OVJ App; no se inventa información de partido. Desactivar la opción elimina la presencia y corta intentos de conexión. Para mostrar el emblema, el dueño de la aplicación Discord debe registrar el asset correspondiente en su portal; adjuntar una imagen al ejecutable no la sube automáticamente a Discord.

## Distribución y actualizaciones

El paquete incluye solo archivos necesarios de la aplicación y dependencias de ejecución. El lockfile permite una instalación repetible; antes de publicar se revisan avisos de seguridad del runtime y dependencias. El desarrollo no agrega un actualizador que descargue y ejecute binarios sin una política de firma y verificación.

Los artefactos sin firma no deben presentarse como firmados o certificados por Microsoft. La firma de código de Windows y una prueba de instalación en Windows son tareas diferentes de compilar o empaquetar en Linux. La lista de pruebas ejecutadas debe dejar claro cuál se realizó. Nunca se desactiva Defender, SmartScreen ni la comprobación TLS para facilitar instalación o conexión.

Los fallos del renderer se manejan permitiendo volver a cargar explícitamente, con un mensaje útil, sin reinicios infinitos que descarten una sesión o alteren el perfil. Los logs deben evitar enlaces completos con datos sensibles, cookies y tokens. La depuración y las herramientas de desarrollo se usan solo de forma explícita; no quedan activas para medir o inspeccionar continuamente una partida.

## Verificaciones que deben mantenerse

- Un mensaje IPC desde la ventana de juego o un subframe de ajustes se rechaza.
- Un esquema, host, redirección o popup no autorizado no navega una ventana privilegiada.
- Cámara, micrófono y captura permanecen bloqueados; las descargas solo admiten las tres extensiones previstas y solicitan destino de guardado.
- Un archivo de preferencias inválido no produce ejecución de código ni coerciones inseguras.
- El adaptador conserva exactamente el juego original ante hash desconocido o coincidencia ambigua.
- El cierre cancela timers, conexiones de Discord y ventanas auxiliares.

Estas verificaciones documentan la intención y guían la revisión; no equivalen a una auditoría independiente ni afirman pruebas que no se hayan ejecutado.

## Referencias

- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/api/browser-window
- https://www.electronjs.org/docs/latest/api/web-contents
- https://www.electronjs.org/docs/latest/api/session
- https://www.electronjs.org/docs/latest/api/shell
