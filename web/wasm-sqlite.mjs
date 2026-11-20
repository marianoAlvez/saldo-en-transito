export function openDb(SQL) {
  const db = new SQL.Database();
  function rows(sql, args = []) {
    const query = db.prepare(sql);
    try {
      query.bind(args);
      const result = [];
      while (query.step()) result.push(query.getAsObject());
      return result;
    } finally {
      query.free();
    }
  }
  return {
    exec: sql => db.exec(sql),
    run(sql, args = []) { db.run(sql, args); return db.getRowsModified(); },
    one: (sql, args) => rows(sql, args)[0],
    all: rows,
    close: () => db.close()
  };
}
