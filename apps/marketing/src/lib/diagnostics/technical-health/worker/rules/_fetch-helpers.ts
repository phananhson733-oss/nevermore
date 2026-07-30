// @input  -- URL string + optional timeout ms (default 10000) + optional UA override;
//            Response object for safeRead body cap
// @output -- fetchWithTimeout(url, opts?): Promise<FetchResult>
//            safeRead(response, maxBytes?): Promise<SafeReadResult>
// @pos    -- W3a/D1 Phase 1c + Phase 2 hardening -- shared HTTP fetcher used by every
//            CRAWL.* rule (robots-core, sitemap-exists, http-status, page-sampler,
//            page-fetcher). No AI, no DB.
//            post-review hardening (2026-05-11): SSRF IP blocklist (P1-1),
//            manual redirect re-validation (P1-2), Content-Length size cap (P0-6).
//            Phase 2 hardening: streaming body cap via safeRead() (D1-P2).
//            Phase 2 chunk 2c: FetchResult gains `hops: number` — actual redirect
//            hop count (0 for direct responses). Used by URL.REDIRECT_CHAINS rule.
//            Post-review MED-1 (2026-05-12): inclusive redirect cap — after
//            MAX_REDIRECTS=10 3xx responses, we throw `too_many_redirects`
//            without issuing an 11th fetch. `hops` returned is bounded by
//            MAX_REDIRECTS (never 11).
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { promises as dns } from "node:dns";
import * as net from "node:net";

// Single source of truth for the SSRF IP blocklist (was a local copy here that
// drifted from the render-guard copy and missed IPv4-mapped IPv6 hex — codex U4a P1).
import { isBlockedIp } from "../ip-blocklist";

export const DEFAULT_USER_AGENT =
  "GenGrowth-Diagnostic/1.0 (+https://gengrowth.ai)";
export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_REDIRECTS = 10;
export const DEFAULT_BODY_CAP_BYTES = 5 * 1024 * 1024; // 5 MB

export interface FetchWithTimeoutOpts {
  timeoutMs?: number;
  userAgent?: string;
}

export interface FetchResult {
  response: Response | null;
  error: Error | null;
  durationMs: number;
  /**
   * Number of redirect hops followed before reaching the final response.
   * 0 for direct responses (no redirect). Capped at MAX_REDIRECTS.
   * Chunk 2c: consumed by URL.REDIRECT_CHAINS detection rule via PageRecord.redirectHops.
   */
  readonly hops: number;
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    "message" in err
  ) {
    const domEx = err as { name: string; message: string };
    const e = new Error(domEx.message);
    e.name = domEx.name;
    return e;
  }
  return new Error(String(err));
}

