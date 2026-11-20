import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Worker} from "node:worker_threads";
import {once} from "node:events";
import initSqlJs from "sql.js";
import {openDb} from "../src/native-sqlite.mjs";
import {openDb as wasmDb} from "../web/wasm-sqlite.mjs";
import {initWallet, reserve, resolve, statement} from "../src/book.mjs";
import {initRail, dispatch, send, received, reconcile} from "../src/rail.mjs";
import {simulate, cases, amountsInCents} from "../src/cases.mjs";
import {alternativeBalances} from "../src/counterfactual.mjs";

const order = {account: "cuenta-demo", key: "cliente-A", destination: "destino-A", amount: 8000};
function fixture(t) {
  const w = openDb(), r = openDb(); initWallet(w); initRail(r);
  t.after(() => { w.close(); r.close(); });
  return {w,r};
}
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "saldo-lab-"));
  t.after(() => rmSync(dir, {recursive:true, force:true}));
  return name => join(dir, name);
}

test("una clave de cliente representa una sola intención y exige el mismo contenido", t => {
  const {w} = fixture(t), id = reserve(w, order);
  assert.equal(reserve(w, order), id);
  for (const change of [{amount: 3000}, {destination: "destino-B"}]) {
    assert.throws(() => reserve(w, {...order, ...change}), /conflicto/);
  }
  assert.equal(statement(w).entries.length, 1);
});

test("validación de centavos positivos y fondos exactos", t => {
  const {w} = fixture(t);
  for (const amount of [0,-1,6.2,true,NaN,Infinity,Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => reserve(w, {...order, amount}), /inválida/);
  }
  assert.throws(() => reserve(w, {...order, amount:10001}), /insuficiente/);
  reserve(w, {...order, amount:10000});
  assert.equal(statement(w).available, 0);
});

test("fallo de la outbox revierte saldo, intención y asiento juntos", t => {
  const {w} = fixture(t);
  w.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'interrupcion'); END");
  assert.throws(() => reserve(w, order), /interrupcion/);
  assert.deepEqual(statement(w), {available:10000,held:0,booked:0,entries:[],pending:0});
  assert.equal(w.one("SELECT count(*) AS n FROM transfers").n, 0);
});

for (const sameKey of [false,true]) test("dos escritores concurrentes, " + (sameKey ? "misma clave" : "órdenes distintas"), async t => {
  const file = scratch(t)("wallet.sqlite");
  const w = openDb(file); initWallet(w); w.close();
  const gate = new SharedArrayBuffer(4);
  const workers = [0,1].map(i => new Worker(new URL("./race-worker.mjs", import.meta.url), {
    workerData: {file, gate, order:{...order, key: sameKey ? "uno" : "orden-" + i}}
  }));
  const exits = workers.map(worker => once(worker, "exit"));
  const ready = await Promise.all(workers.map(worker => once(worker, "message")));
  assert.ok(ready.every(([message]) => message === "ready"));
  const result = workers.map(worker => once(worker, "message"));
  Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
  const outcomes = (await Promise.all(result)).flat();
  assert.ok((await Promise.all(exits)).every(([code]) => code === 0));
  if (sameKey) assert.ok(outcomes[0].id && outcomes[0].id === outcomes[1].id);
  else {
    assert.equal(outcomes.filter(x => x.id).length, 1);
    assert.equal(outcomes.filter(x => x.error === "saldo insuficiente").length, 1);
  }
  const verify = openDb(file);
  try { assert.equal(statement(verify).held, 8000); assert.equal(statement(verify).pending, 1); }
  finally { verify.close(); }
});

test("reinicio real antes del envío recupera la orden desde disco", t => {
  const path = scratch(t), walletFile = path("wallet.sqlite"), providerFile = path("rail.sqlite");
  const original = openDb(walletFile); initWallet(original); reserve(original, order); original.close();
  const w = openDb(walletFile), r = openDb(providerFile);
  try {
    initRail(r); dispatch(w, r, w.one("SELECT transfer FROM outbox").transfer);
    assert.equal(received(r), 8000); assert.equal(statement(w).pending, 0);
  } finally { w.close(); r.close(); }
});

