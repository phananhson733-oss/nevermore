// No Playwright import here: this adapter is the only renderer code bundled by Next.
import { createHash } from "node:crypto";
import { z } from "zod";
import { extractCitabilityText, visibleCharCount } from "./citability-text.ts";
import {
  CITABILITY_RENDER_SCHEMA, CITABILITY_RENDER_TIMEOUT_MS, CITABILITY_RENDER_TEXT_CHARS,
  CITABILITY_RENDER_MAX_REQUESTS, CITABILITY_RENDER_MAX_BYTES,
  type CitabilityRenderRequest, type CitabilityRenderEvidence, type CitabilityRenderReason,
  type CitabilityTextCapture,
} from "./citability-render-contract.ts";

function capture(html: string, complete: boolean): CitabilityTextCapture {
  const projected = extractCitabilityText(html);
  const text = projected.slice(0, CITABILITY_RENDER_TEXT_CHARS);
  return { method: "html_projection", text, textChars: visibleCharCount(text), complete: complete && text.length === projected.length };
}

interface MeasurementOptions {
  readonly now?: () => Date;
  readonly reason?: CitabilityRenderReason | null;
  readonly renderedComplete?: boolean;
  readonly requestCount?: number;
  readonly blockedRequests?: number;
  readonly bytes?: number;
  readonly omittedRequests?: number;
  readonly rawCapture?: CitabilityTextCapture;
  readonly renderedCapture?: CitabilityTextCapture;
}

export function measureCitabilityRender(input: CitabilityRenderRequest, renderedHtml: string | null, options: MeasurementOptions = {}): CitabilityRenderEvidence {
  const raw = options.rawCapture ?? capture(input.rawHtml, input.bodyComplete);
  const rendered = options.renderedCapture ?? (renderedHtml === null ? null : capture(renderedHtml, options.renderedComplete !== false));
  const incomplete = !raw.complete || (rendered !== null && !rendered.complete);
  const reason = options.reason ?? (incomplete ? "truncated" : rendered === null ? "service_failed" : null);
  const status = rendered === null ? "unavailable" : reason !== null ? "partial" : "measured";
  return {
    schemaVersion: CITABILITY_RENDER_SCHEMA, status, reason,
    finalUrl: input.url, rawSha256: createHash("sha256").update(input.rawHtml).digest("hex"),
    raw, rendered,
    rawToRenderedRatio: status === "measured" && rendered !== null && rendered.textChars > 0 ? raw.textChars / rendered.textChars : null,
    measuredAt: (options.now ?? (() => new Date()))().toISOString(),
    requestCount: options.requestCount ?? 0,
    blockedRequests: options.blockedRequests ?? 0,
    omittedRequests: options.omittedRequests ?? 0,
    bytes: options.bytes ?? Buffer.byteLength(input.rawHtml),
  };
}

const captureSchema = z.object({ method: z.enum(["html_projection", "browser_visible_text"]), text: z.string().max(CITABILITY_RENDER_TEXT_CHARS), textChars: z.number().int().nonnegative(), complete: z.boolean() }).strict();
const evidenceSchema = z.object({
  schemaVersion: z.literal(CITABILITY_RENDER_SCHEMA),
  status: z.enum(["measured", "partial", "unavailable"]),
  reason: z.enum(["not_configured", "timeout", "service_failed", "invalid_response", "blocked", "resource_limit", "truncated", "navigation"]).nullable(),
  finalUrl: z.string().max(2048), rawSha256: z.string().regex(/^[a-f0-9]{64}$/),
  raw: captureSchema, rendered: captureSchema.nullable(), rawToRenderedRatio: z.number().nonnegative().finite().nullable(),
  measuredAt: z.iso.datetime(), requestCount: z.number().int().min(0).max(CITABILITY_RENDER_MAX_REQUESTS),
  blockedRequests: z.number().int().nonnegative().max(10_000), bytes: z.number().int().min(0).max(CITABILITY_RENDER_MAX_BYTES),
  omittedRequests: z.number().int().nonnegative().max(CITABILITY_RENDER_MAX_REQUESTS),
}).strict();

interface AdapterDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
}

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1_500_000) throw new Error("large");
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function requestCitabilityRender(input: CitabilityRenderRequest, options: AdapterDependencies = {}): Promise<CitabilityRenderEvidence> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const unavailable = (reason: CitabilityRenderReason) => measureCitabilityRender(input, null, { now, reason });
  const endpoint = env["CITABILITY_RENDERER_URL"];
  const token = env["CITABILITY_RENDERER_TOKEN"];
  if (!endpoint || !token || token.length < 16) return unavailable("not_configured");
  try {
    const url = new URL(endpoint);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) return unavailable("not_configured");
  } catch { return unavailable("not_configured"); }
  const signal = AbortSignal.timeout(CITABILITY_RENDER_TIMEOUT_MS + 2_000);
  try {
    const response = await (options.fetcher ?? fetch)(endpoint, {
      method: "POST", redirect: "error", cache: "no-store", signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); return unavailable("service_failed"); }
    const parsed = evidenceSchema.safeParse(await boundedJson(response));
    if (!parsed.success) return unavailable("invalid_response");
    const evidence = parsed.data;
    const expected = unavailable("service_failed");
    const rawMatches = evidence.raw.method === "browser_visible_text"
      ? evidence.raw.textChars === visibleCharCount(evidence.raw.text) && (!evidence.raw.complete || input.bodyComplete)
      : JSON.stringify(evidence.raw) === JSON.stringify(expected.raw);
    const fresh = Math.abs(now().getTime() - Date.parse(evidence.measuredAt)) <= 60_000;
    const complete = evidence.raw.complete && evidence.rendered?.complete && evidence.blockedRequests === 0;
    const ratio = evidence.status === "measured" && evidence.rendered && evidence.rendered.textChars > 0 ? evidence.raw.textChars / evidence.rendered.textChars : null;
    if (!rawMatches || !fresh || evidence.rawSha256 !== expected.rawSha256 || evidence.finalUrl !== input.url ||
      (evidence.rendered && evidence.rendered.textChars !== visibleCharCount(evidence.rendered.text)) ||
      (evidence.status === "measured" && (!complete || evidence.reason !== null)) ||
      (evidence.status === "unavailable" && evidence.rendered !== null) ||
      (evidence.status === "partial" && evidence.rendered === null) ||
      (evidence.status === "measured" && evidence.raw.method !== evidence.rendered?.method) ||
      (evidence.status !== "measured" && evidence.reason === null) || evidence.rawToRenderedRatio !== ratio) return unavailable("invalid_response");
    return evidence;
  } catch { return unavailable(signal.aborted ? "timeout" : "service_failed"); }
}
