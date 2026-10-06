/**
 * @proofcan/c2pa-check — read C2PA Content Credentials in an image, in the browser.
 *
 * What it does: parses the C2PA manifest embedded in a file (with Adobe's
 * `@contentauth/c2pa-web`, WebAssembly in a Web Worker) and reports what the
 * file DECLARES: who signed it, which tool made it, any declared source type
 * (for example "created by a generative AI model"), when, and whether the file
 * still matches what was signed.
 *
 * What it does not do:
 *  - It does not look at pixels. A file without credentials tells you nothing
 *    about how the image was made.
 *  - It does not check the signer against any trust list. Anyone with a signing
 *    certificate can sign a claim. Judge the signer yourself.
 *  - It does not read invisible watermarks or search fingerprints.
 *
 * The file is read on the device. This library makes no network request of its
 * own except to load the WebAssembly binary (`c2pa.wasm`, shipped in this
 * package; see `wasmUrl`).
 */
import type { Manifest } from "@contentauth/c2pa-web";

/** The sentence to show when a file has no credentials. Do not shorten it. */
export const NO_CREDENTIALS_MESSAGE =
  "No content credentials found. This does not prove the image is not AI-generated.";

/** Shown next to any signer: this library never evaluates signers. */
export const NO_TRUST_CHECK_NOTICE =
  "The signer is shown as the file reports it. It was not checked against any trust list.";

export type AiDeclaration =
  /** A source type meaning "created by a generative AI model". */
  | "generative-ai"
  /** A composite that includes generative-AI content. */
  | "composite-with-generative-ai"
  /** Some other source type is declared (see `sourceTypes`). */
  | "other"
  /** The manifest declares no source type. */
  | "not-stated";

export interface Validation {
  /** The reader's own state for the active manifest, verbatim ("Valid", "Invalid", ...). */
  readerState: string | null;
  /** Every failure code the reader reported, verbatim. */
  failureCodes: string[];
  /**
   * Failure codes about the signing certificate (`signingCredential.*`). This
   * library does not evaluate signers, so `signingCredential.untrusted` is
   * expected for every file and says nothing about the file's contents.
   */
  signerCodes: string[];
  /** All other failure codes: these concern whether the file still matches what was signed. */
  contentCodes: string[];
  /** True when no content code was reported. This is not a statement about the signer. */
  contentMatchesSignature: boolean;
  /** Always false. See NO_TRUST_CHECK_NOTICE. */
  trustListChecked: false;
}

export interface Credentials {
  /** Issuer / common name of the signing certificate, as the file reports it. */
  signer: string | null;
  /** Name of the claim generator (the software that wrote the manifest). */
  generator: string | null;
  /** Every declared source-type URI found in the manifest's actions. */
  sourceTypes: string[];
  aiDeclaration: AiDeclaration;
  /** Signing time from the signature, as an ISO string, if present. */
  signedAt: string | null;
  validation: Validation;
  /** Labels of the assertions in the active manifest. */
  assertionLabels: string[];
  /** Number of manifests in the store (more than one means the file was edited after signing). */
  manifestCount: number;
}

export type CheckResult =
  | { kind: "none" }
  | { kind: "found"; credentials: Credentials }
  | { kind: "error"; message: string };

export interface CheckerOptions {
  /**
   * Where the browser loads `c2pa.wasm` from. Defaults to the copy that sits next
   * to this module (`new URL("./c2pa.wasm", import.meta.url)`), so nothing is
   * fetched from a third party. Pass your own URL if your bundler moves the file.
   */
  wasmUrl?: string | URL;
}

export interface Checker {
  /** Read the credentials of an image `File` or `Blob`. Never throws; errors come back as `{ kind: "error" }`. */
  read(file: Blob, mimeType?: string): Promise<CheckResult>;
}

const SOURCE_TYPE_GENERATIVE = /\/(trainedAlgorithmicMedia)$/;
const SOURCE_TYPE_COMPOSITE_GENERATIVE = /\/(compositeWithTrainedAlgorithmicMedia)$/;

type Action = { digitalSourceType?: string };

function sourceTypesOf(manifest: Manifest): string[] {
  const found = new Set<string>();
  for (const a of manifest.assertions ?? []) {
    const data = a.data as { actions?: Action[]; digitalSourceType?: string } | undefined;
    if (!data) continue;
    for (const act of data.actions ?? []) if (act.digitalSourceType) found.add(act.digitalSourceType);
    if (data.digitalSourceType) found.add(data.digitalSourceType);
  }
  return [...found];
}

