# Compilación y distribución de OVJ App

## Compilación preliminar disponible

Ya se generó el ejecutable **`OVJ-App-0.1.2-x64-Portable-Preview.exe`**. Contiene el runtime Windows x64 y el código de OVJ App: no necesita Node.js instalado en la PC del jugador. Está sin firma y pendiente de prueba funcional en Windows real.

La compilación usa la interfaz negro y blanco de OVJ y Ovejeros FC. Detecta el PNG y el ICO originales: si existen los conserva; si faltan retira los iconos genéricos sin incorporar otro escudo. Para reproducir el portable y el instalador por usuario:

```powershell
npm ci
npm run dist:win:preview -- --installer
```

La salida queda en `dist-preview`, junto con `preview-build-report.json`. Se generan `OVJ-App-0.1.2-x64-Portable-Preview.exe` y `OVJ-App-0.1.2-x64-Setup-Preview.exe`. El instalador personalizado usa negro, blanco y gris, crea accesos directos y conserva APPDATA al desinstalar; se compila sin Wine. Para el instalador se fija NSIS 3.12 (toolset 1.2.1); el helper de finalización genera el desinstalador completo antes de incorporarlo al paquete. El proceso usa herramientas JavaScript para establecer metadatos OVJ/Ovejeros, retirar únicamente iconos y preservar manifiesto, integridad ASAR y payload NSIS. El lanzador portable es PE32, para poder iniciar normalmente en Windows; el programa que contiene es PE32+ x64. No se presenta el lanzador como una versión de juego de 32 bits.

Los nombres, tamaños y hashes de esta versión figuran en `preview-build-report.json` y en los checksums de la entrega. La carpeta de runtime requiere aproximadamente 358 MiB; el tamaño de extracción puede variar entre versiones. Estas cifras describen distribución y disco, no consumo de RAM.

El comando `dist:win` que sigue más abajo mantiene la comprobación del escudo para una distribución con identidad final. El ID Discord es opcional y ninguno de estos comandos necesita un token.

La distribución principal es Windows x64. Usá Windows 10/11 de 64 bits y Node.js 24 LTS para la compilación. Electron incluye Chromium y Node; no requiere WebView2, un navegador aparte ni permisos de administrador para jugar. La aplicación carga HaxBall desde su origen oficial y requiere conexión.

## Preparar el logo original

El escudo corresponde a **Ovejeros FC**. No se incluyó un logo alternativo. El PNG original de 105 × 128 píxeles recibido en ZIP está incluido en assets/logo.png, sin alteraciones. Un PNG con transparencia de al menos 256 × 256 píxeles permite iconos de buena calidad; conviene conservar un original de 512 o 1024 px para Discord. No se crea detalle nuevo al convertirlo.

Desde la carpeta del proyecto, ejecutá:

```powershell
npm ci
npm run branding -- "C:\ruta\al\escudo-original.png"
```

La herramienta copia los bytes originales a `assets/logo.png` y genera `assets/icon.ico`, con entradas de 16, 24, 32, 48, 64, 128 y 256 px. Conserva proporciones y transparencia; las imágenes rectangulares se centran en un lienzo transparente. Los originales pequeños no se amplían: se agrega lienzo para obtener la entrada ICO de 256 px que necesita Windows. Esto conserva el dibujo pero no mejora su definición. No se inventa ni redibuja el escudo.

Guardá ambos archivos en el repositorio antes de usar el workflow de Windows. El proceso rechaza PNG de más de 8 MiB o 4096 px por lado. La conversión es local; no envía imágenes a servicios externos.

El icono ICO se usa para ejecutable, ventanas, barra de tareas, accesos directos e instalador. Discord necesita además subir el PNG a la aplicación de Discord en el portal de desarrolladores; el icono del ejecutable no se publica allí automáticamente. Consultá [Discord](discord.md).

## Verificar y generar Windows

```powershell
npm test
npm run dist:win
```

`dist:win` debe ejecutar `node tools/set-branding.cjs --check` antes de `electron-builder --win --x64 --publish never`. El comando comprueba los archivos de marca y falla si faltan. No utiliza el icono de Electron como sustituto.

Los archivos esperados, con la versión de `package.json`, son:

- `dist/OVJ-App-0.1.2-x64-Setup.exe`: instalador NSIS para el usuario actual, con acceso directo de escritorio y menú Inicio. Permite seleccionar carpeta sin elevación.
- `dist/OVJ-App-0.1.2-x64-Portable.exe`: ejecutable portable que extrae temporalmente su runtime al iniciarse; no requiere instalación.

La versión inicial es una compilación preliminar para validación. Haber compilado el paquete no prueba conexión a salas, autenticación, audio, Discord ni rendimiento en Windows. Esas verificaciones deben registrarse en una PC real; consultá [metodología de pruebas](benchmarks.md).

El archivo portable no garantiza guardar preferencias junto al `.exe`: la ubicación de datos la determina la aplicación. El instalador conserva los datos del usuario al desinstalar para evitar borrar preferencias y autenticación accidentalmente. Para borrarlos, cerrá la aplicación y eliminá manualmente la carpeta de datos indicada por la aplicación/documentación principal.

## Workflow reproducible

`.github/workflows/windows.yml` usa `windows-latest`, Node 24, `npm ci`, pruebas unitarias, sintaxis, la prueba de ventanas Electron con escenario local y `npm run dist:win`. Se inicia manualmente con `workflow_dispatch` o al subir un tag `v*`. Conserva los `.exe` como artefactos del workflow durante 14 días; **no crea releases ni publica automáticamente**. El archivo `package-lock.json` debe estar incluido en el proyecto para fijar dependencias.

No se ejecutó este workflow contra una cuenta de GitHub desde el entorno actual. Para usarlo, agregá el proyecto y los archivos del escudo original a tu repositorio y ejecutá el workflow. No hacen falta tokens de Discord para compilar.

## Firma, tamaño y mantenimiento

Los paquetes están preparados sin certificado de firma. Windows puede mostrar SmartScreen por falta de reputación/firma. Una versión pública debería firmarse con un certificado válido o servicio de firma bajo control del propietario; no incluyas claves privadas en el código. `publisherName` identifica la marca en la configuración, pero **no equivale a una firma digital** ni garantiza que Windows muestre un editor verificado.

Electron distribuye Chromium completo y será mayor que el ejecutable host de Tauri/WebView2. El tamaño total instalado debe incluir el runtime web, también cuando otra arquitectura lo comparte con el sistema. No se prometen megabytes finales sin generar y medir el artefacto. El empaquetado usa ASAR, compresión máxima y solo `src`, `assets` y metadatos de paquete. No incluye pruebas, herramientas de desarrollo ni una copia de los scripts de HaxBall. Evitá borrar bibliotecas de Chromium para ahorrar espacio: puede romper WebRTC, audio o aceleración.

Electron incorpora software de terceros: conservá los avisos/licencias de Chromium y Electron que agrega su distribución. `electron-builder` y `png-to-ico` se usan para desarrollo/compilación. Revisá los avisos del paquete final antes de publicar.

Fuentes: [electron-builder: Windows](https://www.electron.build/win.html), [NSIS](https://www.electron.build/nsis.html), [distribución Electron](https://www.electronjs.org/docs/latest/tutorial/application-distribution), [png-to-ico](https://github.com/steambap/png-to-ico).
