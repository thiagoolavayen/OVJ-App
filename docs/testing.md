# Estado de verificación · 17 de noviembre de 2026

Versión **0.1.3**: menús visibles de acceso a funciones, activación guiada de la pelota y bloqueo de publicidad. El tema conserva negro, blanco y gris para OVJ y los menús HTML de HaxBall. El escudo original fue recibido en ZIP e incorporado sin cambiar los bytes del PNG. La instalación manual y las partidas en una PC Windows real, la integración de Discord real y la comparación de rendimiento siguen pendientes.

## Pruebas ejecutadas

- `npm test`: **51 pruebas aprobadas**, sin fallos ni omisiones en Linux para los cambios de 0.1.3. Incluyen una regresión del rechazo de IPC por rutas Windows serializadas con ~ o %7E. Cubren configuración y persistencia del bloqueo, recuperación de archivos, límites de IPC y navegación, adaptador de pelota, recolector, análisis CSV, transporte Discord simulado y tema de los menús. Once casos comprueban dominios publicitarios, excepciones de autenticación/juego y la inserción o retirada del estilo del panel publicitario.
- `npm run check`: sintaxis de fuentes, herramientas y pruebas verificada.
- `npm run test:electron`: Electron 45.3.3 en Linux/Xvfb ejecutando un ASAR recién empaquetado de 0.1.3. Comprueba menú nativo visible, navegación y clics reales en formularios, aislamiento, preload e IPC desde ASAR, importación PNG/WebP desde modo torneo con consentimiento, conversión a PNG, resultado asíncrono de decodificación fallida sin anunciar éxito, captura y exportación JSON/CSV, y preferencias e imagen restauradas en un segundo proceso. HaxBall es una fixture offline; no se cuenta como una partida real.
- Bloqueador con Electron nativo: 27 casos contra un protocolo HTTPS local; nueve solicitudes publicitarias canceladas, nueve de juego/autenticación/CAPTCHA/fuentes conservadas y nueve publicitarias permitidas al desactivar el bloqueo. El contador coincide con las cancelaciones. Comprueba también coexistencia con el interceptor opcional de pelota.
- Tema con CSS oficial: comparación de geometría y píxeles antes/después en una fixture local. No cambian paneles, controles ni canvas. Se conservan los colores de equipos, administradores, chat e iniciar/detener. La página cambia a negro y los controles neutros a gris. Dos instalaciones producen un solo elemento style. No es una partida real; ver [tema](game-theme.md).
- Integración de marca y tema: dos lanzamientos de Electron verificaron la inyección automática al terminar de cargar el iframe y la ausencia de Node/IPC en él. Sin archivo de marca el escudo permanece oculto, sin un sustituto. Una copia temporal del código con un PNG sintético comprobó lectura, transporte y decodificación de los mismos bytes en la imagen local. Ese PNG no se incluyó en el proyecto ni se presentó como escudo de Ovejeros.
- Interfaz: colores calculados en escala de grises, contraste de texto/controles y ausencia de desbordamiento a 480 px. Guardados fallidos conservan los borradores. La captura procede de la configuración real de 0.1.3 cargada desde ASAR en Linux, con juego offline para la prueba.
- Adaptador de pelota: prueba controlada del JavaScript real de HaxBall, reconocido por SHA-256. Solo la pelota visible recibe el diseño; otros discos, jugadores y pelotas invisibles no se alteran. El código propietario no se redistribuye. Los tests entregados prueban runtime, validaciones y fallback.
- Conversión del escudo: probada con imagen sintética fuera del proyecto; PNG original idéntico y transparencia conservada en los siete tamaños ICO. No se usa esa imagen como logo.
- `npm audit --omit=dev`: cero vulnerabilidades informadas en esa consulta para dependencias de producción. No equivale a una auditoría del motor Chromium o de la aplicación completa.

## Compilación y verificación del paquete

