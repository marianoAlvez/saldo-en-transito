import {DatabaseSync} from "node:sqlite";

export function openDb(file = ":memory:") {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout=8000; PRAGMA foreign_keys=ON;");
  return {
    exec: sql => db.exec(sql),
    run: (sql, args = []) => db.prepare(sql).run(...args).changes,
    one: (sql, args = []) => db.prepare(sql).get(...args),
    all: (sql, args = []) => db.prepare(sql).all(...args),
    close: () => db.close()
  };
}