/** Reject non-http(s) schemes outright. */
function isAllowedScheme(parsed: URL): boolean {
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/**
 * Resolve hostname and reject if any A/AAAA record points to a blocked range.
 * Localhost / loopback literals are caught here too because dns.lookup
 * returns 127.0.0.1 / ::1 for "localhost" on every reasonable system.
 */
async function ensureHostnameSafe(hostname: string): Promise<void> {
  // URL.hostname keeps IPv6 in bracketed form; strip brackets for IP checks.
  const ipCandidate = hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (net.isIP(ipCandidate)) {
    if (isBlockedIp(ipCandidate)) {
      throw new Error(
        `ssrf_blocked: literal IP ${ipCandidate} is private/loopback/link-local`,
      );
    }
    return;
  }
  // "localhost" and similar — resolve and check every record.
  let addrs: { address: string; family: number }[];
  try {
    addrs = await dns.lookup(hostname, { all: true });
    } catch {
    // DNS failure isn't an SSRF issue; let fetch surface the error.
    return;
  }
  for (const a of addrs) {
    if (isBlockedIp(a.address)) {
      throw new Error(
        `ssrf_blocked: ${hostname} resolves to private/loopback/link-local address ${a.address}`,
      );
    }
  }
}

function checkContentLength(response: Response): Error | null {
  const raw = response.headers?.get?.("content-length");
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return null;
  if (n > MAX_RESPONSE_BYTES) {
    return new Error(
      `body_too_large: response Content-Length ${n} exceeds MAX_RESPONSE_BYTES ${MAX_RESPONSE_BYTES}`,
    );
  }
  return null;
}

export interface SafeReadResult {
  text: string | null;
  truncated: boolean;
  error: Error | null;
}

/**
 * Read a Response body with a streaming byte cap.
 * Never throws — all errors are returned in the envelope.
 * Returns truncated=true when the body exceeded maxBytes (only maxBytes are kept).
 * Returns text=null only on stream error.
 */
export async function safeRead(
  response: Response,
  maxBytes: number,
): Promise<SafeReadResult> {
  if (!response.body) {
    return { text: "", truncated: false, error: null };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const remaining = maxBytes - totalBytes;
      if (value.length >= remaining) {
        // Take only what fits up to the cap.
        chunks.push(value.slice(0, remaining));
        totalBytes += remaining;
        truncated = true;
        reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
      totalBytes += value.length;
    }
  } catch (err) {
    return { text: null, truncated: false, error: toError(err) };
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  const text = new TextDecoder().decode(combined);
  return { text, truncated, error: null };
}

/**
 * Fetch a URL with timeout, SSRF blocklist, and manual redirect re-validation.
 * Never throws — all errors are returned in the envelope. The body is NOT
 * read here; callers do that. We do enforce Content-Length cap pre-read.
 */
export async function fetchWithTimeout(
  url: string,
  opts: FetchWithTimeoutOpts = {},
): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const startMs = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = url;
    let hops = 0;
    while (true) {
      // Per-hop scheme + SSRF validation.
      let parsed: URL;
      try {
        parsed = new URL(currentUrl);
      } catch {
        return {
          response: null,
          error: new Error(`unsupported_scheme: invalid URL ${currentUrl}`),
          durationMs: Date.now() - startMs,
          hops,
        };
      }
      if (!isAllowedScheme(parsed)) {
        return {
          response: null,
          error: new Error(
            `unsupported_scheme: ${parsed.protocol} is not http(s)`,
          ),
          durationMs: Date.now() - startMs,
          hops,
        };
      }
      try {
        await ensureHostnameSafe(parsed.hostname);
      } catch (ssrfErr) {
        return {
          response: null,
          error: toError(ssrfErr),
          durationMs: Date.now() - startMs,
          hops,
        };
      }

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method: "GET",
          cache: "no-store",
          redirect: "manual",
          signal: controller.signal,
          headers: { "User-Agent": userAgent },
        });
      } catch (err) {
        return {
          response: null,
          error: toError(err),
          durationMs: Date.now() - startMs,
          hops,
        };
      }

      // Manual redirect re-validation.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get?.("location");
        if (!location) {
          // 3xx without Location — surface as-is.
          const sizeErr = checkContentLength(response);
          if (sizeErr) {
            return {
              response: null,
              error: sizeErr,
              durationMs: Date.now() - startMs,
              hops,
            };
          }
          return {
            response,
            error: null,
            durationMs: Date.now() - startMs,
            hops,
          };
        }
        hops += 1;
        // MED-1: inclusive cap. `MAX_REDIRECTS` counts the maximum number of
        // 3xx responses we'll follow. With `>=`, after the MAX_REDIRECTS-th
        // 3xx response we throw without issuing another fetch, so the total
        // fetch call count equals MAX_REDIRECTS (all returning 3xx) and the
        // returned `hops` value never exceeds MAX_REDIRECTS.
        if (hops >= MAX_REDIRECTS) {
          return {
            response: null,
            error: new Error(
              `too_many_redirects: redirect chain exceeded MAX_REDIRECTS=${MAX_REDIRECTS}`,
            ),
            durationMs: Date.now() - startMs,
            hops,
          };
        }
        // Resolve the Location header relative to the current URL.
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          return {
            response: null,
            error: new Error(`redirect_invalid_location: ${location}`),
            durationMs: Date.now() - startMs,
            hops,
          };
        }
        currentUrl = nextUrl;
        continue;
      }

      const sizeErr = checkContentLength(response);
      if (sizeErr) {
        return {
          response: null,
          error: sizeErr,
          durationMs: Date.now() - startMs,
          hops,
        };
      }
      return { response, error: null, durationMs: Date.now() - startMs, hops };
    }
  } finally {
    clearTimeout(timer);
  }
}
