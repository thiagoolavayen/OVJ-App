# Tema blanco y negro de los menús de HaxBall

OVJ aplica una paleta negra, blanca y gris a los menús HTML de HaxBall, además de su propia ventana de configuración. El tema conserva el contenido, los controles, los iconos y la disposición del juego. No agrega un encabezado o un logo encima del partido.

Los colores que comunican información del juego permanecen: equipos rojo/azul, identificadores de administradores y estadios personalizados, avisos del chat, grabación y controles de iniciar/detener. Los píxeles del campo, jugadores y pelota no reciben filtros ni reglas de estilo. El escudo de Ovejeros FC se integra en la identidad de la app a partir del archivo original, de manera independiente de este tema.

## Implementación

`src/game-theme.cjs` contiene CSS propio de OVJ, cuyos selectores se comprobaron contra los recursos públicos actuales:

- `https://www.haxball.com/JPDEx8Ti/__cache_static__/g/game.css`
- `https://www.haxball.com/JPDEx8Ti/s/style.css`

No se distribuyen esos archivos oficiales dentro de OVJ. Se usan selectores de paneles, diálogos y controles, por ejemplo `.dialog`, `.room-view > .container`, `.game-view > .buttons` y `.chatbox-view-contents`. Las propiedades permitidas son únicamente colores, esquema de color y retirada de la imagen decorativa del fondo de página. No se cambian tamaños, posiciones, fuentes, espaciado, visibilidad, interacción, animaciones o reglas de renderizado del juego.

Al terminar de cargar cada documento oficial se añade un único elemento `style`, con el ID `ovj-monochrome-game-theme`. Repetir la instalación no duplica el elemento. El código de instalación también verifica HTTPS, el host oficial y la ausencia de credenciales o puertos alternativos. No expone Node, archivos o IPC al juego.

No hay temporizadores, escuchas de teclado, observadores de mutaciones, interceptación de red, modificaciones de prototipos ni trabajo propio en cada fotograma. El navegador aplica el CSS a los elementos HTML cuando corresponde, como hace con sus hojas de estilo habituales. No se modifica la simulación ni se transforma el JavaScript de HaxBall para aplicar este tema.

## Modo competitivo

El tema de los menús se aplica también en modo competitivo. Ese modo mantiene desactivado el adaptador opcional de imagen de pelota y la captura periódica de métricas. Por tanto, «sin adaptador de pelota» no significa «sin CSS de OVJ»: el tema de los menús continúa instalado una vez por documento, mientras la pelota usa el dibujo oficial.

No se promete una mejora de FPS, ping o latencia por usar esta paleta. Tampoco se garantiza que un reglamento permita toda personalización de interfaz; deben respetarse las reglas de la competición.

## Verificación realizada

Se ejecutaron seis pruebas automatizadas del módulo: propiedades permitidas, exclusión de elementos semánticos, instalación idempotente, restricción de origen, colisión de ID y ausencia de temporizadores, red o acceso nativo.

También se ejecutó Electron 45 en Linux con una **fixture local representativa** y el CSS oficial descargado. Se compararon estilos calculados, geometría y un píxel del canvas antes y después de instalar el tema dos veces:

| Comprobación | Resultado observado |
| --- | --- |
| Geometría de panel, botón normal, botón de equipo y canvas | Idéntica |
| Píxel del canvas | `[20, 120, 40, 255]` antes y después |
| Texto de equipos rojo/azul, administrador y estadio personalizado | Colores originales conservados |
| Fondos de iniciar/detener e indicadores rojo/azul del marcador | Colores originales conservados |
| Fondo de página | Verde original → negro |
| Fondo de botón neutro | Azul original → gris `rgb(41, 41, 41)` |
| Dos instalaciones en el mismo documento | Un elemento `style` |

La prueba usó `--no-sandbox` exclusivamente en el arnés Linux, debido a las restricciones de namespaces del entorno. El código de producción conserva el sandbox. La fixture no fue una sala real y no se generó una captura para presentarla como partido. No se midieron rendimiento, latencia o estabilidad en Windows.

Los selectores de HTML pueden cambiar en futuras versiones de HaxBall. En ese caso algunos controles podrían conservar los colores oficiales hasta revisar la hoja de estilo. El tema no intenta acceder a objetos internos del motor para evitarlo.
