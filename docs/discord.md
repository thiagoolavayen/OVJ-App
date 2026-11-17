# Discord Rich Presence

OVJ App incluye un transporte propio del protocolo RPC local documentado por Discord. Se conecta al Discord de escritorio mediante una named pipe en Windows; no usa un bot, no pide credenciales, no modifica Discord y no envía mensajes a otras personas.

Esta implementación **no es el Discord Social SDK actual**. La documentación del protocolo está en el repositorio oficial `discord/discord-rpc`, cuya biblioteca fue deprecada en favor de Game SDK. Discord ahora recomienda Social SDK para nuevas integraciones completas. Mantener RPC local permite una integración de presencia pequeña, sin una biblioteca nativa adicional ni un inicio de sesión OAuth. Su compatibilidad futura depende de que Discord conserve este transporte: debe verificarse con el cliente de escritorio antes de publicar cada versión. Si Discord deja de aceptarlo, el juego sigue funcionando y la presencia queda pendiente de migración.

## Configuración que realiza el responsable del proyecto una vez

1. Abrí [Discord Developer Portal](https://discord.com/developers/applications) con tu cuenta y creá una aplicación llamada **OVJ App**.
2. Copiá el **Application ID** público a la configuración de Discord de OVJ App. No copies el Client Secret ni un token de bot; no se usan.
3. Subí el escudo original de **Ovejeros FC** como imagen de la aplicación y como recurso de Rich Presence. Usá, por ejemplo, la clave `ovj_logo` para ese recurso y configurá esa misma clave en OVJ App.
4. Abrí Discord de escritorio y habilitá el uso compartido de actividad según tus preferencias de privacidad. Activá Rich Presence en OVJ App.
5. Comprobá desde tu perfil, o con otra cuenta autorizada para la prueba, que se muestra la actividad. El nombre «OVJ App» lo decide la aplicación asociada al Application ID en Discord, no una cadena falsificable del cliente.

El nombre y el ID pueden distribuirse con una versión oficial de OVJ App; los jugadores no deberían crear su propia aplicación ni configurar la actividad cada vez. En esta entrega, sin un Application ID proporcionado por el responsable, la conexión queda preparada y se informa que falta el ID. El escudo de Discord requiere su carga en el portal: convertir el icono local a `.ico` no lo publica automáticamente en Discord.

## Comportamiento

- Publica un estado genérico: «HaxBall» y «OVJ App abierto». No inventa el nombre de una sala, marcador, cantidad de jugadores o estado de un partido.
- El tiempo transcurrido comienza cuando se crea la sesión de OVJ App y se conserva tras una reconexión.
- La imagen se solicita solo si se configuró una clave de recurso. Sin ella, no se sustituye el escudo por otro diseño.
- Busca los diez endpoints locales `discord-ipc-0` a `discord-ipc-9`. Si Discord está cerrado, reintenta con esperas crecientes de 15, 30 y hasta 60 segundos. Los temporizadores y el socket no mantienen vivo el proceso de juego por sí solos.
- Envía `SET_ACTIVITY` con `activity: null` al desactivar o cerrar, seguido del cierre del socket. La limpieza espera como máximo 300 ms por conexión; los fallos de Discord no bloquean el cierre indefinidamente.
- Solo informa «Actividad publicada» después de recibir la confirmación de `SET_ACTIVITY`. Un error del servidor o ausencia de respuesta deja el estado como pendiente de reconexión.
- Los mensajes entrantes se limitan a 64 KiB por frame y se descartan las respuestas inválidas. Los datos del usuario incluidos en `READY` no se conservan.
- No solicita capacidades de voz, chat, lista de amigos, invitaciones, OAuth ni acceso a servidores.

## API interna

```js
const { createDiscordPresence } = require('./src/discord.cjs');
const presence = createDiscordPresence({
  enabled: true,
  clientId: 'APPLICATION_ID_PUBLICO',
  assetKey: 'ovj_logo',
  startedAt: Date.now(),
  onStatus: ({ state, detail }) => { /* actualizar ajustes, fuera del juego */ }
});

presence.configure({ enabled: false });
presence.status(); // copia de { state, detail }
await presence.stop(); // cierre final; no se reinicia después de stop()
```

`configure()` admite `enabled`, `clientId` y `assetKey`. Reemplaza una conexión después de retirar la anterior. `startedAt` acepta una fecha, milisegundos o segundos Unix; se envían segundos Unix, como exige RPC. Los estados posibles son `disabled`, `needs-id`, `connecting`, `connected` y `waiting`.

## Verificación realizada y pendiente

`node --test test/discord.test.cjs` ejecuta pruebas de IPC local con un servidor simulado: handshake y framing reales, fragmentación de mensajes, publicación confirmada, ping/pong, eliminación de actividad, Discord ausente, reintentos, límites de mensajes, rechazo de actividad y cambio de ID sin callbacks obsoletos. Estas pruebas verifican el cliente RPC; **no equivalen a una prueba con Discord real**.

Falta validar en Windows con Discord instalado y un Application ID real: actividad visible, escudo cargado, permisos de privacidad, reapertura de Discord, cierre de OVJ App y ausencia de actividad residual. La tarjeta final depende también de la versión y configuración de Discord.

## Fuentes primarias consultadas

- [Protocolo RPC de Rich Presence: Hard Mode, repositorio oficial](https://github.com/discord/discord-rpc/blob/master/documentation/hard-mode.md): `SET_ACTIVITY`, PID, nonce, named pipes, cabecera little endian y envío de cada frame en un solo buffer.
- [Implementación de conexión y handshake del repositorio oficial](https://github.com/discord/discord-rpc/blob/master/src/rpc_connection.cpp): versión 1, opcodes y gestión del transporte.
- [Aviso de deprecación de discord-rpc](https://github.com/discord/discord-rpc#deprecation-notice).
- [Migración de Legacy Game SDK a Discord Social SDK](https://support-dev.discord.com/hc/en-us/articles/30125671534359-Migrating-from-the-Legacy-Game-SDK-to-the-Discord-Social-SDK): recomendación de mantenimiento vigente.
- [Discord Social SDK](https://discord.com/developers/social-sdk): alternativa oficial actual para ampliar la integración.
