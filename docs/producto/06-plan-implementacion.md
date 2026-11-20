# Entregas y pruebas

| Incremento | Dependencia | Evidencia |
| --- | --- | --- |
| Libro y reserva condicional (R1) | Cuenta y moneda definidas | Dos conexiones independientes compiten. Una sola reserva de $80 sobre $100. |
| Outbox (R2) | Reserva y diario | Un fallo en el INSERT de outbox revierte todo. Cerrar y reabrir la base recupera el envío. |
| Proveedor y conciliación (R3, R4) | Referencia durable y resultado definitivo | Timeout, respuesta duplicada, reintento y rechazo dejan los importes y el número de asientos esperados. |
| Comparaciones interactivas (R5) | Ambas bases y reglas de proyección | Cinco escenarios por cinco importes, incluido el saldo completo de $100, concuerdan entre WASM y SQLite nativo. |
| Entrega pública (R1–R5) | Pruebas y build | GitHub Actions exige pasar el núcleo y el navegador antes de publicar en Pages. |

El primer incremento usa un proveedor ficticio definido en el código. Una integración futura queda condicionada al contrato real de deduplicación y liquidación. Las decisiones pendientes para esa integración no bloquean este ensayo.

[Producto](01-prd.md) · [Pruebas](../../tests/transfers.test.mjs) · [Automatización](../../.github/workflows/demo.yml)
