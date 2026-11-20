import {parentPort, workerData} from "node:worker_threads";
import {openDb} from "../src/native-sqlite.mjs";
import {reserve} from "../src/book.mjs";

const db = openDb(workerData.file);
const gate = new Int32Array(workerData.gate);
parentPort.postMessage("ready");
Atomics.wait(gate, 0, 0);
try {
  parentPort.postMessage({id: reserve(db, workerData.order)});
} catch (error) {
  parentPort.postMessage({error: error.message});
} finally { db.close(); }
