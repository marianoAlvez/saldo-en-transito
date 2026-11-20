import {cp, copyFile, mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
await mkdir("dist/vendor", {recursive: true});
await cp("web", "dist", {recursive: true});
await mkdir("dist/src", {recursive: true});
for (const file of ["book.mjs", "rail.mjs", "cases.mjs", "counterfactual.mjs"]) await copyFile("src/" + file, "dist/src/" + file);
for (const file of ["sql-wasm.js", "sql-wasm.wasm"]) await copyFile("node_modules/sql.js/dist/" + file, "dist/vendor/" + file);
await copyFile("node_modules/sql.js/LICENSE", "dist/vendor/LICENSE-sql.js");
