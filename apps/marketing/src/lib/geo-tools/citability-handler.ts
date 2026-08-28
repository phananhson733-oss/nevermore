// @input  -- public POST JSON body with one page URL and an optional target question
// @output -- a transient citability report or a bounded error envelope
// @pos    -- the HTTP boundary of the page-citability tool; fetches, then hands the bytes to the rules

import { createPublicToolError, normalizeSeoAuditUrl } from "@sf/public-tools";
import { fetchPublicResource } from "@sf/sources/public-http";

import { getServerAuthenticationStatus } from "../auth/server-auth-status.ts";
import { extractClientIp } from "../rate-limit.ts";
import { readPublicToolJson } from "../tools/public-tool-request.ts";
import {
  CITABILITY_FETCH_TIMEOUT_MS,
  CITABILITY_MAX_BODY_BYTES,
  type CitabilityErrorCode,
  type CitabilityReport,
  type LlmsTxtFetch,
  type RobotsFetch,
} from "./citability-contract.ts";
import {
  openCitabilityGate,
  type CitabilityGateResult,
} from "./citability-gate.ts";
import { buildCitabilityReport } from "./citability-rules.ts";

const REQUEST_BODY_LIMIT_BYTES = 4_096;
const MAX_QUESTION_CHARS = 200;

/** A whitelist, so a misspelled field is refused rather than silently dropped. */
const ALLOWED_KEYS: ReadonlySet<string> = new Set(["url", "question"]);

export interface CitabilityFetchResult {
  readonly kind: "ok" | "error";
  readonly code?: string;
  readonly finalUrl?: string;
  readonly status?: number;
  readonly contentType?: string | null;
  readonly body?: string;
}

export interface CitabilityHandlerDependencies {
  readonly normalizeUrl: typeof normalizeSeoAuditUrl;
  readonly extractClientIp: (headers: Headers) => string;
  readonly isSignedIn: () => Promise<boolean>;
  readonly openGate: (input: {
    readonly clientIp: string;
    readonly targetHost: string;
    readonly signedIn: boolean;
  }) => Promise<CitabilityGateResult>;
  readonly fetchResource: (
    url: string,
    options: {
      readonly timeoutMs: number;
      readonly maxBodyBytes: number;
      readonly allowedOrigin?: string;
    },
  ) => Promise<CitabilityFetchResult>;
  readonly now: () => Date;
}

function toFetchResult(
  result: Awaited<ReturnType<typeof fetchPublicResource>>,
): CitabilityFetchResult {
  if (result.kind === "error") return { kind: "error", code: result.code };
  return {
    kind: "ok",
    finalUrl: result.finalUrl,
    status: result.finalStatus,
    contentType: result.contentType,
    body: result.body,
  };
}

export const DEFAULT_CITABILITY_HANDLER_DEPENDENCIES: CitabilityHandlerDependencies =
  {
    normalizeUrl: normalizeSeoAuditUrl,
    extractClientIp,
    isSignedIn: async () =>
      (await getServerAuthenticationStatus()) === "authenticated",
    openGate: (input) => openCitabilityGate(input),
    fetchResource: async (url, options) =>
      toFetchResult(
        await fetchPublicResource(url, {
          timeoutMs: options.timeoutMs,
          maxBodyBytes: options.maxBodyBytes,
          ...(options.allowedOrigin
            ? { allowedOrigin: options.allowedOrigin }
            : {}),
        }),
      ),
    now: () => new Date(),
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

function fail(code: CitabilityErrorCode, status: number): Response {
  return json(createPublicToolError(code), status);
}

interface ParsedInput {
  readonly url: unknown;
  readonly question: string | null;
}

function readInput(
  body: unknown,
): { readonly ok: true; readonly value: ParsedInput } | { readonly ok: false } {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !Object.hasOwn(body, "url") ||
    Object.keys(body).some((key) => !ALLOWED_KEYS.has(key))
  ) {
    return { ok: false };
  }
  const record = body as { readonly url?: unknown; readonly question?: unknown };
  if (record.question !== undefined && typeof record.question !== "string") {
    return { ok: false };
  }
  const question =
    typeof record.question === "string" ? record.question.trim() : "";
  if (question.length > MAX_QUESTION_CHARS) return { ok: false };
  return {
    ok: true,
    value: { url: record.url, question: question.length > 0 ? question : null },
  };
}

/**
 * Read `/robots.txt` for the page's own origin.
 *
 * The three outcomes stay separate all the way to the report. RFC 9309
 * 2.3.1.3 makes a 404 full allowance, a 5xx makes the site's rules unknown,
 * and a transport failure is a retry — one `null` for all three is how "there
 * are no rules" gets shown to a visitor as "the check failed".
 */
