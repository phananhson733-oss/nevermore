import {
  buildInternalLinkAuditPayload,
  createPublicToolError,
  normalizeInternalLinkAuditUrl,
  scanInternalLinkAuditSite,
  InternalLinkAuditScanError,
  type InternalLinkAuditRaw,
  type InternalLinkAuditPayload,
  type InternalLinkAuditUrlResult,
} from "@sf/public-tools";
import {
  extractClientIp,
} from "../rate-limit.ts";
import {
  acquirePublicCrawlSlot,
  readPublicToolJson,
} from "./public-tool-request.ts";

const REQUEST_BODY_LIMIT_BYTES = 4_096;

export interface InternalLinkAuditHandlerDependencies {
  readonly normalizeUrl: (value: unknown) => InternalLinkAuditUrlResult;
  readonly scan: (url: string) => Promise<InternalLinkAuditRaw>;
  readonly buildPayload: (raw: InternalLinkAuditRaw) => InternalLinkAuditPayload;
  readonly extractClientIp: (headers: Headers) => string;
}

const DEFAULT_DEPENDENCIES: InternalLinkAuditHandlerDependencies = {
  normalizeUrl: normalizeInternalLinkAuditUrl,
  scan: scanInternalLinkAuditSite,
  buildPayload: buildInternalLinkAuditPayload,
  extractClientIp,
};

function json(
  body: unknown,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
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
  return { ok: true, value: (body as { readonly url?: unknown }).url };
}

export async function handleInternalLinkAuditRequest(
  request: Request,
  dependencies: InternalLinkAuditHandlerDependencies = DEFAULT_DEPENDENCIES,
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
  if (!input.ok) return json(createPublicToolError("invalid_request"), 400);
  const normalized = dependencies.normalizeUrl(input.value);
  if (!normalized.ok) return json(createPublicToolError(normalized.code), 400);

  const ip = dependencies.extractClientIp(request.headers);
  const slot = acquirePublicCrawlSlot(ip);
  if (!slot.acquired) {
    return json(createPublicToolError("scan_in_progress"), 409, {
      "Retry-After": "5",
    });
  }
  try {
    const raw = await dependencies.scan(normalized.url);
    return json({ data: dependencies.buildPayload(raw) }, 200);
  } catch (error) {
    if (error instanceof InternalLinkAuditScanError) {
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
