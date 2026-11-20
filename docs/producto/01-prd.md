# Producto · Saldo en tránsito

El público es una persona que evalúa decisiones de arquitectura backend. Debería poder explicar quién tiene autoridad sobre el disponible y por qué el saldo reservado puede convivir con una salida ya ejecutada afuera.

| Requisito | Evidencia de aceptación |
| --- | --- |
| R1 · Evitar comprometer dos veces el saldo | Con $100, dos órdenes de $80 dejan una única reserva. Con $40 cada una, ambas caben. |
| R2 · Recuperar una orden aceptada | Tras caer antes del envío, el worker lee el registro durable y liquida. |
| R3 · Tratar la incertidumbre | Ante respuesta perdida, hay $80 en el proveedor y $80 reservados hasta conciliar. |
| R4 · Mostrar los dos cierres y la deduplicación | Un rechazo libera una vez. Un reintento con la misma referencia produce una sola salida externa. |
| R5 · Explicar el costo y el error | Cada paso permite comparar el saldo y la salida del diseño elegido con una proyección del alternativo. |

La primera versión utiliza una moneda ficticia y un destinatario de muestra. No requiere cuenta de usuario, credenciales ni acceso a redes de pagos.
