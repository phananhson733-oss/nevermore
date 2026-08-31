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
  CITABILITY_MAX_QUESTION_CHARS,
  type CitabilityErrorCode,
  type CitabilityReport,
  type LlmsTxtFetch,
  type RobotsFetch,
} from "./citability-contract.ts";
import {
  chargeCitabilityTarget,
  openCitabilityGate,
  type CitabilityGateResult,
} from "./citability-gate.ts";
import { buildCitabilityReport } from "./citability-rules.ts";
import { measureCitabilityRender, requestCitabilityRender } from "./citability-render.ts";
import type { CitabilityRenderEvidence, CitabilityRenderRequest } from "./citability-render-contract.ts";

const REQUEST_BODY_LIMIT_BYTES = 4_096;

/** A whitelist, so a misspelled field is refused rather than silently dropped. */
const ALLOWED_KEYS: ReadonlySet<string> = new Set(["url", "question"]);

export interface CitabilityFetchResult {
  readonly kind: "ok" | "error";
  readonly code?: string;
  readonly finalUrl?: string;
  readonly status?: number;
  readonly contentType?: string | null;
  readonly body?: string;
  /** False when the fetch layer stopped at its byte ceiling. */
  readonly bodyComplete?: boolean;
}

export interface CitabilityHandlerDependencies {
  readonly renderPage: (input: CitabilityRenderRequest) => Promise<CitabilityRenderEvidence>;
  readonly normalizeUrl: typeof normalizeSeoAuditUrl;
  readonly extractClientIp: (headers: Headers) => string;
  readonly isSignedIn: () => Promise<boolean>;
  readonly openGate: (input: {
    readonly clientIp: string;
    readonly targetHost: string;
    readonly signedIn: boolean;
  }) => Promise<CitabilityGateResult>;
  /** Charges the per-target budget again once a redirect names a new host. */
  readonly chargeTarget: (
    targetHost: string,
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly response: Response }>;
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
    // Carried, not dropped. Its own doc comment says a consumer "must not
    // infer that a tag/value is absent" from a partial body, and every
    // negative check here does exactly that.
    bodyComplete: result.bodyComplete,
  };
}

export const DEFAULT_CITABILITY_HANDLER_DEPENDENCIES: CitabilityHandlerDependencies =
  {
    renderPage: requestCitabilityRender,
    normalizeUrl: normalizeSeoAuditUrl,
    extractClientIp,
    isSignedIn: async () =>
      (await getServerAuthenticationStatus()) === "authenticated",
    openGate: (input) => openCitabilityGate(input),
    chargeTarget: (targetHost) => chargeCitabilityTarget(targetHost),
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
  if (question.length > CITABILITY_MAX_QUESTION_CHARS) return { ok: false };
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

function pageErrorCode(code: string | undefined): {
  readonly code: CitabilityErrorCode;
  readonly status: number;
} {
  // A mistyped domain and a private-network address are the visitor's input,
  // not our failure. Returning 502 for them tells the visitor their URL is
  // unsafe and files their typo as a server error in every dashboard that
  // counts 5xx.
  if (code === "timeout") return { code: "fetch_timeout", status: 504 };
  if (
    code === "blocked" ||
    code === "cross_origin" ||
    code === "invalid_redirect" ||
    code === "redirect_limit"
  ) {
    return { code: "fetch_blocked", status: 422 };
  }
  return { code: "fetch_failed", status: 502 };
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
    if (page.kind === "error") {
      const failure = pageErrorCode(page.code);
      return fail(failure.code, failure.status);
    }

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
    // The fetch layer decodes as UTF-8 unconditionally. A GB2312 or Big5 page
    // comes back as replacement characters, which then count as visible text
    // and pass the "the HTML carries the copy" check while every Chinese term
    // fails to match. Refusing is the only honest answer available here.
    const charset = /charset\s*=\s*["']?([\w-]+)/.exec(contentType)?.[1];
    if (
      charset !== undefined &&
      !["utf-8", "utf8", "us-ascii", "ascii"].includes(charset)
    ) {
      return fail("not_utf8", 422);
    }

    // A charset declared only in a <meta> tag never reaches the header, and
    // the fetch layer decodes as UTF-8 either way. What comes back is a page
    // of replacement characters, which then count as visible text and pass
    // the "the HTML carries the copy" check while every term in the visitor's
    // own language fails to match. One bad decode, two opposite lies.
    const body = page.body ?? "";
    const replacements = (body.match(/\ufffd/gu) ?? []).length;
    if (body.length > 0 && replacements / body.length > 0.02) {
      return fail("not_utf8", 422);
    }

    const finalUrl = page.finalUrl ?? normalized.url;
    const origin = new URL(finalUrl).origin;
    // The pre-flight bucket was keyed on the submitted host; a redirect moves
    // the traffic somewhere the target budget never saw.
    const landed = new URL(finalUrl).host;
    if (landed !== target.host) {
      const second = await dependencies.chargeTarget(landed);
      if (!second.ok) return second.response;
    }
    const renderInput = { url: finalUrl, rawHtml: body, bodyComplete: page.bodyComplete !== false };
    const [robots, llmsTxt, render] = await Promise.all([
      fetchRobots(origin, dependencies),
      fetchLlmsTxt(origin, dependencies),
      dependencies.renderPage(renderInput).catch(() => measureCitabilityRender(renderInput, null, { reason: "service_failed", now: dependencies.now })),
    ]);

    const report: CitabilityReport = buildCitabilityReport(
      {
        url: normalized.url,
        finalUrl,
        rawHtml: body,
        bodyComplete: page.bodyComplete !== false,
        robots,
        llmsTxt,
        targetQuestion: input.value.question,
        render,
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
