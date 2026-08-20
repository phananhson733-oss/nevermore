// @input  -- authenticated Agent profile-diagnosis POST plus crawl/cache dependencies
// @output -- evidence-bounded Product/ICP refresh data or stable safe errors
// @pos    -- marketing-only server boundary; it never writes app.gengrowth.ai profiles

import {
  ContextProfileError,
  crawlSiteContextProfile,
  type ContextProfileResult,
} from "@sf/sources";
import {
  normalizeSeoAuditUrl,
  type SeoAuditUrlResult,
} from "@sf/public-tools";
import { createHash } from "node:crypto";
import type { QualifyingTool } from "../credits/credits-config.ts";
import { reportFirstToolRun } from "../credits/report-first-run.ts";
import { isSameOriginPost } from "../auth/disconnect.ts";
import {
  getServerAuthenticationStatus,
  type ServerAuthenticationStatus,
} from "../auth/server-auth-status.ts";
import { extractClientIp } from "../rate-limit.ts";
import {
  readCrawlCache,
  writeCrawlCache,
  type CachedCrawl,
} from "../tools/crawl-cache.ts";
import {
  DEFAULT_CRAWL_GATE_DEPENDENCIES,
  openCrawlGate,
  type CrawlGateResult,
} from "../tools/crawl-gate.ts";
import { readPublicToolJson } from "../tools/public-tool-request.ts";
import { KeywordLlmError } from "../tools/keyword-llm-client.ts";
import type { AgentKind } from "./audit-contract.ts";
import {
  canonicalAgentLanguageTag,
  isAgentMarketCodeValid,
} from "./profile-input-validation.ts";
import {
  AGENT_PROFILE_REFRESH_SCHEMA_VERSION,
  AGENT_PROFILE_REFRESH_READY_FIELD_PATHS,
  isAgentProfileRefreshData,
  type AgentProfileRefreshData,
  type AgentProfileRefreshField,
} from "./profile-refresh-contract.ts";
import {
  PROFILE_REFRESH_PROMPT_SET_VERSION,
  synthesizeAgentProfileRefresh,
  type AgentProfileRefreshSynthesisInput,
} from "./profile-refresh-prompt.ts";

const REQUEST_BODY_LIMIT_BYTES = 4_096;
interface ProfileRefreshInput {
  readonly url: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly outputLocale: string;
  readonly mode: "prefer_cache" | "refresh";
}

interface ProfileRefreshCacheIdentity {
  readonly normalizedUrl: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly outputLocale: string;
}

export function profileRefreshCacheNamespace(
  agent: AgentKind,
  identity: ProfileRefreshCacheIdentity,
): string {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: AGENT_PROFILE_REFRESH_SCHEMA_VERSION,
        promptVersion: PROFILE_REFRESH_PROMPT_SET_VERSION,
        agent,
        ...identity,
      }),
    )
    .digest("hex");
  return `agent_profile_refresh_v1_${agent}_${fingerprint}`;
}

export interface AgentProfileRefreshHandlerDependencies {
  readonly authenticate: () => Promise<ServerAuthenticationStatus>;
  readonly isSameOriginPost: (request: Request) => boolean;
  readonly normalizeUrl: (value: unknown) => SeoAuditUrlResult;
  readonly extractClientIp: (headers: Headers) => string;
  readonly openGate: (
    clientIp: string,
    normalizedUrl: string,
    cacheProbe?: (targetHost: string) => Promise<CachedCrawl | null>,
  ) => Promise<CrawlGateResult>;
  readonly readCache: (
    namespace: string,
    targetHost: string,
  ) => Promise<CachedCrawl | null>;
  readonly writeCache: (
    namespace: string,
    targetHost: string,
    payload: unknown,
  ) => Promise<void>;
  readonly crawl: (
    url: string,
    options: { readonly targetLanguage: string; readonly signal: AbortSignal },
  ) => Promise<ContextProfileResult>;
  readonly synthesize: (
    input: AgentProfileRefreshSynthesisInput,
  ) => Promise<{ readonly fields: readonly AgentProfileRefreshField[] }>;
  /**
   * Records that a refresh completed, so a referred visitor's first qualifying
   * run can pay its reward.
   *
   * Optional and never awaited. Both success paths report, including the cache
   * hit: the visitor asked for a profile and got one, and whether someone else
   * crawled the same host minutes earlier is not something they can see or
   * control.
   */
  readonly reportFirstRun?: (tool: QualifyingTool) => void;
}

/**
 * Exported so credits/first-run-wiring.test.ts can prove the reporter is
 * actually attached in production; every handler test builds its own literal
 * deps object and would stay green if it were not.
 */
