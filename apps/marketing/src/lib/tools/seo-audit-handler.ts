import {
  buildSeoAuditPayload,
  createPublicToolError,
  normalizeSeoAuditUrl,
  scanSeoAuditSite,
  SeoAuditScanError,
  type SeoAuditPayload,
  type SeoAuditRaw,
  type SeoAuditUrlResult,
} from "@sf/public-tools";
import {
  checkRateLimit,
  extractClientIp,
  type RateLimitResult,
} from "../rate-limit.ts";
import {
  acquirePublicToolSlot,
  readPublicToolJson,
} from "./public-tool-request.ts";

const REQUEST_BODY_LIMIT_BYTES = 4_096;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000;

export interface SeoAuditHandlerDependencies {
  readonly normalizeUrl: (value: unknown) => SeoAuditUrlResult;
  readonly scan: (url: string) => Promise<SeoAuditRaw>;
  readonly buildPayload: (raw: SeoAuditRaw) => SeoAuditPayload;
  readonly rateLimit: (
    key: string,
    max: number,
    windowMs: number,
  ) => RateLimitResult;
  readonly extractClientIp: (headers: Headers) => string;
}

const DEFAULT_DEPENDENCIES: SeoAuditHandlerDependencies = {
  normalizeUrl: normalizeSeoAuditUrl,
  scan: scanSeoAuditSite,
  buildPayload: buildSeoAuditPayload,
  rateLimit: checkRateLimit,
  extractClientIp,
};

function json(
  body: unknown,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function inputUrl(
  body: unknown,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, "url")
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    value: (body as { readonly url?: unknown }).url,
  };
}

export async function handleSeoAuditRequest(
  request: Request,
  dependencies: SeoAuditHandlerDependencies = DEFAULT_DEPENDENCIES,
): Promise<Response> {
  const body = await readPublicToolJson(request, REQUEST_BODY_LIMIT_BYTES);
  if (!body.ok) {
    const status =
      body.code === "unsupported_media_type"
        ? 415
        : body.code === "payload_too_large"
          ? 413
          : 400;
    return json(createPublicToolError(body.code), status);
  }

  const input = inputUrl(body.value);
  if (!input.ok) {
    return json(createPublicToolError("invalid_request"), 400);
  }
  const normalized = dependencies.normalizeUrl(input.value);
  if (!normalized.ok) {
    return json(createPublicToolError(normalized.code), 400);
  }

  const ip = dependencies.extractClientIp(request.headers);
  const rate = dependencies.rateLimit(
    `tools:seo-audit:ip:${ip}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rate.allowed) {
    return json(createPublicToolError("rate_limited"), 429, {
      "Retry-After": String(rate.retryAfterSeconds),
      "X-RateLimit-Remaining": "0",
    });
  }

  const slot = acquirePublicToolSlot(`tools:seo-audit:inflight:${ip}`);
  if (!slot.acquired) {
    return json(createPublicToolError("scan_in_progress"), 429, {
      "Retry-After": "5",
      "X-RateLimit-Remaining": String(rate.remaining),
    });
  }

  try {
    const raw = await dependencies.scan(normalized.url);
    return json(
      { data: dependencies.buildPayload(raw) },
      200,
      { "X-RateLimit-Remaining": String(rate.remaining) },
    );
  } catch (error) {
    if (error instanceof SeoAuditScanError) {
      if (error.code === "timeout") {
        return json(createPublicToolError("scan_timeout"), 504);
      }
      if (error.code === "blocked") {
        return json(createPublicToolError("invalid_url"), 400);
      }
    }
    return json(createPublicToolError("scan_failed"), 502);
  } finally {
    slot.release();
  }
}