async function fetchRobots(
  origin: string,
  dependencies: CitabilityHandlerDependencies,
): Promise<RobotsFetch> {
  const result = await dependencies.fetchResource(`${origin}/robots.txt`, {
    timeoutMs: CITABILITY_FETCH_TIMEOUT_MS,
    maxBodyBytes: CITABILITY_MAX_BODY_BYTES,
    allowedOrigin: origin,
  });
  if (result.kind === "error") {
    return { status: "unreachable", httpStatus: null };
  }
  const status = result.status ?? 0;
  if (status === 404 || status === 410) {
    return { status: "absent", httpStatus: status };
  }
  if (status >= 200 && status < 300) {
    return { status: "ok", text: result.body ?? "" };
  }
  return { status: "unreachable", httpStatus: status };
}

async function fetchLlmsTxt(
  origin: string,
  dependencies: CitabilityHandlerDependencies,
): Promise<LlmsTxtFetch> {
  const result = await dependencies.fetchResource(`${origin}/llms.txt`, {
    timeoutMs: CITABILITY_FETCH_TIMEOUT_MS,
    maxBodyBytes: CITABILITY_MAX_BODY_BYTES,
    allowedOrigin: origin,
  });
  if (result.kind === "error") {
    return { status: "unreachable", httpStatus: null };
  }
  const status = result.status ?? 0;
  if (status === 404 || status === 410) {
    return { status: "absent", httpStatus: status };
  }
  if (status >= 200 && status < 300) {
    return {
      status: "ok",
      bytes: Buffer.byteLength(result.body ?? "", "utf8"),
    };
  }
  return { status: "unreachable", httpStatus: status };
}

function pageErrorCode(code: string | undefined): CitabilityErrorCode {
  if (code === "timeout") return "fetch_timeout";
  if (
    code === "blocked" ||
    code === "cross_origin" ||
    code === "invalid_redirect"
  ) {
    return "fetch_blocked";
  }
  return "fetch_failed";
}

export async function handleCitabilityRequest(
  request: Request,
  dependencies: CitabilityHandlerDependencies = DEFAULT_CITABILITY_HANDLER_DEPENDENCIES,
): Promise<Response> {
  const body = await readPublicToolJson(request, REQUEST_BODY_LIMIT_BYTES);
  if (!body.ok) {
    const status =
      body.code === "unsupported_media_type"
        ? 415
        : body.code === "payload_too_large"
          ? 413
          : 400;
    return fail(body.code, status);
  }
  const input = readInput(body.value);
  if (!input.ok) return fail("invalid_request", 400);

  const normalized = dependencies.normalizeUrl(input.value.url);
  if (!normalized.ok) return fail("invalid_url", 400);

  const target = new URL(normalized.url);
  const clientIp = dependencies.extractClientIp(request.headers);
  const signedIn = await dependencies.isSignedIn();
  const gate = await dependencies.openGate({
    clientIp,
    targetHost: target.host,
    signedIn,
  });
  if (!gate.ok) return gate.response;

  try {
    const page = await dependencies.fetchResource(normalized.url, {
      timeoutMs: CITABILITY_FETCH_TIMEOUT_MS,
      maxBodyBytes: CITABILITY_MAX_BODY_BYTES,
    });
    if (page.kind === "error") return fail(pageErrorCode(page.code), 502);

    const status = page.status ?? 0;
    if (status < 200 || status >= 300) {
      // A page an answer cannot reach is not a page with weak markup, and
      // grading its markup anyway would report a 404 as a mostly-passing page.
      return fail("page_not_ok", 422);
    }
    const contentType = (page.contentType ?? "").toLowerCase();
    if (contentType && !contentType.includes("html")) {
      return fail("not_html", 422);
    }

    const finalUrl = page.finalUrl ?? normalized.url;
    const origin = new URL(finalUrl).origin;
    const [robots, llmsTxt] = await Promise.all([
      fetchRobots(origin, dependencies),
      fetchLlmsTxt(origin, dependencies),
    ]);

    const report: CitabilityReport = buildCitabilityReport(
      {
        url: normalized.url,
        finalUrl,
        rawHtml: page.body ?? "",
        robots,
        llmsTxt,
        targetQuestion: input.value.question,
      },
      dependencies.now().toISOString(),
    );
    return json({ data: report }, 200);
  } catch {
    // An unexpected throw still leaves through the tool's own envelope. The
    // rule engine and the statistics both raise on impossible inputs, on
    // purpose, and a bare 500 would hand the visitor a Next.js error page with
    // no code to report and nothing to retry against.
    return fail("internal_error", 500);
  } finally {
    gate.release();
  }
}
