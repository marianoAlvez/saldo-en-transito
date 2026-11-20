import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const root = new URL("../dist/", import.meta.url);
const contentTypes = {
  html: "text/html; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  wasm: "application/wasm",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8"
};

export function createPreviewServer() {
  return createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname.slice(1) || "index.html";
    if (!/^(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+$/.test(path) || path.split("/").includes("..")) {
      response.writeHead(400).end();
      return;
    }
    try {
      const bytes = await readFile(new URL(path, root));
      const contentType = contentTypes[path.split(".").at(-1)] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": contentType }).end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] || 4186);
  createPreviewServer().listen(port, "127.0.0.1", () => {
    console.log("Saldo en tránsito · http://127.0.0.1:" + port + "/");
  });
}
