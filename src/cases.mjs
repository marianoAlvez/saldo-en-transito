import {initWallet, reserve, resolve, statement} from "./book.mjs";
import {activityCounts, initRail, dispatch, received, reconcile, send} from "./rail.mjs";

export const amountsInCents = [4000, 6000, 8000, 9000, 10000];

export const cases = {
  race: {
    label: "Dos órdenes simultáneas", alternative: "Enviar antes de reservar",
    question: "Dos transferencias compiten por los mismos $100. ¿Cuáles puede aceptar la billetera?",
    action: "Enviar las órdenes con reserva",
    cost: "Serializar la decisión sobre el saldo puede hacer esperar a otra orden de esa cuenta."
  },
  crash: {
    label: "Caída antes del envío", alternative: "Debitar y dejar el envío en memoria",
    question: "El proceso se detiene después de reservar y antes de enviar. ¿Cómo sabe su reemplazo qué quedó pendiente?",
    action: "Retomar el envío pendiente",
    cost: "Hay que operar un worker y vigilar la antigüedad de las órdenes pendientes."
  },
  timeout: {
    label: "Respuesta perdida", alternative: "Incluir el envío en la transacción SQL",
    question: "El proveedor ya envió la plata y la respuesta se pierde. ¿Cuándo puede cerrar la orden la billetera?",
    action: "Consultar al proveedor",
    cost: "Mientras el proveedor no dé una respuesta verificable, el cliente tiene fondos inmovilizados."
  },
  decline: {
    label: "Rechazo definitivo", alternative: "Registrar el débito como definitivo al aceptar la orden",
    question: "El proveedor confirma que rechazó la transferencia. ¿Cómo vuelve ese dinero al disponible?",
    action: "Liberar la reserva",
    cost: "El diario guarda tanto la reserva como su liberación. El historial crece, pero explica el saldo."
  },
  repeat: {
    label: "Reintento del mismo envío", alternative: "Crear una referencia externa por intento",
    question: "El proceso se reinicia con una orden que ya salió. ¿Cómo evita pagar dos veces al retomarla?",
    action: "Reintentar con la misma referencia",
    cost: "La referencia debe seguir siendo válida en el alcance y durante el plazo de deduplicación del proveedor."
  }
};

