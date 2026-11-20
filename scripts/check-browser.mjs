import assert from "node:assert/strict";
import {createPreviewServer} from "./serve.mjs";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";

const incidents = {
  race: {title: /segunda orden/, action: "Enviar las órdenes con reserva", receipt: "Sin instrucciones recibidas"},
  crash: {title: /antes de contactar/, action: "Retomar el envío pendiente", receipt: "Sin instrucciones recibidas"},
  timeout: {title: /se pierde la respuesta/, action: "Consultar al proveedor", receipt: "1 envío liquidado"},
  decline: {title: /confirmó el rechazo/, action: "Liberar la reserva", receipt: "Rechazo confirmado"},
  repeat: {title: /envío ya ejecutado/, action: "Reintentar con la misma referencia", receipt: "1 envío liquidado"}
};

let server;
let url = process.argv[2];
if (!url) {
  server = createPreviewServer();
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  url = "http://127.0.0.1:" + server.address().port + "/";
}
let browser;
try {
  browser = await chromium.launch({executablePath:process.env.CHROME_PATH || undefined});
  for (const width of [1280, 375, 320]) {
    const page = await browser.newPage({viewport:{width,height:900}});
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    await page.locator("#experiment").waitFor({state:"visible"});
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator("#case").inputValue(), "timeout");
    assert.equal(await page.locator(".pattern li").allTextContents().then(items => items.join(" / ")), "Reservar / Enviar / Resolver");
    assert.equal(await page.locator("#amount").inputValue(), "80");
    const amounts = await page.locator("#amount option").evaluateAll(options => options.map(option => Number(option.value)));
    assert.deepEqual(amounts, [40, 60, 80, 90, 100]);
    assert.match(await page.locator('#amount option[value="100"]').textContent(), /Todo el saldo/);
    for (const [name, expected] of Object.entries(incidents)) {
      await page.locator("#case").selectOption(name);
      // Verificar el cambio antes de tocar el importe o avanzar un solo paso.
      assert.match(await page.locator("#event").innerText(), expected.title);
      assert.equal(await page.locator("#progress").innerText(), "Paso 3 de 4");
      assert.equal(await page.locator("#next").innerText(), expected.action + " →");
      assert.equal(await page.locator("#scenario-name").innerText(), await page.locator("#case option:checked").innerText());
      for (const amount of amounts) {
        await page.locator("#amount").selectOption(String(amount));
        assert.match(await page.locator("#event").innerText(), expected.title);
        await page.locator("#prev").click();
        await page.locator("#prev").click();
        assert.equal(await page.locator("#available").textContent(), "$100");
        assert.equal(await page.locator("#prev").isDisabled(), true);
        await page.locator("#next").click();
        assert.equal(await page.locator("#available").textContent(), "$" + (100 - amount));
        assert.equal(await page.locator("#held").textContent(), "$" + amount);
        assert.equal(await page.locator("#external").textContent(), "$0");
        await page.locator("#next").click();
        const event = await page.locator("#event").textContent();
        assert.equal(await page.locator("#provider-status").textContent(), expected.receipt);
        if (name === "race") assert.match(event, 2 * amount <= 100 ? /también cabe/ : /queda afuera/);
        if (name === "crash") assert.match(await page.locator("#outbox").textContent(), /Órdenes en la outbox: 1/);
        if (name === "timeout" || name === "repeat") {
          assert.equal(await page.locator("#held").textContent(), "$" + amount);
          assert.equal(await page.locator("#external").textContent(), "$" + amount);
          assert.match(await page.locator("#outbox").textContent(), /asentada en la billetera: \$0/);
        }
        if (name === "timeout") {
          assert.equal(await page.locator("#alt-available").textContent(), "$100");
          if (amount === 80 && width === 1280 && process.env.DEMO_CAPTURE === "yes") {
            await page.screenshot({path:fileURLToPath(new URL("../linkedin/respuesta-perdida.png",import.meta.url)),fullPage:true});
          }
        }
        await page.getByRole("button", {name:expected.action + " →",exact:true}).click();
        const admittedOrders = name === "race" && 2 * amount <= 100 ? 2 : 1;
        const sent = name === "decline" ? 0 : amount * admittedOrders;
        assert.equal(await page.locator("#available").textContent(), "$" + (100 - sent));
        assert.equal(await page.locator("#external").textContent(), "$" + sent);
        assert.equal(await page.locator("#held").textContent(), "$0");
        assert.equal(await page.locator("#outbox").textContent(), "Órdenes en la outbox: 0 · Salida asentada en la billetera: $" + sent);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.locator("#prev").click();
        await page.locator("#next").click();
        assert.match(await page.locator("#next").textContent(), /Volver al inicio/);
        await page.locator("#next").click();
        assert.equal(await page.locator("#prev").isDisabled(), true);
      }
    }
    await page.goto(new URL("#decline", url).href);
    await page.getByRole("button", {name: "Liberar la reserva →", exact: true}).waitFor();
    assert.equal(await page.locator("#case").inputValue(), "decline");
    assert.deepEqual(errors, []); await page.close();
    console.log("OK · " + width + " px · 25 combinaciones de escenario e importe, incluida la transferencia del saldo completo");
  }
} finally {
  try { await browser?.close(); } finally { if (server) server.close(); }
}
