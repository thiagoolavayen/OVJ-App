# Diseños locales de pelota

Podés importar una imagen desde **Pelota → Personalizar pelota…**, o desde la sección Pelota de los ajustes con F10. Se recorta al centro, como un círculo, dentro del radio que HaxBall ya dibuja. El diseño solo aparece en tu equipo. Los demás jugadores siguen viendo la pelota de su cliente.

El ajuste viene desactivado y el **Modo torneo (pelota original)** mantiene el dibujo oficial. Al elegir una imagen válida, el diálogo de activación permite desactivar ese modo y seleccionar **Guardar para después** o **Aplicar y recargar**. La segunda opción abandona la sala actual; la primera guarda el diseño y muestra un aviso para recargar más tarde. Si el adaptador ya está cargado, una nueva imagen puede aplicarse sin salir de la sala.

Para volver a la pelota oficial, desactivá el diseño o activá el modo torneo. La imagen se retira inmediatamente; si el adaptador estaba cargado, recargá cuando puedas para retirar también su código. Las recargas solicitadas desde OVJ omiten la caché para evitar reutilizar un script anterior al cambio de diseño. El estado de la imagen solo declara que está aplicada cuando el navegador confirma su decodificación.

La imagen se transforma en un PNG estático y acotado. No se ejecuta código de imágenes, no se cargan URLs externas y no se usan diseños animados. El adaptador admite únicamente PNG en una URL de datos, de hasta 1 MiB de texto y dimensiones de hasta 1024×1024; la importación de OVJ usa una imagen menor para evitar trabajo innecesario al dibujar.

## Compatibilidad y alcance

HaxBall no publica una API de diseños de pelota para su cliente web. OVJ implementa un adaptador visual para una compilación concreta, consultada el 16 de noviembre de 2026:

| Dato | Valor |
| --- | --- |
| Script oficial | `https://www.haxball.com/JPDEx8Ti/__cache_static__/g/game-min.js` |
| Compilación | `0349dd60` |
| SHA256 | `322d1904fc09896e5a16482f53e35a6e046c50a40c0270646305700b7420e885` |

Se descargan los bytes públicos del script desde HaxBall al abrir el juego. Solo cuando coincide el SHA256 completo se aplica una transformación pequeña en memoria a dos métodos de dibujo y a su llamada. El proyecto no incluye ni distribuye el código del juego. No se desactivan TLS, CORS o el aislamiento del navegador para hacerlo.

El cambio identifica la pelota por igualdad con el objeto real del disco cero del estado de renderizado. No reconoce la pelota por color, radio o por el primer círculo visible. Esto evita sustituir jugadores u otros discos similares en estadios personalizados. El adaptador conserva el relleno y el borde originales y coloca la imagen entre ambos; mantiene el radio, las coordenadas y la transformación de cámara. Una pelota invisible o de radio negativo conserva su comportamiento original.

No se modifica la simulación, las físicas, la velocidad, los paquetes, la sincronización, la entrada de teclado ni las propiedades de discos de la sala. El diseño no reduce el ping o la latencia. Añade un `drawImage` por pelota visible y fotograma, cuyo coste debe medirse en el equipo del jugador.

Si cambia la ruta, el hash o la estructura esperada del renderizador, OVJ conserva el script original y no instala el adaptador. Será necesario revisar y validar una nueva compilación para volver a disponer del diseño. No hay compatibilidad universal garantizada con futuras versiones de HaxBall.

La posibilidad de usar un diseño local en partidos oficiales depende del reglamento de cada competición. El modo torneo de OVJ usa la pelota oficial y no atribuye una mejora de rendimiento a ese modo.

## API interna del módulo

`src/ball-adapter.cjs` expone:

- `isCandidateUrl(url)`: acepta únicamente el script versionado en HTTPS en un host oficial de HaxBall, sin credenciales ni puertos alternativos.
- `transformGameScript(source, { skinDataUrl })`: recibe texto UTF-8 o `Buffer`; devuelve `{ supported, source, reason, build }`. Un fallo devuelve el contenido original sin instalar código del adaptador.
- `isValidSkinDataUrl(value)`: validación preliminar del tipo, alfabeto base64, longitud, firma PNG y dimensiones. El navegador debe decodificar la imagen correctamente antes de activarla.
- `SUPPORTED_PATH`, `SUPPORTED_SHA256`, `SUPPORTED_BUILD`, límites de imagen y `BALL_RUNTIME_SOURCE` (código propio de OVJ, sin código de HaxBall).

El runtime instala dos funciones del contexto web normal, sin acceso a Node ni a IPC privilegiado:

- `window.__ovjSetBallSkin(dataUrl | null)`: devuelve una promesa booleana. Una nueva selección invalida decodificaciones anteriores; `null` restaura inmediatamente el dibujo original. La imagen se decodifica una sola vez por selección.
- `window.__ovjDrawBall(context, x, y, radius)`: dibuja una imagen ya cargada, recortada por el círculo actual. Restaura el estado del contexto incluso si falla `drawImage`; nunca llama al relleno o al borde del juego.

No hay un parámetro que permita omitir la verificación del hash o aceptar otra compilación en producción.

## Pruebas realizadas y pendientes

Los tests automatizados cubren URLs ajenas, bytes desconocidos, entrada PNG acotada, rechazo de SVG/URLs remotas, recorte, restauración del contexto, geometría inválida, errores de dibujo y carreras de decodificación.

Durante el desarrollo también se verificó, fuera del paquete distribuido, la transformación y sintaxis del script público de 173175 bytes con el hash indicado. Se ejecutó el método de renderizado real transformado en una VM para cinco casos: pelota visible, otro disco de igual radio/color, pelota invisible, radio negativo y jugador. Solo la pelota visible solicitó el diseño. Una alteración de un byte desactivó la transformación.

Estas pruebas no demuestran rendimiento, aprobación reglamentaria ni estabilidad durante partidos en Windows. Quedan por validar visualmente una sala real, varios estadios, las transiciones entre salas y sesiones largas, además de medir el coste con diseño activado y desactivado.

Fuentes oficiales consultadas:

- [Cliente oficial](https://www.haxball.com/play).
- [API del anfitrión sin interfaz](https://github.com/haxball/haxball-issues/wiki/Headless-Host): las propiedades de discos no ofrecen una API de texturas.
- [Formato de estadios](https://github.com/haxball/haxball-issues/wiki/Stadium-(.hbs)-File): `ballPhysics: "disc0"` identifica el primer disco como pelota en estadios que usan esa opción.