export function simulate(open, name, amount = 8000) {
  if (!Object.hasOwn(cases, name)) throw new Error("caso desconocido");
  if (!amountsInCents.includes(amount)) throw new Error("importe fuera del ensayo");
  const wallet = open(), rail = open();
  try {
    initWallet(wallet);
    initRail(rail);
    const order = key => reserve(wallet, {account: "cuenta-demo", destination: "destino-demo", key, amount});
    const frames = [];
    function snapshot(phase, title, detail, comparison) {
      const receipts = rail.all("SELECT outcome FROM instructions ORDER BY ref").map(row => row.outcome);
      frames.push({phase, title, detail, comparison, ...statement(wallet), external: received(rail), receipts, activity: activityCounts(rail)});
    }
    const pesos = n => "$" + n / 100;
    snapshot("opening", "Saldo de apertura", "La cuenta arranca con $100 disponibles. El proveedor todavía no recibió instrucciones.",
      "Ambos diseños parten del mismo saldo.");
    const id = order("orden-A");
    snapshot("reserve", "La billetera reserva " + pesos(amount),
      "Una transacción SQL guarda la orden, mueve el importe a reservado y registra el envío pendiente en la outbox.",
      name === "race" ? "Antes de la reserva, el saldo visible para ambas órdenes podría seguir siendo $100." :
      name === "timeout" ? "Un bloqueo SQL puede ordenar escrituras locales. El proveedor tiene su propia transacción." :
      name === "crash" ? "Si el proceso solo recuerda en memoria que falta enviar, el débito queda sin trabajo recuperable." :
      name === "repeat" ? "Asignar una referencia nueva al reintentar haría que una misma orden pudiera llegar con dos identificadores." :
      "Marcarla como completada ahora adelantaría un resultado que el proveedor todavía no comunicó.");
    if (name === "race") {
      let other;
      try { other = order("orden-B"); } catch (error) {
        if (error.message !== "saldo insuficiente") throw error;
      }
      snapshot("incident", other ? "La segunda orden también cabe" : "La segunda orden queda afuera por falta de saldo",
        "Llegan dos órdenes distintas de " + pesos(amount) + " cada una. La primera deja " + pesos(10000 - amount) +
        (other ? " disponibles, suficientes para reservar la segunda. Ahora ambas esperan su envío." :
        " disponibles. La segunda se rechaza antes de llegar al proveedor."),
        "Si ambas órdenes obtuvieran autorización sobre los mismos $100, el total prometido sería " + pesos(2 * amount) +
        (other ? ". En este caso alcanza." : ". Faltarían " + pesos(2 * amount - 10000) + " para cubrirlo."));
      dispatch(wallet, rail, id);
      if (other) dispatch(wallet, rail, other);
      snapshot("closed", "El proveedor liquida las órdenes admitidas", "Cada orden admitida produce un solo movimiento en el proveedor.",
        other ? "Este importe también cabe dos veces. Probá con $60 o más para ver dónde divergen los resultados." :
        "Confirmar ambas salidas habría comprometido " + pesos(2 * amount - 10000) + " por encima del saldo inicial.");
    } else if (name === "crash") {
      snapshot("incident", "El proceso se detuvo antes de contactar al proveedor",
        "Quedaron " + pesos(amount) + " reservados y $0 enviados. Junto con la reserva se guardó una orden de envío en la base (outbox). El proceso que se reinicie puede recuperarla.",
        "Un débito sin outbox dejaría " + pesos(amount) + " descontados y ninguna instrucción durable para el worker.");
      const pending = wallet.one("SELECT transfer FROM outbox").transfer;
      dispatch(wallet, rail, pending);
      snapshot("closed", "Otro proceso recuperó y envió la orden", "Leyó la orden pendiente en la base, envió " + pesos(amount) + " y registró la liquidación.",
        "Para reparar el débito huérfano habría que reconstruir la intención a partir de otra evidencia.");
    } else if (name === "decline") {
      const instruction = wallet.one("SELECT * FROM transfers WHERE id=?", [id]);
      const rejection = send(rail, instruction, "declined");
      snapshot("incident", "El proveedor confirmó el rechazo",
        "El proveedor registró un rechazo definitivo y envió $0. Los " + pesos(amount) + " siguen reservados hasta que la billetera asiente la liberación.",
        "Si el débito se diera por definitivo al recibir la orden, el cliente seguiría con " + pesos(10000 - amount) + " disponibles.");
      resolve(wallet, id, rejection);
      snapshot("closed", "El disponible vuelve a $100", "Un asiento de liberación devuelve " + pesos(amount) + " al disponible. La reserva original queda en el diario.",
        "Con un débito definitivo sin compensación, la persona habría perdido " + pesos(amount) + " de disponible por un pago que no salió.");
    } else if (name === "timeout") {
      dispatch(wallet, rail, id, "lose-reply");
      snapshot("incident", "El proveedor liquida, pero se pierde la respuesta",
        "El proveedor ya envió " + pesos(amount) + ". La billetera sigue viendo esos mismos " + pesos(amount) +
        " como reservados hasta que confirme el resultado. " +
        (amount === 10000 ? "El disponible queda en $0." : "El cliente puede usar los " + pesos(10000 - amount) + " restantes."),
        "Si SQL hiciera rollback y mostrara $100 disponibles, seguirían existiendo " + pesos(amount) + " enviados afuera.");
      reconcile(wallet, rail, id);
      snapshot("closed", "La consulta confirma que el dinero ya salió",
        "La billetera consultó la referencia original, recibió el comprobante y asentó " + pesos(amount) + " de salida. La consulta no genera otro envío.",
        "Un rollback local habría devuelto el saldo al cliente aunque el proveedor ya pagó.");
    } else {
      const instruction = wallet.one("SELECT * FROM transfers WHERE id=?", [id]);
      send(rail, instruction);
      snapshot("incident", "El proceso reinició con un envío ya ejecutado",
        "El proveedor pagó " + pesos(amount) + ". El proceso se detuvo antes de guardar el resultado en la billetera. Al reiniciar, encuentra la orden pendiente con su referencia original.",
        "Si el reintento llevara otra referencia, el proveedor podría tratarlo como una segunda transferencia.");
      dispatch(wallet, rail, id);
      snapshot("closed", "Dos intentos, un solo envío",
        "El proveedor reconoció la referencia repetida y devolvió el primer comprobante. El total enviado se mantiene en " + pesos(amount) + ".",
        "Con otra referencia, los dos intentos podrían sumar " + pesos(2 * amount) + " enviados por una sola orden.");
    }
    return frames;
  } finally {
    wallet.close();
    rail.close();
  }
}
