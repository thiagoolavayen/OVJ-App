# Cómo comparar OVJ App, Chrome y Edge

No se incluyen resultados de rendimiento: no se ha medido una sesión competitiva en Windows. El código y los ensayos automáticos verifican el tratamiento de datos; no demuestran menor latencia que otro cliente. Las comprobaciones en un entorno Linux o virtualizado tampoco sustituyen esta comparación.

## Qué mide cada instrumento

| Métrica | Instrumento | Interpretación y límite |
| --- | --- | --- |
| Intervalos de callbacks `requestAnimationFrame` | Captura opcional del renderer y analizador de este proyecto | Muestra cuándo el navegador entrega callbacks. No demuestra que el juego haya dibujado cada vez ni que el monitor haya presentado el frame. Tampoco mide input lag. |
| Presentación y frame pacing | PresentMon en Windows, con versión y proveedor de métricas registrados | Captura eventos de presentación de los procesos seleccionados. Verificar que se eligieron el renderer/compositor/GPU pertinentes; un evento de presentación no equivale por sí solo a respuesta visible de una tecla. |
| CPU y RAM | Administrador de tareas, Process Explorer o trazas WPR/WPA | Sumar el árbol completo de procesos del cliente. Anotar si RAM significa working set o memoria privada. Comparar la misma definición y cadencia. |
| GPU | Administrador de tareas o trazas gráficas de Windows | Registrar motor de GPU y adaptador. La ocupación no es una medida de latencia. |
| Latencia tecla a fotón | Cámara de alta velocidad y señal de contacto/LED; equipo de medición dedicado cuando esté disponible | Medir desde el cierre eléctrico de la tecla hasta el primer cambio visible definido de antemano. Una filmación del dedo ofrece una referencia menos precisa. La resolución temporal mínima depende de los FPS de la cámara y la exposición. |
| Latencia de red | Estadística que exponga HaxBall, registrada con su definición | No se deduce a partir de FPS, callbacks ni tiempo entre tecla y dibujo. Identificar si es RTT y qué conexión representa. |
| Simulación | Repetición controlada y documentación del juego | El ritmo y la sincronización del motor pertenecen a HaxBall. OVJ no los cambia ni promete eliminarlos. |

Una prueba JavaScript que registra `keydown` y el próximo `requestAnimationFrame` solo observa dos puntos internos. Deja fuera la exploración del teclado, colas previas al evento, composición y scanout del monitor. No debe publicarse como input-to-photon.

## Protocolo reproducible en Windows

1. Registrar Windows y build, CPU, RAM, GPU y driver, monitor, resolución, escala DPI, frecuencia seleccionada en Windows y configuración VRR. Registrar teclado, conexión y tasa de sondeo si se conoce. Usar alimentación estable y el mismo plan de energía.
2. Registrar versiones de Chrome, Edge, OVJ y Chromium de cada cliente. Una versión fija de Electron permite reproducir OVJ, pero no iguala automáticamente su Chromium al de los otros navegadores. Actualizar todos a versiones estables comparables y conservar ese dato.
3. Usar la misma cuenta/identidad permitida, estadio, tamaño de sala, cantidad de jugadores, zoom y tamaño de viewport. Cuando la red impida repetir exactamente una partida, incluir una prueba de replay local equivalente para render y otra de red por separado. No mezclar sus conclusiones.
4. Ejecutar un solo cliente por vez y cerrar programas prescindibles. Mantener Discord, overlays y captura en el mismo estado para los tres. Para medir el cliente base, desactivar Rich Presence, personalización de pelota y diagnóstico; después medir su coste en pasadas aparte. No usar flags experimentales en ninguno.
5. Separar ventana y pantalla completa en condiciones distintas. Mantener la misma configuración de VSync/VRR del driver. La pantalla completa de una ventana de navegador no garantiza modo exclusivo de Windows.
6. Calentar cada cliente durante al menos 2 minutos. Usar segmentos de 5 minutos para la comparación corta, con al menos 5 repeticiones por condición. Aleatorizar el orden de clientes en cada bloque y registrar el orden. No ejecutar siempre OVJ primero o último. Si la temperatura o una actualización cambia las condiciones, repetir el bloque completo y documentarlo.
7. Repetir a 60, 75, 120, 144, 165 y 240 Hz **solo cuando el monitor y Windows permitan realmente cada frecuencia**. No simular una frecuencia con un limitador de callbacks. Registrar los valores medidos y las combinaciones que no se pudieron ensayar.
8. Capturar CPU/RAM/GPU con intervalos iguales y herramientas iguales; conservar trazas originales. Usar PresentMon para el frame pacing presentado. Realizar las capturas de `requestAnimationFrame` en una pasada de diagnóstico aparte o mantener esa misma instrumentación activa en todos los clientes. La propia instrumentación tiene coste.
9. Para estabilidad, realizar sesiones de 2 horas o más. Registrar desconexiones, crashes, recuperación, pérdida de foco, cortes de audio y tendencia de memoria al inicio/final. Hacer una segunda pasada larga con Discord reconectándose y preferencias guardadas. No provocar pruebas de recuperación durante un partido oficial.
10. Publicar mediana y dispersión entre pasadas, además de p50/p95/p99 y máximo dentro de cada captura. Conservar cada captura por separado: concatenarlas oculta variación entre sesiones. Documentar muestras excluidas y motivos definidos antes de ver los resultados; no descartar microcortes por ser desfavorables.

