import {openDb} from "./wasm-sqlite.mjs";
import {amountsInCents, cases, simulate} from "./src/cases.mjs";
import {alternativeBalances} from "./src/counterfactual.mjs";

const el = id => document.getElementById(id);
const money = cents => "$" + (cents / 100).toLocaleString("es-AR");
const labels = {reserve: "Reserva", settle: "Liquidación", release: "Liberación"};
for (const [value, item] of Object.entries(cases)) el("case").add(new Option(item.label, value));
for (const cents of amountsInCents) {
  const label = cents === 10000 ? "$100 · Todo el saldo" : money(cents);
  el("amount").add(new Option(label, String(cents / 100)));
}
el("amount").value = "80";
const linkedCase = window.location.hash.slice(1);
el("case").value = Object.hasOwn(cases, linkedCase) ? linkedCase : "timeout";
if (window.location.hostname === "marianoalvez.github.io") {
  el("code-link").href = "https://github.com/marianoAlvez/saldo-en-transito";
}
let frames = [], step = 0;
function render() {
  const row = frames[step], config = cases[el("case").value];
  el("scenario-question").textContent = config.question;
  el("scenario-name").textContent = config.label;
  for (const key of ["available", "held", "external"]) el(key).textContent = money(row[key]);
  el("progress").textContent = "Paso " + (step + 1) + " de " + frames.length;
  el("event").textContent = row.title;
  el("detail").textContent = row.detail;
  let receipt = "Sin instrucciones recibidas";
  if (row.receipts.includes("declined")) receipt = "Rechazo confirmado";
  else if (row.receipts.length === 1) receipt = "1 envío liquidado";
  else if (row.receipts.length > 1) receipt = row.receipts.length + " envíos liquidados";
  el("provider-status").textContent = receipt;
  el("alternative").textContent = config.alternative;
  el("comparison").textContent = row.comparison;
  const alternative = alternativeBalances(el("case").value, step, Number(el("amount").value) * 100);
  el("alt-available").textContent = money(alternative.available);
  el("alt-external").textContent = money(alternative.external);
  el("cost").textContent = config.cost;
  el("prev").disabled = step === 0;
  const actions = {opening: "Reservar fondos", reserve: "Ver el incidente", incident: config.action, closed: "Volver al inicio"};
  el("next").textContent = actions[row.phase] + (row.phase === "closed" ? " ↺" : " →");
  el("outbox").textContent = "Órdenes en la outbox: " + row.pending + " · Salida asentada en la billetera: " + money(row.booked);
  const body = el("entries");
  body.replaceChildren();
  if (!row.entries.length) {
    const cell = body.insertRow().insertCell(); cell.colSpan = 3; cell.textContent = "Sin movimientos de transferencia.";
  }
  for (const entry of row.entries) {
    const tr = body.insertRow();
    for (const value of [labels[entry.entry], entry.source + " → " + entry.target, money(entry.amount)]) tr.insertCell().textContent = value;
  }
}
try {
  if (document.readyState !== "complete") await new Promise(done => window.addEventListener("load", done, {once:true}));
  const SQL = await window.initSqlJs({locateFile: file => "./vendor/" + file});
  function showIncident() {
    frames = simulate(() => openDb(SQL), el("case").value, Number(el("amount").value) * 100);
    step = frames.findIndex(row => row.phase === "incident");
    render();
  }
  showIncident();
  el("case").addEventListener("change", () => {
    history.replaceState(null, "", "#" + el("case").value);
    showIncident();
  });
  window.addEventListener("hashchange", () => {
    const name = window.location.hash.slice(1);
    if (Object.hasOwn(cases, name)) {
      el("case").value = name;
      showIncident();
    }
  });
  el("amount").addEventListener("change", showIncident);
  el("prev").addEventListener("click", () => { step--; render(); });
  el("next").addEventListener("click", () => { step = (step + 1) % frames.length; render(); });
  el("status").hidden = true; el("experiment").hidden = false;
} catch (error) {
  el("status").textContent = "No se pudo iniciar el ensayo. Recargá la página o consultá el repositorio para ejecutarlo localmente.";
  console.error(error);
}