La versión 0.1.2 se compiló y publicó mediante GitHub Actions en Windows, además de las comprobaciones estáticas realizadas desde Linux. La comprobación de los nuevos artefactos 0.1.3 sigue pendiente al redactar este informe. Los detalles de recursos y payload que siguen corresponden a 0.1.2.

`npm run dist:win:preview -- --installer` genera el programa Windows x64, un portable y un instalador por usuario. El informe `preview-build-report.json` y los checksums de la entrega registran versión, nombres, bytes y hashes de los artefactos. Si están presentes los archivos originales PNG e ICO, conserva el escudo. Si faltan, retira los iconos de Electron y declara `pending-original-assets`.

La verificación estática comprueba:

- Programa interno PE32+ AMD64/x64, subsistema GUI, manifiesto `asInvoker`, nombre OVJ App, compañía Ovejeros FC y versión PE coherente con package.json.
- Contenido ASAR y hashes exactos frente a las fuentes empaquetadas; sin pruebas, herramientas o node_modules dentro de él. Hash de cabecera coherente con `INTEGRITY/ELECTRONASAR`.
- Extracción completa de los payloads de los ejecutables y comparación de nombres y SHA-256 con el runtime original.
- Lanzador portable NSIS PE32 que contiene la aplicación de 64 bits. La plantilla portable usa `CRCCheck off`; se comprueban estructura y hashes, sin afirmar que el CRC esté activado.
- Instalador NSIS 3.12 con CRC activado y válido después de la edición de recursos. Se incorpora un desinstalador completo finalizado previamente, en lugar de un delta ligado al encabezado. Tanto el instalador como el desinstalador extraído tienen manifiesto XML válido, asInvoker y versión 0.1.2.0. Se compararon también los 73 archivos de su payload. La lectura externa se hizo con 7zip 26.06, que reconoce ese formato; 7zip 24.09 no interpretaba el nuevo comando. La instalación es por usuario y el script de desinstalación enumera solo archivos del paquete, preservando APPDATA.

Compilar e inspeccionar estos archivos desde Linux demuestra la existencia e integridad del paquete. No demuestra que una instalación y una partida funcionen en una PC Windows real. Los ejecutables se entregan sin firma configurada.

## Intento contra el servicio real

Se lanzó la aplicación con un perfil temporal y el proxy HTTPS del entorno. La carga de `https://www.haxball.com/play` falló con **ERR_CERT_AUTHORITY_INVALID (-202)** por el certificado del proxy. No se ignoraron certificados ni se cambió la política TLS del producto. La app mostró el fallo y permitió abrir ajustes.

No se llegó a nombre, salas o partida; no se transmitió identidad, se creó una sala ni se envió chat. La presencia de constructores WebRTC/audio en Chromium no acredita una conexión operativa de HaxBall. El bloqueo del entorno no permite concluir cómo funcionará el servicio en Windows normal.

El contenedor no permite usar el sandbox Linux de Chromium. Las pruebas gráficas usaron únicamente en su harness `OVJ_TEST_NO_SANDBOX=1`, que agrega `--no-sandbox` a ese lanzamiento. La aplicación mantiene `app.enableSandbox()` y `sandbox:true`; no agrega la excepción. Las pruebas no certifican el sandbox de Windows.

## Repetir y completar

```powershell
npm ci
npm test
npm run check
npm run test:electron
npm run dist:win:preview -- --installer
```

El smoke usa una fixture local y no contacta Discord real. En Windows no se necesita la excepción Linux. Los archivos originales del escudo son opcionales para esta compilación preliminar; [la distribución con identidad final](build.md) conserva la comprobación de marca.

Pendiente en Windows real: instalar/desinstalar, comprobar iconos y accesos directos, cargar HaxBall y entrar a salas, teclado/foco/audio, repeticiones y estadios, recuperación ante fallos, mapas y diseños de pelota, Discord con Application ID y asset del escudo, y sesiones largas. La comparación contra Chrome/Edge, frecuencias de monitor y tecla-a-fotón se define en [benchmarks](benchmarks.md). No hay evidencia para afirmar superioridad de rendimiento.
