# @proofcan/c2pa-check

Read the **C2PA Content Credentials** in an image, in the browser. The file is read on the device and is never uploaded.

> Package name is provisional until it is published.

It reports what a file *declares*: who signed it, which tool made it, any declared source type (for example "created by a generative AI model"), when, and whether the file still matches what was signed. It is the open-source reader behind [proofcan.com/pulse/check](https://www.proofcan.com/pulse/check).

## What it does not do

- **It does not detect AI from pixels.** A file with no credentials tells you nothing about how the image was made. When none are found the demo says: *"No content credentials found. This does not prove the image is not AI-generated."*
- **It does not check signers against a trust list.** Anyone with a signing certificate can sign a claim. The signer is shown as the file reports it. `signingCredential.untrusted` appears in the result for ordinary files for that reason and says nothing about the file's contents.
- It does not read invisible watermarks or search fingerprints.
- It is not legal advice and does not tell you whether anything meets a legal requirement.

## Install

```sh
npm install @proofcan/c2pa-check
```

Browser only (it uses WebAssembly and a Web Worker). The default location of the wasm file is `new URL("./c2pa.wasm", import.meta.url)`. This repository has tested that with an esbuild bundle and with the unbundled package in Chrome; other bundlers are untested here, so if yours does not copy or rewrite that URL, pass `wasmUrl` (below).

## Use

```js
import { readCredentials, NO_CREDENTIALS_MESSAGE } from "@proofcan/c2pa-check";

const input = document.querySelector("input[type=file]");
input.addEventListener("change", async () => {
  const result = await readCredentials(input.files[0]);
  if (result.kind === "none") return console.log(NO_CREDENTIALS_MESSAGE);
  if (result.kind === "error") return console.error(result.message);
  const { signer, generator, aiDeclaration, validation } = result.credentials;
  console.log({ signer, generator, aiDeclaration, contentMatches: validation.contentMatchesSignature });
});
```

`result.kind` is `"none"` (no manifest), `"found"` or `"error"` (unreadable file). `read` never throws.

Fields of `result.credentials`: `signer`, `generator`, `sourceTypes` (every declared source-type URI), `aiDeclaration` (`"generative-ai"`, `"composite-with-generative-ai"`, `"other"`, `"not-stated"`), `signedAt`, `assertionLabels`, `manifestCount`, and `validation`:

| `validation.*` | Meaning |
|---|---|
| `readerState` | The reader's own state for the active manifest, verbatim. |
| `failureCodes` | Every failure code the reader reported, verbatim. |
| `signerCodes` | The `signingCredential.*` codes: about the signing certificate. Signers are not evaluated here. |
| `contentCodes` | All other codes: whether the file still matches what was signed. |
| `contentMatchesSignature` | `true` when there are no `contentCodes`. Says nothing about the signer or the picture. |
| `trustListChecked` | Always `false`. |

`describeSourceType(uri)` turns a source-type URI into a readable label; `NO_TRUST_CHECK_NOTICE` is the sentence to show next to any signer.

### Hosting the WebAssembly file

`c2pa.wasm` (about 9 MB raw, 3.4 MB gzipped, 2.2 MB brotli) ships inside this package, so nothing is fetched from a third party. If your bundler moves it, say where it is:

```js
import { createChecker } from "@proofcan/c2pa-check";
import wasmUrl from "@proofcan/c2pa-check/c2pa.wasm?url"; // Vite syntax; not tested here
const checker = createChecker({ wasmUrl });
const result = await checker.read(file);
```

## Privacy

The image never leaves the device. The only network request this library makes is the one that loads `c2pa.wasm` (from your own origin by default). No cookies, no analytics, no third-party scripts. The demo page enforces this with a Content-Security-Policy.

## Demo

`npm run build` writes a static page to `demo-dist/` (HTML, one script, the wasm file). It can be hosted as-is on any static host.

## Tests

`npm test` opens the built demo in headless Chrome and checks signed files from the [C2PA public test files](https://github.com/c2pa-org/public-testfiles), unsigned images, an altered signed file and several damaged inputs, and asserts that the page makes no requests other than loading itself and the wasm file. The C2PA test files are licensed CC BY-SA 4.0; they are downloaded into `test/.cache` when you run the tests and are not part of this repository or package.

## Licence

MIT, see `LICENSE`. Third-party components: `THIRD-PARTY-NOTICES.md`. Built on [`@contentauth/c2pa-web`](https://github.com/contentauth/c2pa-js) (MIT, Adobe).

Proofcan signs AI-generated images with C2PA Content Credentials and an invisible watermark: [proofcan.com](https://www.proofcan.com).