export const DEFAULT_DEPENDENCIES: AgentProfileRefreshHandlerDependencies = {
  authenticate: getServerAuthenticationStatus,
  isSameOriginPost,
  normalizeUrl: normalizeSeoAuditUrl,
  extractClientIp,
  openGate: (clientIp, normalizedUrl, cacheProbe) =>
    openCrawlGate(
      clientIp,
      normalizedUrl,
      DEFAULT_CRAWL_GATE_DEPENDENCIES,
      cacheProbe,
    ),
  readCache: (namespace, host) => readCrawlCache(namespace, host),
  writeCache: (namespace, host, payload) =>
    writeCrawlCache(namespace, host, payload),
  crawl: (url, options) => crawlSiteContextProfile(url, options),
  synthesize: (input) => synthesizeAgentProfileRefresh(input),
  reportFirstRun: reportFirstToolRun,
};

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private" },
  });
}

function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store, private");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function canonicalTimestamp(value: string): string | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function targetHost(normalizedUrl: string): string {
  try {
    return new URL(normalizedUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function cachedIdentityMatches(
  value: unknown,
  agent: AgentKind,
  normalizedUrl: string,
  input: ProfileRefreshInput,
): value is AgentProfileRefreshData {
  return (
    isAgentProfileRefreshData(value) &&
    value.agent === agent &&
    value.request.normalizedUrl === normalizedUrl &&
    value.request.targetHost === targetHost(normalizedUrl) &&
    value.request.marketCode === input.marketCode &&
    value.request.languageTag === input.languageTag &&
    value.request.outputLocale === input.outputLocale
  );
}

function availabilityOf(
  fields: readonly AgentProfileRefreshField[],
): AgentProfileRefreshData["availability"] {
  const availablePaths = new Set(
    fields
      .filter((field) => field.state === "available")
      .map((field) => field.path),
  );
  if (availablePaths.size === 0) return "no_data";
  return AGENT_PROFILE_REFRESH_READY_FIELD_PATHS.every((path) =>
    availablePaths.has(path),
  )
    ? "available"
    : "partial";
}

function contextErrorResponse(error: unknown): Response {
  if (error instanceof KeywordLlmError && error.reason === "schema_invalid") {
    return json({ error: { code: "profile_response_invalid" } }, 502);
  }
  if (!(error instanceof ContextProfileError)) {
    return json({ error: { code: "profile_source_unavailable" } }, 503);
  }
  const status: Readonly<Record<string, number>> = {
    bot_protection_blocked: 422,
    rate_limited_by_target: 429,
    protocol_downgrade_rejected: 400,
    too_few_pages: 422,
    invalid_target: 400,
    entry_unreachable: 502,
    robots_disallowed: 422,
    robots_unreachable: 422,
  };
  return json({ error: { code: error.code } }, status[error.code] ?? 503);
}

function parseInput(value: unknown): ProfileRefreshInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const object = value as Readonly<Record<string, unknown>>;
  const expected = [
    "url",
    "marketCode",
    "languageTag",
    "outputLocale",
    "mode",
  ];
  if (
    Object.keys(object).length !== expected.length ||
    !expected.every((key) => Object.hasOwn(object, key)) ||
    typeof object.url !== "string" ||
    typeof object.marketCode !== "string" ||
    typeof object.mode !== "string" ||
    !["prefer_cache", "refresh"].includes(object.mode)
  ) {
    return null;
  }
  const marketCode = object.marketCode.trim().toUpperCase();
  const languageTag = canonicalAgentLanguageTag(object.languageTag);
  const outputLocale = canonicalAgentLanguageTag(object.outputLocale);
  if (
    !isAgentMarketCodeValid(marketCode) ||
    languageTag === null ||
    (outputLocale !== "en" && outputLocale !== "zh")
  ) {
    return null;
  }
  return {
    url: object.url,
    marketCode,
    languageTag,
    outputLocale,
    mode: object.mode as ProfileRefreshInput["mode"],
  };
}

export async function handleAgentProfileRefreshRequest(
  request: Request,
  agent: AgentKind,
  dependencies: AgentProfileRefreshHandlerDependencies = DEFAULT_DEPENDENCIES,
): Promise<Response> {
  let authentication: ServerAuthenticationStatus = "unavailable";
  try {
    authentication = await dependencies.authenticate();
  } catch {
    authentication = "unavailable";
  }
  if (authentication === "unavailable") {
    return json({ error: { code: "auth_unavailable" } }, 503);
  }
  if (authentication === "unauthenticated") {
    return json({ error: { code: "auth_required" } }, 401);
  }
  if (!dependencies.isSameOriginPost(request)) {
    return json({ error: { code: "invalid_origin" } }, 403);
  }
  const body = await readPublicToolJson(request, REQUEST_BODY_LIMIT_BYTES);
  if (!body.ok) {
    const status =
      body.code === "unsupported_media_type"
        ? 415
        : body.code === "payload_too_large"
          ? 413
          : 400;
    return json({ error: { code: body.code } }, status);
  }
  const input = parseInput(body.value);
  if (input === null) return json({ error: { code: "invalid_request" } }, 400);
  const normalized = dependencies.normalizeUrl(input.url);
  if (!normalized.ok) return json({ error: { code: "invalid_url" } }, 400);
  const host = targetHost(normalized.url);
  if (host === "") return json({ error: { code: "invalid_url" } }, 400);
  const namespace = profileRefreshCacheNamespace(agent, {
    normalizedUrl: normalized.url,
    marketCode: input.marketCode,
    languageTag: input.languageTag,
    outputLocale: input.outputLocale,
  });
  const cacheProbe =
    input.mode === "prefer_cache"
      ? async (gateHost: string): Promise<CachedCrawl | null> => {
          if (gateHost !== host) return null;
          const cached = await dependencies.readCache(namespace, gateHost);
          if (
            cached === null ||
            canonicalTimestamp(cached.capturedAt) === null ||
            !cachedIdentityMatches(
              cached.payload,
              agent,
              normalized.url,
              input,
            )
          ) {
            return null;
          }
          return cached;
        }
      : undefined;
  const clientIp = dependencies.extractClientIp(request.headers);
  const gate = await dependencies.openGate(
    clientIp,
    normalized.url,
    cacheProbe,
  );
  if (!gate.ok) return privateResponse(gate.response);
  try {
    if (gate.kind === "cached") {
      const capturedAt = canonicalTimestamp(gate.capturedAt);
      if (
        capturedAt === null ||
        !cachedIdentityMatches(gate.payload, agent, normalized.url, input)
      ) {
        return json({ error: { code: "profile_response_invalid" } }, 502);
      }
      const cached: AgentProfileRefreshData = {
        ...gate.payload,
        request: {
          ...gate.payload.request,
          submittedUrl: input.url.trim(),
        },
        cache: { status: "hit", capturedAt },
      };
      if (!isAgentProfileRefreshData(cached)) {
        return json({ error: { code: "profile_response_invalid" } }, 502);
      }
      dependencies.reportFirstRun?.("profile-refresh");
      return json({ data: cached }, 200);
    }
    const crawl = await dependencies.crawl(normalized.url, {
      targetLanguage: input.languageTag.split("-")[0]?.toLowerCase() ?? "en",
      signal: request.signal,
    });
    if (crawl.stopReason === "aborted") {
      return json({ error: { code: "profile_source_unavailable" } }, 503);
    }
    const synthesis = await dependencies.synthesize({
      agent,
      marketCode: input.marketCode,
      languageTag: input.languageTag,
      outputLocale: input.outputLocale,
      pages: crawl.pages.map((page) => ({
        url: page.url,
        title: page.title,
        headings: [
          ...page.headings.h1,
          ...page.headings.h2,
          ...page.headings.h3,
        ],
        text: page.text,
      })),
    });
    const available = synthesis.fields.filter(
      (field) => field.state === "available",
    ).length;
    const data: AgentProfileRefreshData = {
      schemaVersion: AGENT_PROFILE_REFRESH_SCHEMA_VERSION,
      agent,
      request: {
        submittedUrl: input.url.trim(),
        normalizedUrl: normalized.url,
        targetHost: host,
        marketCode: input.marketCode,
        languageTag: input.languageTag,
        outputLocale: input.outputLocale,
      },
      availability: availabilityOf(synthesis.fields),
      observedAt: crawl.capturedAt,
      cache: {
        status: input.mode === "refresh" ? "refreshed" : "fresh",
        capturedAt: crawl.capturedAt,
      },
      diagnostics: {
        resolvedOrigin: crawl.origin,
        pagesFetched: crawl.pagesFetched,
        productPagesFetched: crawl.productPagesFetched,
        stopReason: crawl.stopReason,
        contextSufficient: crawl.contextSufficient,
        sourceUrls: crawl.pages.map((page) => page.url),
        fieldsAvailable: available,
        fieldsMissing: synthesis.fields.length - available,
      },
      fields: synthesis.fields,
    };
    if (!isAgentProfileRefreshData(data)) {
      return json({ error: { code: "profile_response_invalid" } }, 502);
    }
    try {
      await dependencies.writeCache(namespace, host, data);
    } catch {
      // Completed profile diagnosis remains usable when the optional cache is down.
    }
    dependencies.reportFirstRun?.("profile-refresh");
    return json({ data }, 200);
  } catch (error) {
    return contextErrorResponse(error);
  } finally {
    gate.release();
  }
}
