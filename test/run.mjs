// End-to-end tests in headless Chrome against the built demo (demo-dist/).
//
//   npm run build && npm test
//
// Fixtures are the signed files from the C2PA public test repository
// (https://github.com/c2pa-org/public-testfiles, CC BY-SA 4.0). They are downloaded
// into test/.cache on first run and are NOT committed or redistributed with this
// package. Unsigned and corrupt inputs are generated here.
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ROOT = "demo-dist";
const CACHE = "test/.cache";
const BASE = "https://raw.githubusercontent.com/c2pa-org/public-testfiles/main/legacy/1.4/image/jpeg/";
const SIGNED = [
  "adobe-20220124-C.jpg",
  "adobe-20220124-CA.jpg",
  "adobe-20220124-CAI.jpg",
  "adobe-20220124-CAICA.jpg",
  "adobe-20220124-CACA.jpg",
  "adobe-20220124-CACAICAICICA.jpg",
  "nikon-20221019-building.jpeg",
];

mkdirSync(CACHE, { recursive: true });
for (const f of SIGNED) {
  const p = join(CACHE, f);
  if (!existsSync(p)) {
    const r = await fetch(BASE + f);
    if (!r.ok) throw new Error(`fixture download failed: ${f} ${r.status}`);
    writeFileSync(p, Buffer.from(await r.arrayBuffer()));
  }
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const path = normalize(join(ROOT, url.pathname === "/" ? "index.html" : url.pathname));
  if (!path.startsWith(ROOT) || !existsSync(path)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "Content-Type": MIME[extname(path)] ?? "application/octet-stream" }).end(readFileSync(path));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const requests = [];
const consoleMsgs = [];
page.on("request", (r) => requests.push({ method: r.method(), url: r.url() }));
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) consoleMsgs.push(m.text()); });
page.on("pageerror", (e) => consoleMsgs.push("pageerror " + e.message));
await page.goto(origin, { waitUntil: "networkidle0" });

async function check(name, bytes, type) {
  return page.evaluate(async (b64, type, name) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return await window.__check(new File([bin], name, { type }), type);
  }, Buffer.from(bytes).toString("base64"), type, name);
}

async function generated(mime) {
  return Buffer.from(await page.evaluate(async (mime) => {
    const c = new OffscreenCanvas(96, 64);
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 96, 64);
    grad.addColorStop(0, "#345"); grad.addColorStop(1, "#c96");
    g.fillStyle = grad; g.fillRect(0, 0, 96, 64);
    const blob = await c.convertToBlob({ type: mime });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, mime));
}

const cases = [];
const add = (group, name, expect, run) => cases.push({ group, name, expect, run });

for (const f of SIGNED) {
  add("signed (C2PA public test files)", f, "found", () => check(f, readFileSync(join(CACHE, f)), "image/jpeg"));
}
add("signed, then altered", "adobe-20220124-CA.jpg with bytes changed in the image data", "found, content mismatch", () => {
  const b = Buffer.from(readFileSync(join(CACHE, "adobe-20220124-CA.jpg")));
  for (let i = b.length - 3000; i < b.length - 2990; i++) b[i] ^= 0xff;
  return check("altered.jpg", b, "image/jpeg");
});
for (const m of ["image/png", "image/jpeg", "image/webp"]) {
  add("unsigned (generated in the browser)", `unsigned ${m}`, "none", async () => check("unsigned", await generated(m), m));
}
add("damaged", "adobe-20220124-CA.jpg cut in half", "error or none (anything but a crash)", () =>
  check("cut.jpg", readFileSync(join(CACHE, "adobe-20220124-CA.jpg")).subarray(0, 89000), "image/jpeg"));
add("damaged", "2 KB of random bytes labelled image/jpeg", "error or none", () =>
  check("noise.jpg", Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 7919 + 13) % 251)), "image/jpeg"));
add("damaged", "empty file labelled image/png", "error or none", () => check("empty.png", Buffer.alloc(0), "image/png"));
add("damaged", "text file labelled image/png", "error or none", () => check("text.png", Buffer.from("hello, not an image"), "image/png"));

const rows = [];
let failed = 0;
for (const c of cases) {
  let r;
  try { r = await c.run(); } catch (e) { r = { kind: "THROW", message: String(e) }; }
  const v = r.kind === "found" ? r.credentials.validation : null;
  const summary =
    r.kind === "found"
      ? `found; signer=${r.credentials.signer}; generator=${r.credentials.generator}; ai=${r.credentials.aiDeclaration}; manifests=${r.credentials.manifestCount}; readerState=${v.readerState}; content=${v.contentMatchesSignature ? "matches" : "MISMATCH " + v.contentCodes.join(",")}; signerCodes=${v.signerCodes.join(",") || "-"}`
      : r.kind === "error" ? `error: ${r.message.slice(0, 70)}` : r.kind;
  let ok;
  if (c.expect === "found") ok = r.kind === "found";
  else if (c.expect === "found, content mismatch") ok = r.kind === "found" && !v.contentMatchesSignature;
  else if (c.expect === "none") ok = r.kind === "none";
  else ok = r.kind === "none" || r.kind === "error";
  if (!ok) failed++;
  rows.push({ ...c, run: undefined, result: summary, ok });
}

const nonGet = requests.filter((r) => r.method !== "GET");
const external = requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith("blob:") && !r.url.startsWith("data:"));
const wasmReq = requests.filter((r) => r.url.endsWith("c2pa.wasm"));

console.log("\n" + rows.map((r) => `${r.ok ? "PASS" : "FAIL"}  [${r.group}] ${r.name}\n      expected: ${r.expect}\n      got:      ${r.result}`).join("\n"));
console.log(`\nnetwork: ${requests.length} requests; non-GET: ${nonGet.length}; outside the local server (excluding blob:/data:): ${external.length}; wasm fetches: ${wasmReq.length}`);
console.log(`console errors/warnings: ${consoleMsgs.length}${consoleMsgs.length ? "\n" + consoleMsgs.join("\n") : ""}`);
const netOk = nonGet.length === 0 && external.length === 0 && consoleMsgs.length === 0;
console.log(failed || !netOk ? `\nFAILED (${failed} case failures; network/console clean: ${netOk})` : "\nALL PASSED");

writeFileSync(join(CACHE, "last-run.json"), JSON.stringify({ rows, requests: requests.map((r) => `${r.method} ${r.url.replace(origin, "")}`), consoleMsgs }, null, 1));
await browser.close();
server.close();
process.exit(failed || !netOk ? 1 : 0);
