# Datos y contratos

| Almacén | Entidad | Regla |
| --- | --- | --- |
| Billetera | accounts | Identidad y disponible materializado, entero de centavos ≥ 0. |
| Billetera | transfers | Identificador inmutable por intención, cuenta propietaria, clave de cliente, destino, monto y estado. Una clave por cuenta. |
| Billetera | journal | Movimiento inmutable, una cuenta lógica de origen y una de destino por el mismo monto. Una entrada por transferencia y tipo. |
| Billetera | outbox | Cero o una orden de despacho por transferencia, presente hasta resolución terminal. |
| Proveedor | instructions | Una instrucción por referencia externa con destino, monto y resultado consultables. |

`reserve(wallet, {account, key, destination, amount})` devuelve el identificador después del commit. Una repetición válida devuelve el mismo id. Fondos insuficientes o parámetros incompatibles abortan la transacción. La interfaz pública solo usa datos prefijados.

`dispatch` consume una orden pendiente. El proveedor escribe su propia base. Ante respuesta perdida puede haber una instrucción externa liquidada y una transferencia local todavía reservada. `reconcile` pide el resultado por referencia y usa la misma resolución que el worker. En la simulación, solo esos caminos cierran la orden. Un resultado terminal contradictorio genera error para revisión.

El disponible debe coincidir con el saldo reconstruido del diario. Disponible + reservado + salida contabilizada suma el capital inicial, aun cuando la salida externa todavía no coincida con la local. La cuenta de apertura es una condición inicial explícita del ensayo.
