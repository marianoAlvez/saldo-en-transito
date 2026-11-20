# Decisiones técnicas

Una sola autoridad local decide el disponible. Una escritura condicional con importe entero evita el intervalo entre consultar y reservar. El commit de la billetera agrupa orden, reserva y outbox. Mantener una transacción SQL abierta durante una llamada externa prolongaría los bloqueos y el proveedor seguiría fuera del rollback local.

La decisión se implementa con una máquina de estados de tres valores y movimientos balanceados. La outbox admite entrega repetida. La clave de intento del cliente y la referencia de instrucción del proveedor tienen responsabilidades distintas. El worker y la conciliación convergen por la misma función de resolución idempotente.

JavaScript comparte funciones entre Node y el navegador. SQLite nativo ejerce dos escritores sobre disco y SQLite WASM ejecuta el mismo SQL dentro de cada visita, sin backend público. La billetera y el proveedor usan conexiones y bases independientes. El costo es la serialización de escritores de SQLite. Las pruebas cubren garantías funcionales y persistencia al reabrir un archivo, no rendimiento distribuido.

En un sistema real, varios workers introducen contención y carga. Un arrendamiento de trabajo podría distribuir esa carga, pero no elimina la necesidad de idempotencia externa tras perder una respuesta. Habría que agregar reintentos acotados, alarma por antigüedad, conciliación con extractos y revisión manual.

[Contratos e integridad](05-esquema-backend.md) · [Pruebas ejecutables](../../tests/transfers.test.mjs)
