// Measures the transfer size of the WebAssembly binary under the compressions a
// static host or CDN would apply. Informational; used for the distribution decision.
import { readFileSync } from "node:fs";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";

const buf = readFileSync("dist/c2pa.wasm");
const fmt = (n) => `${n.toLocaleString("en-US")} B (${(n / 1048576).toFixed(2)} MiB)`;
console.log("raw        ", fmt(buf.length));
console.log("gzip -9    ", fmt(gzipSync(buf, { level: 9 }).length));
console.log("brotli q11 ", fmt(brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length));