Si OVJ resulta peor, revisar primero aceleración por hardware efectiva, adaptador elegido, errores del proceso GPU, tamaño del viewport, versión de Chromium y coste de las funciones opcionales. Cambiar una variable por vez y repetir bloques. Un descenso de RAM sin mejora de frame pacing no prueba menor input lag.

## CSV y analizador incluido

Desde la raíz del proyecto:

```sh
node tools/analyze-benchmark.cjs ruta/a/captura.csv
node tools/analyze-benchmark.cjs ruta/a/captura.csv --json
```

Formato UTF-8, con este encabezado:

```csv
timestamp_ms,interval_ms,label
```

- `timestamp_ms`: timestamp monotónico proporcionado al callback de `requestAnimationFrame`, en milisegundos.
- `interval_ms`: diferencia con el callback anterior, estrictamente positiva. Omitir el primer callback de una captura, que no tiene anterior. Para el resto, el analizador verifica la diferencia con tolerancia de 0,1 ms por redondeo.
- `label`: columna opcional con una etiqueta descriptiva. Se cuentan las etiquetas, pero **no** se filtra ni agrupa la estadística por etiqueta: usar un archivo por condición. Se admiten campos entre comillas, comas y comillas escapadas.

El analizador rechaza capturas vacías, columnas desconocidas, valores no finitos, timestamps repetidos o decrecientes e intervalos incoherentes. No elimina filas defectuosas silenciosamente. Un CSV de PresentMon usa otras definiciones y columnas: no renombrar sus encabezados para pasarlo por este analizador; analizarlo con las herramientas de PresentMon y conservar su definición de métrica.

Los percentiles usan **nearest-rank**: ordenar `n` intervalos de menor a mayor y tomar la posición `ceil(p × n)` contando desde 1. El máximo se informa por separado: con 100 muestras y un único intervalo lento, p99 puede no incluirlo. Menos de 100 muestras genera una advertencia. La duración cubierta es la suma de intervalos; incluye el intervalo inicial cuya marca anterior no se exporta. `callbacks_per_second` es `n × 1000 / duración_ms`, nunca «FPS mostrados».

El recolector `src/benchmark-collector.cjs` ejecuta JavaScript ordinario en el frame de HaxBall durante 60 segundos, únicamente al solicitar una captura. Su Promise devuelve pares `[timestamp_ms, interval_ms]`; el proceso principal valida y guarda los datos. No expone Node, Electron ni un puente IPC al sitio. La función temporal `window.__ovjStopBenchmark` permite parar la captura; se borra al finalizar. Se cancelan el callback pendiente, el temporizador y el listener de navegación. Un inicio duplicado se rechaza. La captura también termina al recibir `pagehide`, al alcanzar 150.000 muestras o, como límite adicional si se retrasa el temporizador, 10 minutos de timestamps de callbacks. Si el frame se destruye antes de devolver los datos, puede perderse la captura; no se inventan ni recuperan intervalos.

La captura es optativa y se detiene al terminar el diagnóstico. Las preferencias normales de juego no necesitan un contador, overlay ni muestreo periódico. Para obtener el mismo recolector para Chrome y Edge, ejecutá `npm run benchmark:browser --silent`, copiá el código generado y ejecutalo en DevTools seleccionando el contexto del iframe del juego. Al terminar ofrece un CSV. Cerrá DevTools durante la captura y mantené iguales las condiciones en los tres clientes. Inspeccioná el código antes de pegarlo y no omitas las advertencias de seguridad del navegador. No comparar un contador de frames del juego con uno de callbacks del navegador como si fueran la misma métrica.

## Plantilla de registro

Guardar por pasada: fecha; cliente y versiones; hardware/Windows/driver; Hz/resolución/DPI; ventana o pantalla completa; VRR; tamaño de viewport; estadio/sala/replay; red; Discord/skin/diagnóstico; orden de ejecución; warmup; duración; capturas crudas; observaciones. Dejar sin completar las métricas que no se midieron.

No publicar «OVJ es más rápido» sin un conjunto de resultados reproducible y límites de incertidumbre. Si una diferencia es menor que la variación entre pasadas o la resolución del instrumento, el resultado no permite afirmar una mejora.

## Referencias

- [MDN: `requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame): semántica de timestamps, relación con frecuencia de pantalla y suspensión en segundo plano.
- [PresentMon, Intel GameTechDev](https://github.com/GameTechDev/PresentMon): herramientas y documentación de eventos de presentación.
- [Microsoft: Windows Performance Recorder](https://learn.microsoft.com/en-us/windows-hardware/test/wpt/windows-performance-recorder): captura de trazas ETW para análisis con Windows Performance Analyzer.
- [Microsoft: GPUView](https://learn.microsoft.com/en-us/windows-hardware/drivers/display/using-gpuview): análisis de colas y actividad gráfica en Windows.

Las tres primeras referencias se consultaron durante el desarrollo. No se ejecutaron mediciones físicas de entrada ni PresentMon en este entorno.