function declarationOf(types: string[]): AiDeclaration {
  if (types.some((t) => SOURCE_TYPE_GENERATIVE.test(t))) return "generative-ai";
  if (types.some((t) => SOURCE_TYPE_COMPOSITE_GENERATIVE.test(t))) return "composite-with-generative-ai";
  return types.length ? "other" : "not-stated";
}

/** Human-readable label for a declared source type URI (last path segment when unknown). */
export function describeSourceType(uri: string): string {
  const key = uri.split("/").filter(Boolean).pop() ?? uri;
  const known: Record<string, string> = {
    trainedAlgorithmicMedia: "Created by a generative AI model",
    compositeWithTrainedAlgorithmicMedia: "Composite that includes generative-AI content",
    algorithmicMedia: "Created by an algorithm (not a trained model)",
    digitalCapture: "Digital camera capture",
    composite: "Composite of several sources",
    digitalCreation: "Digital creation",
  };
  return known[key] ?? `Declared source type: ${key}`;
}

function splitCodes(codes: string[]): Pick<Validation, "signerCodes" | "contentCodes"> {
  const signerCodes = codes.filter((c) => c.startsWith("signingCredential."));
  return { signerCodes, contentCodes: codes.filter((c) => !c.startsWith("signingCredential.")) };
}

/** Pure mapping from a parsed manifest store to our result. Exported for tests. */
export function summarize(store: {
  active_manifest?: string | null;
  manifests?: Record<string, Manifest>;
  validation_state?: string | null;
  validation_results?: { activeManifest?: { failure?: { code?: string }[] } | null } | null;
}): CheckResult {
  const label = store.active_manifest;
  const manifest = label ? store.manifests?.[label] : undefined;
  if (!manifest) return { kind: "none" };

  const codes = [
    ...new Set((store.validation_results?.activeManifest?.failure ?? []).map((f) => f.code).filter((c): c is string => !!c)),
  ];
  const { signerCodes, contentCodes } = splitCodes(codes);
  const sig = manifest.signature_info;
  const types = sourceTypesOf(manifest);

  return {
    kind: "found",
    credentials: {
      signer: sig?.issuer ?? sig?.common_name ?? null,
      generator: manifest.claim_generator_info?.[0]?.name ?? manifest.claim_generator ?? null,
      sourceTypes: types,
      aiDeclaration: declarationOf(types),
      signedAt: sig?.time ?? null,
      validation: {
        readerState: store.validation_state ?? null,
        failureCodes: codes,
        signerCodes,
        contentCodes,
        contentMatchesSignature: contentCodes.length === 0,
        trustListChecked: false,
      },
      assertionLabels: (manifest.assertions ?? []).map((a) => a.label),
      manifestCount: Object.keys(store.manifests ?? {}).length,
    },
  };
}

const NO_MANIFEST = /no (c2pa )?(claim|manifest|jumbf)|jumbf not found|not found/i;

/**
 * Create a checker. The WebAssembly module is loaded on the first `read()`, not
 * at import time.
 */
export function createChecker(options: CheckerOptions = {}): Checker {
  let ready: Promise<{ mod: typeof import("@contentauth/c2pa-web"); c2pa: unknown }> | null = null;

  const load = () => {
    ready ??= (async () => {
      const mod = await import("@contentauth/c2pa-web");
      const wasmSrc = String(options.wasmUrl ?? new URL("./c2pa.wasm", import.meta.url));
      return { mod, c2pa: await mod.createC2pa({ wasmSrc }) };
    })();
    return ready;
  };

  return {
    async read(file, mimeType) {
      try {
        const { mod, c2pa } = await load();
        const c = c2pa as Parameters<typeof mod.Reader.fromBlob>[0];
        let reader;
        try {
          reader = await mod.Reader.fromBlob(c, mimeType ?? file.type, file);
        } catch (err) {
          // "No manifest" is a normal answer, not a failure.
          if (NO_MANIFEST.test(String((err as Error)?.message ?? err))) return { kind: "none" };
          throw err;
        }
        if (!reader) return { kind: "none" };
        try {
          return summarize(await reader.manifestStore());
        } finally {
          await reader.free();
        }
      } catch (err) {
        return { kind: "error", message: String((err as Error)?.message ?? err) };
      }
    },
  };
}

let shared: Checker | null = null;

/** Convenience: read with a shared default checker. */
export function readCredentials(file: Blob, mimeType?: string, options?: CheckerOptions): Promise<CheckResult> {
  shared ??= createChecker(options);
  return shared.read(file, mimeType);
}