test("un timeout conserva la reserva y la consulta duplicada liquida una sola vez", t => {
  const {w,r} = fixture(t), id = reserve(w, order);
  assert.equal(reconcile(w, r, id), "unknown");
  assert.equal(dispatch(w, r, id, "lose-reply"), "unknown");
  assert.equal(statement(w).held, 8000); assert.equal(received(r), 8000);
  assert.equal(statement(w).booked, 0); assert.equal(statement(w).pending, 1);
  reconcile(w, r, id); reconcile(w, r, id);
  assert.equal(statement(w).entries.length, 2); assert.equal(statement(w).booked, 8000);
  assert.throws(() => resolve(w, id, "declined"), /contradictorio/);
});

test("un rollback SQL en una base no revierte un commit en otra base", t => {
  const {w,r} = fixture(t);
  const id = reserve(w, order);
  const row = w.one("SELECT * FROM transfers WHERE id=?", [id]);
  w.exec("BEGIN IMMEDIATE");
  w.run("UPDATE accounts SET available=available+1 WHERE id=?", [order.account]);
  send(r, row);
  w.exec("ROLLBACK");
  assert.equal(statement(w).available, 2000);
  assert.equal(received(r), 8000);
});

test("dos entregas externas comparten referencia aunque el worker caiga antes de cerrar SQL", t => {
  const {w,r} = fixture(t), id = reserve(w, order);
  const row = w.one("SELECT * FROM transfers WHERE id=?", [id]);
  send(r, row);
  assert.throws(() => send(r, {...row, amount:200}), /incompatible/);
  dispatch(w, r, id); dispatch(w, r, id);
  assert.equal(received(r), 8000); assert.equal(statement(w).booked, 8000);
  assert.equal(statement(w).pending, 0);
});

test("rechazo confirmado compensa una sola vez y respeta el diario inmutable", t => {
  const {w,r} = fixture(t), id = reserve(w, order);
  assert.throws(() => resolve(w, id, "unknown"), /no definitivo/);
  dispatch(w, r, id, "declined"); reconcile(w, r, id);
  assert.equal(statement(w).available, 10000); assert.equal(statement(w).held, 0);
  assert.deepEqual(statement(w).entries.map(e => e.entry), ["reserve","release"]);
  assert.throws(() => w.exec("DELETE FROM journal"), /immutable/);
  assert.equal(received(r), 0);
});

test("los balances del diseño alternativo exponen el error específico de cada alternativa", () => {
  const expected = {race:[2000,16000],crash:[2000,0],timeout:[10000,8000],decline:[2000,0],repeat:[2000,16000]};
  for (const [name, pair] of Object.entries(expected)) {
    const {available, external} = alternativeBalances(name, name === "decline" ? 2 : 3, 8000);
    assert.deepEqual([available,external], pair);
  }
  assert.deepEqual(alternativeBalances("race",3,4000), {available:2000,external:8000});
});

test("todos los escenarios e importes coinciden en SQLite nativo y WASM y conservan los fondos en cada paso", async () => {
  const SQL = await initSqlJs();
  for (const name of Object.keys(cases)) for (const amount of amountsInCents) {
    const frames = simulate(openDb, name, amount);
    // El driver nativo devuelve filas sin prototipo. Comparamos su contenido de datos.
    assert.deepEqual(simulate(() => wasmDb(SQL), name, amount), structuredClone(frames));
    for (const f of frames) {
      assert.equal(f.available + f.held + f.booked, 10000);
      assert.ok(Math.min(f.available, f.held, f.booked) >= 0);
    }
    const end = frames.at(-1);
    assert.equal(end.booked, end.external); assert.equal(end.held, 0); assert.equal(end.pending, 0);
  }
});
