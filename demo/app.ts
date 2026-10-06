import {
  NO_CREDENTIALS_MESSAGE,
  NO_TRUST_CHECK_NOTICE,
  createChecker,
  describeSourceType,
  type CheckResult,
} from "../src/index.js";

const checker = createChecker();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>("file");
const drop = $<HTMLButtonElement>("drop");
const out = $<HTMLDivElement>("out");

// Exposed for the test runner only; it reads nothing on its own.
(window as unknown as { __check: typeof checker.read }).__check = (f, t) => checker.read(f, t);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function row(dl: HTMLElement, k: string, v: string) {
  const r = el("div", undefined, "row");
  r.append(el("dt", k), el("dd", v));
  dl.append(r);
}

function render(file: File, url: string, result: CheckResult) {
  out.replaceChildren();
  const card = el("div", undefined, "card");
  const img = el("img");
  img.src = url;
  img.alt = "The image being checked";
  const body = el("div", undefined, "body");
  body.append(el("div", file.name, "name"));

  if (result.kind === "error") {
    body.append(
      el("h2", "Could not read this file."),
      el("p", `The file may be damaged or in a format the reader does not support. (${result.message})`, "note"),
    );
  } else if (result.kind === "none") {
    body.append(
      el("h2", NO_CREDENTIALS_MESSAGE),
      el(
        "p",
        "Content credentials are often removed when an image is re-encoded, screenshotted or uploaded to a platform. This tool reads credentials; it does not analyse the picture itself.",
        "note",
      ),
    );
  } else {
    const c = result.credentials;
    body.append(el("h2", "Content credentials found."));
    const dl = el("dl");
    row(dl, "Signed by", c.signer ?? "Not stated");
    row(dl, "Generating tool", c.generator ?? "Not stated");
    row(dl, "Declared source", c.sourceTypes.length ? c.sourceTypes.map(describeSourceType).join("; ") : "Not stated");
    row(
      dl,
      "Signed at",
      c.signedAt ? new Date(c.signedAt).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" }) : "Not stated",
    );
    row(dl, "File vs signature", c.validation.contentMatchesSignature ? "Matches what was signed" : "Does not match what was signed");
    row(dl, "Signer check", "Not checked against a trust list");
    body.append(dl);
    if (c.validation.failureCodes.length) {
      const ul = el("ul", undefined, "codes");
      for (const code of c.validation.failureCodes) ul.append(el("li", code));
      body.append(ul);
    }
    body.append(
      el(
        "p",
        `These are statements made by whoever signed the file. ${NO_TRUST_CHECK_NOTICE} “Matches what was signed” says nothing about the signer and nothing about the picture.`,
        "note",
      ),
    );
  }
  const again = el("button", "Check another image", "again");
  again.type = "button";
  again.addEventListener("click", () => {
    out.replaceChildren();
    drop.style.display = "";
    input.value = "";
  });
  body.append(again);
  card.append(img, body);
  out.append(card);
  drop.style.display = "none";
}

async function run(file: File) {
  if (!file.type.startsWith("image/")) {
    out.replaceChildren(el("p", "That file is not an image.", "note"));
    return;
  }
  const url = URL.createObjectURL(file);
  out.replaceChildren(el("p", "Reading content credentials…", "note"));
  const result = await checker.read(file, file.type);
  render(file, url, result);
}

drop.addEventListener("click", () => input.click());
input.addEventListener("change", () => {
  const f = input.files?.[0];
  if (f) void run(f);
});
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.dataset.drag = "1";
});
drop.addEventListener("dragleave", () => delete drop.dataset.drag);
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  delete drop.dataset.drag;
  const f = e.dataTransfer?.files?.[0];
  if (f) void run(f);
});
