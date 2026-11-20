// Cada conexión implementa exec(sql), run(sql, args), one(sql, args) y all(sql, args).
export function atomic(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function initWallet(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE accounts (id TEXT PRIMARY KEY, available INTEGER NOT NULL CHECK(available >= 0)) STRICT;
    INSERT INTO accounts VALUES ('cuenta-demo', 10000);
    CREATE TABLE transfers (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), request_key TEXT NOT NULL,
      destination TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0),
      state TEXT NOT NULL CHECK(state IN ('reserved','settled','declined')),
      UNIQUE(account, request_key)
    ) STRICT;
    CREATE TABLE outbox (transfer TEXT PRIMARY KEY REFERENCES transfers(id)) STRICT;
    CREATE TABLE journal (
      seq INTEGER PRIMARY KEY, transfer TEXT NOT NULL REFERENCES transfers(id),
      entry TEXT NOT NULL CHECK(entry IN ('reserve','settle','release')), amount INTEGER NOT NULL CHECK(amount > 0),
      source TEXT NOT NULL, target TEXT NOT NULL, UNIQUE(transfer,entry), CHECK(source <> target)
    ) STRICT;
    CREATE TRIGGER immutable_update BEFORE UPDATE ON journal BEGIN SELECT RAISE(ABORT,'immutable journal'); END;
    CREATE TRIGGER immutable_delete BEFORE DELETE ON journal BEGIN SELECT RAISE(ABORT,'immutable journal'); END;
  `);
}

function journal(db, id, entry, amount, source, target) {
  db.run("INSERT INTO journal(transfer,entry,amount,source,target) VALUES (?,?,?,?,?)",
    [id, entry, amount, source, target]);
}

// Clave elegida por el cliente para repetir la misma orden. El id interno identifica el envío externo.
export function reserve(db, {account, key, destination, amount}) {
  if (![account, key, destination].every(v => typeof v === "string" && v.trim().length > 0) ||
      !Number.isSafeInteger(amount) || amount <= 0) throw new Error("orden inválida");
  return atomic(db, () => {
    const previous = db.one("SELECT * FROM transfers WHERE account=? AND request_key=?", [account, key]);
    if (previous) {
      if (previous.destination !== destination || previous.amount !== amount) throw new Error("clave en conflicto");
      return previous.id;
    }
    const updated = db.run("UPDATE accounts SET available=available-? WHERE id=? AND available>=?",
      [amount, account, amount]);
    if (updated !== 1) throw new Error("saldo insuficiente");
    const id = crypto.randomUUID();
    db.run("INSERT INTO transfers VALUES (?,?,?,?,?,'reserved')", [id, account, key, destination, amount]);
    journal(db, id, "reserve", amount, "disponible", "reservado");
    db.run("INSERT INTO outbox VALUES (?)", [id]);
    return id;
  });
}

// El llamador obtiene un estado terminal del proveedor asociado al id interno.
export function resolve(db, id, result) {
  if (!["settled", "declined"].includes(result)) throw new Error("resultado no definitivo");
  return atomic(db, () => {
    const transfer = db.one("SELECT * FROM transfers WHERE id=?", [id]);
    if (!transfer) throw new Error("orden desconocida");
    if (transfer.state === result) return;
    if (transfer.state !== "reserved") throw new Error("resultado contradictorio");
    if (result === "declined") {
      db.run("UPDATE accounts SET available=available+? WHERE id=?", [transfer.amount, transfer.account]);
      journal(db, id, "release", transfer.amount, "reservado", "disponible");
    } else {
      journal(db, id, "settle", transfer.amount, "reservado", "salida");
    }
    db.run("UPDATE transfers SET state=? WHERE id=?", [result, id]);
    db.run("DELETE FROM outbox WHERE transfer=?", [id]);
  });
}

export function statement(db) {
  const entries = db.all("SELECT entry,amount,source,target FROM journal ORDER BY seq");
  const totals = {disponible: 10000, reservado: 0, salida: 0};
  for (const row of entries) {
    totals[row.source] -= row.amount;
    totals[row.target] += row.amount;
  }
  const available = db.one("SELECT available FROM accounts WHERE id='cuenta-demo'").available;
  if (available !== totals.disponible) throw new Error("diario y disponible no coinciden");
  return {available, held: totals.reservado, booked: totals.salida, entries,
    pending: db.one("SELECT COUNT(*) AS n FROM outbox").n};
}
