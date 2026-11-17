# Arquitectura de OVJ App

Fuentes consultadas el 16 de noviembre de 2026. No se ejecutaron benchmarks en Windows en esta investigación. Las comparaciones de rendimiento son hipótesis para medir; no resultados.

## Recomendación para primera versión

Electron 45.3.3 con versión exacta fijada, una sola ventana de HaxBall, renderizado onscreen acelerado por Chromium y menús/ajustes fuera del camino de entrada del juego. Elijo esta primera base por poder repetir pruebas con la misma versión del motor y por su soporte mantenido del conjunto web que usa HaxBall. No hay evidencia de que Electron tenga menor input lag que Chrome, Edge o WebView2. Debe conservarse la posibilidad de cambiar a WebView2 si las mediciones reales muestran mejores resultados.

La página remota no recibe acceso a Node, al sistema de archivos ni al IPC de configuración. El proceso principal gestiona preferencias validadas y persistentes, ventanas, permisos, importación de imágenes y presencia de Discord. El renderer de HaxBall mantiene su bucle de entrada, red y simulación original. No se retransmiten ni automatizan las entradas de movimiento y disparo. Solo se interceptan los atajos explícitos de configuración, pantalla completa y recarga. No se agregan macros, modificaciones de WebRTC ni un bucle de render paralelo.

## Componentes y comunicación

- **Proceso principal:** crea ventanas, administra el ciclo de vida, valida y guarda preferencias, importa imágenes, coordina Discord y autoriza operaciones externas. No procesa movimientos ni disparos del jugador.
- **Ventana del juego:** muestra la página HTTPS oficial de HaxBall mediante el motor incluido. No carga un preload de OVJ App ni recibe un puente a Node o APIs privilegiadas. El juego conserva entrada, audio, autenticación, red y simulación propios.
- **Ventana local de configuración:** interfaz de ajustes con preload aislado y una API mínima. Sus solicitudes IPC deben provenir del frame principal de esa ventana y superar validación de tipo y rango en el proceso principal. Cerrar ajustes devuelve el foco al juego.
- **Presencia de Discord:** funciona en el proceso principal a través del mecanismo de IPC local de Discord y un Application ID propio. Publica estado de sesión de la app; no deduce nombre de sala, resultado ni jugadores sin una fuente fiable y permitida. No consulta datos por cuadro.
- **Adaptador visual de pelota:** función opcional y deshabilitada en modo competitivo. Requiere una versión exacta reconocida del renderer de HaxBall; aplica una sustitución literal en memoria al dibujo de la pelota. Los bytes deben verificarse por SHA-256 antes de cualquier cambio. Ante una versión desconocida conserva el renderer original. El reenvío HTTPS se instala solo mientras hay un diseño efectivo y se retira al desactivarlo; usa la sesión original y entrega los redirects a Chromium. Volver al modo competitivo tras haber cargado un adaptador requiere recargar para retirar ese código visual de memoria. No distribuye una copia del JavaScript del juego ni cambia estado físico, entradas o paquetes.
- **Diagnóstico y distribución:** pruebas locales automatizadas para validación/persistencia e integración de componentes, un colector de intervalos requestAnimationFrame opcional sin puente privilegiado en el juego, un protocolo reproducible de benchmarks en Windows y empaquetado sin privilegios de administrador. Una prueba unitaria no demuestra compatibilidad completa con una sala ni menor latencia.

La identidad de OVJ usa negro, blanco y gris en los ajustes y en el HTML del juego. Un tema CSS propio se instala al terminar de cargar un documento oficial; no modifica posiciones, controles, colores de equipo ni los píxeles del canvas. No agrega trabajo JavaScript por fotograma. El escudo se lee del archivo original para mostrarlo en los ajustes y se convierte a ICO para Windows.

Cada ventana tiene un origen y una responsabilidad definidos. La interfaz privilegiada local no se carga dentro de la página del juego. La personalización visual aumenta el costo de dibujo respecto del render original y debe medirse; no se presenta como optimización.

## Comparación objetiva

