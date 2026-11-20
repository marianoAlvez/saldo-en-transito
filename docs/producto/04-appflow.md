# Flujo del ensayo

La persona elige una falla y un monto. Ambas bases se crean con capital inicial de $100 y un proveedor sin instrucciones. Cada paso muestra una instantánea que se produjo al ejecutar SQL. La comparación al costado es una proyección del orden alternativo.

| Disparador | Transición observable en la billetera | Efecto externo |
| --- | --- | --- |
| Primera orden válida | Disponible → reservado, outbox pendiente | Ninguno |
| Otra orden | Reserva solo si alcanza el disponible restante | Ninguno hasta despacho |
| Worker se detiene | Reserva y outbox sobreviven | Ninguno si aún no envió |
| Proveedor liquida | Reservado → salida, outbox cerrada | Una salida por referencia |
| Se pierde la respuesta | Sigue reservado, outbox pendiente | Puede haber ocurrido la salida |
| Consulta concluyente o reintento idempotente | Una resolución terminal | No duplica la salida |
| Rechazo definitivo | Reservado → disponible, outbox cerrada | Ninguna salida |

Al elegir escenario o importe, el comprobante abre en el incidente (paso 3 de 4). La acción de cierre depende del caso: enviar las órdenes admitidas, recuperar el envío pendiente, consultar una referencia, liberar la reserva o reintentar con la misma referencia. Desde el cierre se puede volver al saldo de apertura. Retroceder permite recorrer las observaciones previas del ensayo.
