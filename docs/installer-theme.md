# Instalador de OVJ App

El instalador usa la identidad **OVJ App · Ovejeros FC**, con encabezado blanco, texto negro y paneles grises. La bienvenida es texto nativo; no incluye una imagen decorativa de NSIS, un escudo alternativo ni una reinterpretación del logo. Los controles conservan la navegación por teclado y el comportamiento nativo de Windows. Algunos detalles del sistema, como el foco, los botones o la barra de progreso, pueden seguir el tema/accesibilidad de Windows.

El escudo original se incorpora cuando existe `assets/icon.ico`. Para obtenerlo a partir del archivo PNG original proporcionado por el usuario:

```powershell
npm run branding -- "C:\ruta\al\escudo-original.png"
```

La conversión conserva el PNG en `assets/logo.png` y crea el ICO sin redibujar el escudo. El script NSIS detecta el ICO durante la compilación y lo asigna a `MUI_ICON` y `MUI_UNICON`; así el instalador y su desinstalador usan el mismo archivo oficial. La distribución final con `npm run dist:win` comprueba previamente estos archivos.

Cada tamaño ICO se prepara por separado: los tamaños pequeños aprovechan el lienzo completo conservando las proporciones. Con el original de 105 × 128 px, las entradas de 16 a 128 px se ajustan a su tamaño, y la de 256 px centra el dibujo de 128 px sin ampliarlo. El PNG original se conserva byte por byte, incluida la transparencia y la estrella con sus colores originales.

Para generar el portable y el instalador personalizado juntos:

```powershell
npm run dist:win:preview -- --installer
```

El script detecta ambos archivos originales. Si están presentes y son válidos, conserva los iconos y aplica los metadatos OVJ sin firmar los ejecutables. Si faltan, elimina los iconos incluidos por Electron y NSIS; no incorpora un logo sustituto. Los archivos generados anteriormente no cambian al agregar el escudo: hay que recompilarlos. La salida incluye `preview-build-report.json` con los artefactos, `brandStatus` y los hashes de los archivos de marca utilizados.

Sin `--installer`, se genera únicamente el portable. La opción `--reuse-unpacked` está reservada a una carpeta ya compilada con el código vigente: verifica la versión ASAR y, si hay escudo, los hashes de la compilación anterior. No la uses después de modificar el código o el diseño: ejecutá una compilación completa para incorporar esos cambios.

El instalador personalizado fija el bundle oficial NSIS 3.12 (`toolsets.nsis: 1.2.1`) y finaliza el desinstalador completo con `!uninstfinalize` antes de incorporarlo. Así el desinstalador conserva su propio manifiesto, CRC y recursos aunque el instalador preliminar retire sus iconos. No se debe editar un instalador NSIS antiguo que guarde el desinstalador mediante diferencias contra su cabecera: cambiar los desplazamientos de recursos puede corromper ese desinstalador aunque el CRC exterior y el contenido del programa sigan siendo correctos.

Para inspeccionar el instalador generado, usá 7-Zip 26.06 o una versión compatible con NSIS 3.12. 7-Zip 24.09 puede mostrar `BadCmd` y omitir el desinstalador aunque los archivos estén presentes. La comprobación completa incluye extraer el desinstalador, validar su manifiesto XML `asInvoker`, su CRC y su versión, y comparar los archivos del programa con `win-unpacked` por nombre y SHA256; un `7z t` aislado no cubre esas condiciones.

La identificación de propiedad `.ovj-installation` conserva el token `OVJ-App-Preview-Install-0.1.0` independientemente de la versión del programa. Esto permite actualizar una instalación preliminar 0.1.0 a las siguientes versiones en la misma carpeta. El valor es un marcador de propiedad de la instalación, no la versión mostrada al usuario. La versión visible proviene de `${VERSION}` y de los metadatos del ejecutable.

La instalación es por usuario en `%LOCALAPPDATA%\Programs\OVJ App`. No requiere administrador. El desinstalador elimina únicamente los archivos enumerados al crear el paquete y las carpetas que queden vacías; conserva las preferencias y los datos de HaxBall en APPDATA. Cerrá la aplicación antes de actualizarla.