| Alternativa | Compatibilidad y motor | Latencia local/frame pacing | Memoria/CPU/GPU | Mantenimiento y personalización |
|---|---|---|---|---|
| Electron | Chromium incluido y versionado con la app; WebRTC, Canvas y audio del motor Chromium | Depende de versión del motor, hardware, driver y compositor; no hay ventaja demostrada sobre Chrome | Incluye Node y procesos Chromium; medir suma de procesos y GPU, no solo EXE principal | APIs mantenidas para ciclo de vida, preload aislado y empaquetado; runtime más grande y responsabilidad de actualizarlo |
| Tauri + WebView2 | En Windows usa el runtime WebView2 de Edge/Chromium | No hay evidencia de que el host Rust reduzca la latencia del bucle JavaScript del juego | Ejecutable host normalmente pequeño; runtime compartido sigue teniendo browser, renderer y GPU. No comparar solo tamaño de instalador | Rust/JS; seguridad por capacidades. Evergreen cambia el runtime independientemente de la app; Fixed Version permite fijarlo pero aumenta distribución y trabajo de actualización |
| WebView2 nativo C++/C#/Rust | Mismo runtime WebView2, con control directo del host Windows | El host nativo no sustituye el camino input/simulación/render del motor web | Evita Node, pero no elimina procesos Chromium | Buena opción exclusivamente Windows; más código propio para ventanas, errores, Discord, distribución y puente seguro |
| CEF / Chromium integrado | Chromium embebido; soporte de features depende de build y distribución elegida | Puede ajustarse, pero no hay ventaja por compilar C++; medir onscreen y evitar offscreen por defecto | Runtime Chromium completo y multiproceso; puede omitir algunos servicios, no el costo central del motor | Mayor responsabilidad de integración, actualizaciones, toolchain y distribución; el control extra no demuestra mejor latencia |
| Juego nativo reescrito | Requeriría motor, protocolo, reglas y compatibilidad autorizada del juego | No es comparable con ejecutar la versión oficial | Dependería de una nueva implementación | Fuera de alcance: reescribir el cliente/protocolo pondría en riesgo compatibilidad, autenticación y reglas competitivas |

## Límites técnicos

La cadena relevante es dispositivo/escaneo → entrega del evento por Windows → tarea del renderer → paso de simulación de HaxBall → dibujo/composición → presentación por Windows/driver → scanout del monitor. La app puede evitar trabajo propio que compita por CPU, pero no saltear legítimamente etapas internas del juego ni prometer eliminar DWM o la cola de GPU.

El ping describe un aspecto de la comunicación de red y no mide el tiempo tecla-a-fotón. El FPS tampoco mide ese tiempo: un cliente puede producir más cuadros y presentar información más vieja por colas. A 60 Hz el período nominal de refresco es 16,67 ms; a 240 Hz es 4,17 ms. Estos períodos no equivalen a la latencia total.

`BrowserWindow.setFullScreen(true)` entrega modo pantalla completa del sistema. No garantiza pantalla completa exclusiva de DXGI, bypass del compositor ni menor latencia. `webContents.setFrameRate` corresponde al renderizado offscreen y no es un control general para llevar un canvas a 240 FPS. No debe añadirse offscreen para una app que muestra HaxBall directamente.

La lista de Hz admitidas depende de Windows, pantalla, driver y modo seleccionado. Se conserva requestAnimationFrame del juego y la sincronización estándar del motor. La app no cambia el modo físico del monitor.

## Ajustes legítimos y reversibles

- Aceleración de hardware habilitada por defecto (comportamiento Chromium). Opción de desactivarla solo para diagnosticar problemas de driver; requiere reinicio y puede empeorar consumo/latencia.
- Pantalla completa como preferencia persistente. No se promete exclusive fullscreen.
- Sin overlays o monitorización continua por defecto, sin animaciones de interfaz durante el partido.
- Presencia Discord con frecuencia baja y solo cambios de estado; ninguna consulta por frame.
- Captura de diagnóstico iniciada y detenida explícitamente, con advertencia sobre su costo, duración acotada y exportación local. No consultar performance a 1 kHz ni activar DevTools en partidos.
- Mantener throttling normal cuando la app está oculta por defecto. Si se ofrece impedir throttling, explicarlo como continuidad en segundo plano con mayor consumo; no venderlo como reducción de input lag mientras la ventana ya tiene foco.
- Cerrar ajustes devuelve el foco a HaxBall; atajos no capturan teclas de movimiento/disparo.

