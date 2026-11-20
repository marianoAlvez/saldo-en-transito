// Proyecciones contables sobre un calendario fijo, sin llamadas ni procesamiento de pagos.
// La rama correcta obtiene sus cifras de SQLite; estas cifras responden "¿qué pasaría si...?".
export function alternativeBalances(name, step, amount) {
  const capital = 10000;
  const snapshot = {available: capital, external: 0};
  function debitIfCovered() {
    if (snapshot.available >= amount) snapshot.available -= amount;
  }
  function externalReceipt() { snapshot.external += amount; }
  if (step === 0) return snapshot;
  switch (name) {
    case "race": {
      // Las dos decisiones observaron el mismo saldo de apertura.
      const authorizations = [capital >= amount, capital >= amount].filter(Boolean);
      if (step >= 2) authorizations.forEach(externalReceipt);
      if (step >= 3) authorizations.forEach(debitIfCovered);
      break;
    }
    case "crash":
    case "decline":
      debitIfCovered();
      break;
    case "timeout":
      // La escritura local no llegó a commit. El envío remoto sí.
      if (step >= 2) externalReceipt();
      break;
    case "repeat":
      debitIfCovered();
      if (step >= 2) externalReceipt();
      if (step >= 3) externalReceipt();
      break;
    default:
      throw new Error("comparación desconocida");
  }
  return snapshot;
}
