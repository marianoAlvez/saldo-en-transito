import {atomic, resolve} from "./book.mjs";

// Base independiente. Representa un riel ficticio cuya referencia es única en todo su alcance.
export function initRail(db) {
  db.exec(`CREATE TABLE instructions (
    ref TEXT PRIMARY KEY, destination TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0),
    outcome TEXT NOT NULL CHECK(outcome IN ('settled','declined'))
  ) STRICT;
  CREATE TABLE activity (
    seq INTEGER PRIMARY KEY, ref TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN ('send','lookup'))
  ) STRICT;`);
}

export function send(rail, order, response = "settled") {
  if (!["settled", "declined", "lose-reply"].includes(response)) throw new Error("modo desconocido");
  const result = atomic(rail, () => {
    rail.run("INSERT INTO activity(ref,operation) VALUES (?,'send')", [order.id]);
    const old = rail.one("SELECT * FROM instructions WHERE ref=?", [order.id]);
    if (old) {
      if (old.amount !== order.amount || old.destination !== order.destination) throw new Error("referencia incompatible");
      return old.outcome;
    }
    const outcome = response === "declined" ? "declined" : "settled";
    rail.run("INSERT INTO instructions VALUES (?,?,?,?)", [order.id, order.destination, order.amount, outcome]);
    return outcome;
  });
  if (response === "lose-reply") return "unknown";
  return result;
}

export function dispatch(wallet, rail, id, response) {
  const order = wallet.one("SELECT t.* FROM transfers t JOIN outbox o ON o.transfer=t.id WHERE t.id=?", [id]);
  if (!order) return;
  // No hay ninguna transacción de la billetera abierta durante esta llamada.
  const result = send(rail, order, response);
  if (result !== "unknown") resolve(wallet, id, result);
  return result;
}

export function reconcile(wallet, rail, id) {
  const receipt = atomic(rail, () => {
    rail.run("INSERT INTO activity(ref,operation) VALUES (?,'lookup')", [id]);
    return rail.one("SELECT outcome FROM instructions WHERE ref=?", [id]);
  });
  if (receipt) resolve(wallet, id, receipt.outcome);
  return receipt?.outcome ?? "unknown";
}

export function received(rail) {
  return rail.one("SELECT COALESCE(SUM(amount),0) AS total FROM instructions WHERE outcome='settled'").total;
}

export function activityCounts(rail) {
  const row = rail.one(`SELECT COUNT(*) FILTER (WHERE operation='send') AS sends,
    COUNT(*) FILTER (WHERE operation='lookup') AS lookups FROM activity`);
  return {sends: row.sends, lookups: row.lookups};
}