## Flags y prácticas a evitar por defecto

No aplicar `--disable-gpu-vsync`, `--disable-frame-rate-limit`, `--disable-gpu`, `--disable-features=...`, `--use-angle=...`, `--in-process-gpu`, límites arbitrarios de procesos o heap, prioridades realtime/high del proceso, cambios del registro o resolución global de timers sin medición y reversión. No usar `--no-sandbox`, `webSecurity:false`, `nodeIntegration:true` ni desactivar aislamiento para ejecutar contenido remoto. No agregar bucles propios de teclado ni sintetizar eventos.

El modo competitivo de esta versión desactiva el adaptador de pelota y el diagnóstico. El tema CSS negro y blanco de los menús permanece activo y se instala una vez por documento, sin modificar el renderer de la cancha. La pantalla completa y la aceleración se configuran por separado; el modo no promete una optimización invisible del motor de HaxBall.

## Fuentes oficiales verificadas

- Electron, rendimiento: https://www.electronjs.org/docs/latest/tutorial/performance — no bloquear el proceso principal o renderer, medir y evitar operaciones innecesarias. HTTP 200.
- Electron, seguridad: https://www.electronjs.org/docs/latest/tutorial/security — aislar contenido remoto y validar navegación/IPC. HTTP 200.
- BrowserWindow: https://www.electronjs.org/docs/latest/api/browser-window — sandbox, nodeIntegration, contextIsolation, backgroundThrottling, fullscreen/offscreen. HTTP 200.
- WebContents: https://www.electronjs.org/docs/latest/api/web-contents — diferencias de APIs onscreen/offscreen. HTTP 200.
- Switches soportados: https://www.electronjs.org/docs/latest/api/command-line-switches — soporte dependiente de versión; no asumir estabilidad de switches Chromium. HTTP 200.
- Ciclo de versiones: https://www.electronjs.org/docs/latest/tutorial/electron-timelines — planificar actualizaciones del motor y volver a validar. HTTP 200.
- Tauri, arquitectura: https://v2.tauri.app/concept/architecture/ — proceso core y WebView del sistema. HTTP 200.
- Tauri, versiones de WebView: https://v2.tauri.app/reference/webview-versions/ — WebView2 en Windows. HTTP 200.
- Microsoft, Evergreen vs Fixed Version: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version — costos y control de versiones. HTTP 200.
- Microsoft, modelo de procesos: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model — browser, renderers, GPU/audio del runtime WebView2. HTTP 200.
- CEF: https://bitbucket.org/chromiumembedded/cef/src/master/README.md — framework para integrar Chromium en otra app. HTTP 200.

Las URL oficiales de HaxBall `/about`, `/html5` y `/play` devolvieron HTTP 403 a este entorno de descarga. No se asume que este bloqueo afecte a navegadores de usuarios ni se desactiva seguridad para eludirlo. La compatibilidad completa con salas y autenticación requiere prueba interactiva del cliente contra el servicio real.

## Versión del motor y mantenimiento

El proyecto fija Electron 45.3.3 y mantiene un lockfile para reproducir la instalación. Fijar una versión facilita comparar resultados; no equivale a congelarla indefinidamente. Antes de cada distribución hay que revisar avisos de seguridad y soporte del runtime, actualizar a un release mantenido cuando corresponda y repetir las comprobaciones de compatibilidad y rendimiento. La versión del navegador y del sistema operativo forma parte de cada resultado de benchmark.

El tamaño de Electron procede principalmente de Chromium, sus recursos y bibliotecas. Reducir archivos de desarrollo, tests y mapas de código en el paquete ayuda a la distribución; eliminar componentes desconocidos del runtime puede romper codecs, WebRTC, autenticación, fuentes o sandbox. Cualquier cifra de tamaño debe tomarse del artefacto construido y distinguir instalador comprimido, aplicación instalada y datos de usuario.

## Estado de la evidencia

La selección de arquitectura está apoyada en las propiedades documentadas de las plataformas. No es una conclusión de benchmarks. No se han medido en esta investigación FPS, uso de recursos, estabilidad de partidas ni latencia tecla-a-fotón en Windows. Las funciones y artefactos deben acompañarse de la lista exacta de pruebas efectivamente ejecutadas, las pendientes y sus limitaciones.
