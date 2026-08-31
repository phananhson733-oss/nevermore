// @input  -- one authenticated POST asking for a content brief on a keyword
// @output -- an explicitly negotiated, self-checked v1/v2 brief or a stable error envelope
// @pos    -- shared admission and scoped reads; v2 keeps a frozen reporting window and bounded facts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { randomUUID } from "node:crypto";

import { createPublicToolError } from "@sf/public-tools/contract";
import {
  assembleContentBrief,
  buildCrawlReadMeta,
  buildMustAnswerDraft,
  buildSerpObservations,
  planCrawlTargets,
} from "@sf/public-tools/content-brief/assemble";
import {
  BRIEF_ACCOUNT_MAX_PER_HOUR,
  BRIEF_DAILY_MAX,
  BRIEF_IP_MAX_PER_HOUR,
  BRIEF_REQUEST_MAX_BYTES,
  CRAWL_DEADLINE_MS,
  DAILY_WINDOW_SECONDS,
  ENVELOPE_MS,
  GSC_DEADLINE_MS,
  GSC_LOOKBACK_DAYS,
  GSC_PAGE_ROWS_MAX,
  OUTLINE_MIN_QUESTIONS,
  PROFILE_FACT_MAX_CHARS,
  QUOTA_WINDOW_SECONDS,
  RUN_BUDGET_MS,
  SERP_DEADLINE_MS,
  SUPPORTING_KEYWORDS_MAX,
} from "@sf/public-tools/content-brief/constants";
import type {
  BriefGscPageRow,
  BriefGscQueryPageRow,
  BriefRunMeta,
  ContentBrief,
  ContentBriefErrorCode,
  CrawlObservation,
  GscReadMeta,
  ProfileFact,
  ProfileReadMeta,
  Verdict,
} from "@sf/public-tools/content-brief/contract";
import { CONTENT_BRIEF_SCHEMA } from "@sf/public-tools/content-brief/contract";
import { hostKey } from "@sf/public-tools/content-brief/host";
import { parseContentBrief } from "@sf/public-tools/content-brief/parse-brief";
import { CONTENT_BRIEF_V2_SCHEMA } from "@sf/public-tools/content-brief/v2-contract";
import { projectBriefV2Gsc } from "@sf/public-tools/content-brief/v2-gsc";
import { computeVerdict, normalizePosition } from "@sf/public-tools/content-brief/verdict";
import {
  MIN_DIMENSION_COVERAGE,
  queryPageCoverage,
  readPageRows,
  readQueryPageRows,
  readQueryRows,
  type GscPageRow,
  type GscQueryPageRow,
  type GscReadPaging,
  type QueryRowsRead,
} from "@sf/public-tools/gsc-analytics";
import { createSearchAnalyticsClient } from "@sf/sources/gsc/search-analytics";

import {
  WEBSITE_PROFILE_FIELD_NAMES,
  type MarketingWebsiteProfileV1,
  type WebsiteProfileFieldProvenance,
} from "../account-websites/contracts.ts";
import { readAccountWebsite } from "../account-websites/store.ts";
import type { GrantResolution } from "../auth/grant-cookie.ts";
import {
  getServerAuthenticatedUser,
  type ServerAuthenticatedUser,
} from "../auth/server-auth-user.ts";
import { extractClientIp } from "../rate-limit.ts";
import {
  crawlContentBriefTargets,
  type ContentBriefCrawlResult,
} from "./content-brief-crawl.ts";
import { crawlContentBriefV2Targets } from "./content-brief-v2-crawl.ts";
import {
  resolveContentBriefLlmConfig,
  runContentBriefLlm,
  type ContentBriefLlmInput,
  type ContentBriefLlmResult,
} from "./content-brief-llm.ts";
import { runContentBriefV2Llm } from "./content-brief-v2-llm.ts";
import { runContentBriefV2 } from "./content-brief-v2-run.ts";
import {
  readContentBriefSerp,
  type ContentBriefSerpResult,
} from "./content-brief-serp.ts";
import { GRANT_RETRY_AFTER_SECONDS, openGscGate, type GscGateResult } from "./gsc-gate.ts";
import { coverageWindow } from "./keyword-coverage-reader.ts";
import { readKeywordIdentity } from "./keyword-workflow-handler.ts";
import {
  acquirePublicToolSlot,
  readPublicToolJson,
  type PublicToolSlot,
} from "./public-tool-request.ts";
import {
  DEFAULT_SERP_MARKET,
  SERP_LANGUAGES,
  SERP_LOCATIONS,
} from "./serp-markets.ts";
import {
  consumePublicToolQuota,
  type PublicToolQuotaOutcome,
} from "./shared-rate-limit.ts";
import {
  readTrafficDropSession,
  resolveTrafficDropGrant,
  type TrafficDropSession,
} from "./traffic-drop-session.ts";

/**
 * Why the handler is the only place with a clock.
 *
 * One `deadlineAt` is taken on entry, before authentication, and every step —
 * admission included — is started only if budget remains and raced against
 * what is left. Lanes receive that absolute deadline and subtract the envelope
 * themselves, once. A stage that runs out returns an unavailable read; the
 * assembly step never fails as a whole. The platform kill at `maxDuration` is
 * far above the soft budget on purpose: the budget is what the page prints,
 * the kill is what erases the evidence.
 *
 * Order of admission is the order of cost: identity → body → per-account slot
 * → account / IP buckets → Search Console preflight → the SERP daily bucket,
 * consumed only when a paid SERP call is actually about to happen.
 *
 * The brief the handler emits must pass the same parser the draft side runs.
 * That self-check is the only proof that assembly and parser agree; a brief
 * that fails it is a bug, so it is never sent.
 */

const TOOL = "content-brief";
const KEYWORD_MAX_CHARS = 200;
const BRIEF_V2_PROFILE_FACT_MAX = 32;
/** Admission calls (auth, body, quota, grant) are cheap; this only stops a hung store. */
const ADMISSION_STEP_MS = 5_000;
const GSC_REQUEST_TIMEOUT_MS = 8_000;

export interface ContentBriefRequestBody {
  readonly primary: string;
  readonly supporting: readonly string[];
  readonly market: string;
  readonly language: string;
  readonly website_id: string | null;
  readonly gsc_property: string | null;
  readonly response_schema:
    | typeof CONTENT_BRIEF_SCHEMA
    | typeof CONTENT_BRIEF_V2_SCHEMA;
}

export type ProfileReadResult =
  | {
      readonly kind: "ok";
      readonly websiteId: string;
      readonly snapshotRevision: number;
      readonly profileHash: string;
      readonly profile: MarketingWebsiteProfileV1;
    }
  | { readonly kind: "not_confirmed" }
  | { readonly kind: "missing" }
  | { readonly kind: "error" };

export interface GscDimensionsInput {
  readonly property: string;
  readonly accessToken: string;
  readonly window: { readonly startDate: string; readonly endDate: string };
  readonly deadlineAt: number;
}

export interface GscDimensionsRead {
  readonly query: QueryRowsRead;
  readonly queryPage: {
    readonly rows: readonly GscQueryPageRow[];
    readonly paging: GscReadPaging;
    readonly unreadableRows: number;
  };
  readonly page: {
    readonly rows: readonly GscPageRow[];
    readonly paging: GscReadPaging;
    readonly unreadableRows: number;
  };
}

export interface ContentBriefHandlerDependencies {
  readonly getServerAuthenticatedUser: () => Promise<ServerAuthenticatedUser>;
  readonly readJson: typeof readPublicToolJson;
  readonly extractClientIp: (headers: Headers) => string;
  readonly acquireSlot: (key: string) => PublicToolSlot;
  readonly consumeQuota: (
    bucketKey: string,
    max: number,
    windowSeconds: number,
  ) => Promise<PublicToolQuotaOutcome>;
  readonly readGscSession: () => Promise<TrafficDropSession>;
  /** The Google subject in the browser's identity cookie; null when there is none. */
  readonly readGscIdentity: () => Promise<{ readonly sub: string } | null>;
  readonly openGscGate: (clientIp: string) => Promise<GscGateResult>;
  readonly resolveGscGrant: () => Promise<GrantResolution>;
  readonly readGscDimensions: (input: GscDimensionsInput) => Promise<GscDimensionsRead>;
  readonly readSerp: typeof readContentBriefSerp;
  readonly crawl: typeof crawlContentBriefTargets;
  readonly crawlV2: typeof crawlContentBriefV2Targets;
  readonly readWebsite: (userId: string, websiteId: string) => Promise<ProfileReadResult>;
  readonly runLlm: (input: ContentBriefLlmInput) => Promise<ContentBriefLlmResult>;
  readonly runLlmV2: typeof runContentBriefV2Llm;
  readonly now: () => number;
  readonly runId: () => string;
  readonly emit: (line: string) => void;
}

/* ------------------------------------------------------------------ */
/* production dependencies                                             */
/* ------------------------------------------------------------------ */

async function readWebsiteProfile(userId: string, websiteId: string): Promise<ProfileReadResult> {
  const details = await readAccountWebsite(userId, websiteId);
  if (details.kind === "missing") return { kind: "missing" };
  if (details.kind !== "ok") return { kind: "error" };
  const snapshot = details.value.currentConfirmedSnapshot;
  if (snapshot === null) return { kind: "not_confirmed" };
  return {
    kind: "ok",
    websiteId: details.value.websiteId,
    snapshotRevision: snapshot.snapshotRevision,
    profileHash: snapshot.profileHash,
    profile: snapshot.profile,
  };
}

async function readGscDimensionsLive(input: GscDimensionsInput): Promise<GscDimensionsRead> {
  const client = createSearchAnalyticsClient({
    siteUrl: input.property,
    accessToken: input.accessToken,
    requestTimeoutMs: GSC_REQUEST_TIMEOUT_MS,
    remainingMs: () => Math.max(0, input.deadlineAt - Date.now()),
  });
  const budget = { isExpired: () => Date.now() >= input.deadlineAt };
  const [query, queryPage, page] = await Promise.all([
    readQueryRows(client, input.window, budget),
    readQueryPageRows(client, input.window, budget),
    readPageRows(client, input.window, budget),
  ]);
  return { query, queryPage, page };
}

export const CONTENT_BRIEF_HANDLER_DEPENDENCIES: ContentBriefHandlerDependencies = {
  getServerAuthenticatedUser,
  readJson: readPublicToolJson,
  extractClientIp,
  acquireSlot: acquirePublicToolSlot,
  consumeQuota: (bucketKey, max, windowSeconds) => consumePublicToolQuota(bucketKey, max, windowSeconds),
  readGscSession: readTrafficDropSession,
  readGscIdentity: readKeywordIdentity,
  openGscGate: (clientIp) => openGscGate(clientIp),
  resolveGscGrant: resolveTrafficDropGrant,
  readGscDimensions: readGscDimensionsLive,
  readSerp: readContentBriefSerp,
  crawl: crawlContentBriefTargets,
  crawlV2: crawlContentBriefV2Targets,
  readWebsite: readWebsiteProfile,
  runLlm: (input) => runContentBriefLlm(input, { config: resolveContentBriefLlmConfig() }),
  runLlmV2: (input) => runContentBriefV2Llm(input, { config: resolveContentBriefLlmConfig() }),
  now: () => Date.now(),
  runId: () => randomUUID(),
  emit: (line) => console.info(line),
};

/* ------------------------------------------------------------------ */
/* request                                                              */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeKeyword(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

export type ParsedBody =
  | { readonly ok: true; readonly value: ContentBriefRequestBody }
  | { readonly ok: false; readonly code: ContentBriefErrorCode };

const ALLOWED_BODY_KEYS: ReadonlySet<string> = new Set([
  "primary",
  "supporting",
  "market",
  "language",
  "website_id",
  "gsc_property",
  "response_schema",
]);

function optionalString(value: unknown): string | null | false {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "") return false;
  return value.trim();
}

export function parseContentBriefRequest(input: unknown): ParsedBody {
  if (!isRecord(input)) return { ok: false, code: "invalid_request" };
  if (Object.keys(input).some((key) => !ALLOWED_BODY_KEYS.has(key))) {
    return { ok: false, code: "invalid_request" };
  }
  const responseSchemaRaw = input["response_schema"];
  if (
    responseSchemaRaw !== undefined &&
    responseSchemaRaw !== CONTENT_BRIEF_SCHEMA &&
    responseSchemaRaw !== CONTENT_BRIEF_V2_SCHEMA
  ) {
    return { ok: false, code: "invalid_request" };
  }
  const primaryRaw = input["primary"];
  if (typeof primaryRaw !== "string") return { ok: false, code: "invalid_request" };
  const primary = normalizeKeyword(primaryRaw);
  if (primary === "" || primary.length > KEYWORD_MAX_CHARS) {
    return { ok: false, code: "invalid_request" };
  }
  const supportingRaw = input["supporting"] ?? [];
  if (!Array.isArray(supportingRaw) || supportingRaw.some((item) => typeof item !== "string")) {
    return { ok: false, code: "invalid_request" };
  }
  const supportingIdentities = new Set([normalizeKeyword(primary.normalize("NFKC")).toLowerCase()]);
  const supporting = [
    ...new Set(
      (supportingRaw as readonly string[])
        .map(normalizeKeyword)
        .filter((item) => item !== "" && item.length <= KEYWORD_MAX_CHARS),
    ),
  ].filter((keyword) => {
    if (responseSchemaRaw !== CONTENT_BRIEF_V2_SCHEMA) return true;
    const identity = normalizeKeyword(keyword.normalize("NFKC")).toLowerCase();
    if (supportingIdentities.has(identity)) return false;
    supportingIdentities.add(identity);
    return true;
  });
  if (supporting.length > SUPPORTING_KEYWORDS_MAX) {
    return { ok: false, code: "too_many_supporting_keywords" };
  }
  const marketRaw = input["market"] ?? DEFAULT_SERP_MARKET;
  if (typeof marketRaw !== "string") return { ok: false, code: "invalid_request" };
  const market = marketRaw.toUpperCase();
  if (!(market in SERP_LOCATIONS)) return { ok: false, code: "unsupported_market" };
  const languageRaw = input["language"];
  if (typeof languageRaw !== "string") return { ok: false, code: "invalid_request" };
  const language = languageRaw.toLowerCase();
  if (!SERP_LANGUAGES.has(language)) return { ok: false, code: "unsupported_language" };
  const websiteId = optionalString(input["website_id"]);
  const property = optionalString(input["gsc_property"]);
  if (websiteId === false || property === false) return { ok: false, code: "invalid_request" };
  return {
    ok: true,
    value: {
      primary,
      supporting,
      market,
      language,
      website_id: websiteId,
      gsc_property: property,
      response_schema: responseSchemaRaw === CONTENT_BRIEF_V2_SCHEMA ? CONTENT_BRIEF_V2_SCHEMA : CONTENT_BRIEF_SCHEMA,
    },
  };
}

/* ------------------------------------------------------------------ */
/* profile facts                                                        */
/* ------------------------------------------------------------------ */

const EXCLUDED_PROFILE_FIELDS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "fieldProvenance",
  "country",
  "locale",
]);

/**
 * Deterministic: field order is the contract's, so the same snapshot always
 * yields the same P* ids, which is what lets the fingerprint cover them.
 * Inferred fields are the profile generator's own model output and keep that
 * provenance; they can support a stance, never a bound claim.
 */
export function profileFacts(profile: MarketingWebsiteProfileV1): ProfileFact[] {
  const provenance = new Map(profile.fieldProvenance.map((entry) => [entry.path, entry] as const));
  const facts: ProfileFact[] = [];
  const push = (field: string, text: string, derivation: WebsiteProfileFieldProvenance["derivation"]) => {
    const trimmed = text.trim();
    if (trimmed === "" || derivation === "missing") return;
    const id = `P${facts.length + 1}`;
    const clipped = trimmed.length > PROFILE_FACT_MAX_CHARS ? trimmed.slice(0, PROFILE_FACT_MAX_CHARS) : trimmed;
    facts.push(
      derivation === "inferred"
        ? { id, field, text: clipped, derivation, provenance: { method: "model", derived_from: ["product_profile"] } }
        : { id, field, text: clipped, derivation, provenance: { method: "observed", origin: "product_profile" } },
    );
  };
  for (const name of WEBSITE_PROFILE_FIELD_NAMES) {
    if (EXCLUDED_PROFILE_FIELDS.has(name)) continue;
    const derivation = provenance.get(`/${name}`)?.derivation ?? "missing";
    if (derivation === "missing") continue;
    const value = (profile as unknown as Record<string, unknown>)[name];
    if (typeof value === "string") {
      push(name, value, derivation);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === "string") push(`${name}[${index}]`, item, derivation);
      });
    }
  }
  return facts;
}

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store, private", ...headers } });
}

function refuse(code: ContentBriefErrorCode, status: number, headers?: Record<string, string>): Response {
  return json(createPublicToolError(code), status, headers);
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

const TIMED_OUT: unique symbol = Symbol("timed-out");
type TimedOut = typeof TIMED_OUT;

/**
 * Starts `work` only if budget remains, then races it against that budget.
 * The loser keeps running — nothing here can cancel a store call — but it no
 * longer holds the request. `onLate` runs if a timed-out call settles after
 * all, which is how a late gate acquisition is released instead of leaked.
 */
async function withBudget<T>(
  work: () => Promise<T>,
  timeoutMs: number,
  onLate?: (value: T) => void,
): Promise<T | TimedOut> {
  if (timeoutMs <= 0) return TIMED_OUT;
  const pending = work();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const timeout = new Promise<TimedOut>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  try {
    const outcome = await Promise.race([pending, timeout]);
    settled = outcome !== TIMED_OUT;
    return outcome;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (!settled) {
      pending.then(
        (value) => onLate?.(value),
        () => undefined,
      );
    }
  }
}

interface Clock {
  readonly start: number;
  readonly deadlineAt: number;
  readonly now: () => number;
}

/** What a stage may still spend: its own cap, or the run's remainder minus the envelope. */
function remaining(clock: Clock, cap: number): number {
  return Math.max(0, Math.min(cap, clock.deadlineAt - clock.now() - ENVELOPE_MS));
}

/* ------------------------------------------------------------------ */
/* handler                                                              */
/* ------------------------------------------------------------------ */

export async function handleContentBriefRequest(
  request: Request,
  dependencies: ContentBriefHandlerDependencies = CONTENT_BRIEF_HANDLER_DEPENDENCIES,
): Promise<Response> {
  const start = dependencies.now();
  const clock: Clock = { start, deadlineAt: start + RUN_BUDGET_MS, now: dependencies.now };

  const authentication = await withBudget(
    () => dependencies.getServerAuthenticatedUser().catch((): ServerAuthenticatedUser => ({ status: "unavailable" })),
    remaining(clock, ADMISSION_STEP_MS),
  );
  if (authentication === TIMED_OUT || authentication.status === "unavailable") {
    return refuse("auth_unavailable", 503);
  }
  if (authentication.status === "unauthenticated") return refuse("auth_required", 401);
  const { userId } = authentication;

  const body = await withBudget(() => dependencies.readJson(request, BRIEF_REQUEST_MAX_BYTES), remaining(clock, ADMISSION_STEP_MS));
  if (body === TIMED_OUT) return refuse("invalid_request", 400);
  if (!body.ok) {
    const status = body.code === "payload_too_large" ? 413 : body.code === "unsupported_media_type" ? 415 : 400;
    return refuse(body.code, status);
  }
  const parsed = parseContentBriefRequest(body.value);
  if (!parsed.ok) return refuse(parsed.code, 400);
  const input = parsed.value;

  const slot = dependencies.acquireSlot(`${TOOL}:account:${userId}`);
  if (!slot.acquired) return refuse("scan_in_progress", 409, { "Retry-After": "5" });
  try {
    const clientIp = dependencies.extractClientIp(request.headers);
    const refusal = await admit(dependencies, clock, userId, clientIp);
    if (refusal !== null) return refusal;

    const gsc =
      input.gsc_property === null
        ? null
        : await preflightGsc(dependencies, clock, clientIp, authentication.googleSubject ?? null, input.gsc_property);
    if (gsc !== null && gsc.kind === "refused") return gsc.response;
    try {
      // The SERP daily bucket is consumed last: only a run that is about to
      // place a paid call may spend from it, never a refused preflight.
      const daily = await consumeDaily(dependencies, clock);
      if (daily !== null) return daily;

      const brief = input.response_schema === CONTENT_BRIEF_V2_SCHEMA
        ? await runBriefV2(input, userId, dependencies, clock, gsc)
        : await runBrief(input, userId, dependencies, clock, gsc);
      return brief === null ? refuse("brief_unavailable", 503) : json(brief, 200);
    } catch (error: unknown) {
      // Anything that escaped the lanes is a bug, not a visitor problem: log
      // the class, never the message, and answer with a closed code.
      dependencies.emit(JSON.stringify({ tool: TOOL, unhandled: error instanceof Error ? error.name : typeof error }));
      return refuse("brief_unavailable", 503);
    } finally {
      if (gsc !== null && gsc.kind === "ready") gsc.release();
    }
  } finally {
    slot.release();
  }
}

async function consumeBucket(
  dependencies: ContentBriefHandlerDependencies,
  clock: Clock,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<Response | null> {
  const outcome = await withBudget(() => dependencies.consumeQuota(key, max, windowSeconds), remaining(clock, ADMISSION_STEP_MS));
  if (outcome === TIMED_OUT || outcome.kind === "unavailable") return refuse("quota_unavailable", 503);
  if (outcome.kind === "limited") {
    return refuse("rate_limited", 429, { "Retry-After": String(outcome.retryAfterSeconds) });
  }
  return null;
}

async function admit(
  dependencies: ContentBriefHandlerDependencies,
  clock: Clock,
  userId: string,
  clientIp: string,
): Promise<Response | null> {
  return (
    (await consumeBucket(dependencies, clock, `public-${TOOL}:account:${userId}`, BRIEF_ACCOUNT_MAX_PER_HOUR, QUOTA_WINDOW_SECONDS)) ??
    (await consumeBucket(dependencies, clock, `public-${TOOL}:ip:${clientIp}`, BRIEF_IP_MAX_PER_HOUR, QUOTA_WINDOW_SECONDS))
  );
}

function consumeDaily(dependencies: ContentBriefHandlerDependencies, clock: Clock): Promise<Response | null> {
  return consumeBucket(dependencies, clock, `public-${TOOL}:daily:${utcDay(clock.now())}`, BRIEF_DAILY_MAX, DAILY_WINDOW_SECONDS);
}

type GscPreflight =
  | { readonly kind: "ready"; readonly property: string; readonly accessToken: string; readonly release: () => void }
  | { readonly kind: "refused"; readonly response: Response };

/**
 * Mirrors the competitor-gap preflight, plus the identity bridge the keyword
 * tool enforces: the signed-in account's Google subject must be the subject
 * that granted Search Console access, or account A's private profile would be
 * combined with account B's search data. Property must be in the visitor's
 * cookie, the shared GSC gate is consumed once per run (never per call), and
 * the grant must still be usable. All of it before the first paid call.
 */
async function preflightGsc(
  dependencies: ContentBriefHandlerDependencies,
  clock: Clock,
  clientIp: string,
  googleSubject: string | null,
  property: string,
): Promise<GscPreflight> {
  const refused = (code: ContentBriefErrorCode, status: number, headers?: Record<string, string>): GscPreflight => ({
    kind: "refused",
    response: refuse(code, status, headers),
  });
  const identity = await withBudget(() => dependencies.readGscIdentity(), remaining(clock, ADMISSION_STEP_MS));
  if (identity === TIMED_OUT) return refused("quota_unavailable", 503);
  if (identity === null || googleSubject === null || googleSubject === "" || googleSubject !== identity.sub) {
    return refused("gsc_auth_required", 401);
  }
  const session = await withBudget(() => dependencies.readGscSession(), remaining(clock, ADMISSION_STEP_MS));
  if (session === TIMED_OUT) return refused("quota_unavailable", 503);
  if (session.properties === null || !session.properties.includes(property)) {
    return refused("property_not_granted", 403);
  }
  const gate = await withBudget(
    () => dependencies.openGscGate(clientIp),
    remaining(clock, ADMISSION_STEP_MS),
    (late) => {
      if (late.ok) late.release();
    },
  );
  if (gate === TIMED_OUT) return refused("quota_unavailable", 503);
  if (!gate.ok) return { kind: "refused", response: gate.response };
  let transferred = false;
  try {
    const grant = await withBudget(() => dependencies.resolveGscGrant(), remaining(clock, ADMISSION_STEP_MS));
    if (grant === TIMED_OUT) return refused("quota_unavailable", 503);
    if (grant.kind === "unavailable") {
      return refused("gsc_temporarily_unavailable", 503, { "Retry-After": String(GRANT_RETRY_AFTER_SECONDS) });
    }
    if (grant.kind !== "grant") return refused("gsc_revoked", 401);
    if (!grant.properties.includes(property)) return refused("property_not_granted", 403);
    transferred = true;
    return { kind: "ready", property, accessToken: grant.accessToken, release: gate.release };
  } finally {
    if (!transferred) gate.release();
  }
}

/* ------------------------------------------------------------------ */
/* reads                                                                */
/* ------------------------------------------------------------------ */

async function readProfile(
  input: ContentBriefRequestBody,
  userId: string,
  dependencies: ContentBriefHandlerDependencies,
  clock: Clock,
): Promise<{ reads: ProfileReadMeta; facts: ProfileFact[] | null }> {
  if (input.website_id === null) {
    return { reads: { status: "unavailable", reason: "not_requested", attempted: null }, facts: null };
  }
  const websiteId = input.website_id;
  const result = await withBudget(
    () => dependencies.readWebsite(userId, websiteId).catch((): ProfileReadResult => ({ kind: "error" })),
    remaining(clock, CRAWL_DEADLINE_MS),
  );
  if (result === TIMED_OUT) {
    return { reads: { status: "unavailable", reason: "timeout", attempted: 1 }, facts: null };
  }
  if (result.kind === "ok") {
    return {
      reads: {
        status: "complete",
        website_id: result.websiteId,
        snapshot_revision: result.snapshotRevision,
        profile_hash: result.profileHash,
      },
      facts: profileFacts(result.profile),
    };
  }
  const reason = result.kind === "error" ? "provider_error" : "insufficient_evidence";
  return { reads: { status: "unavailable", reason, attempted: 1 }, facts: null };
}

interface GscLane {
  readonly reads: GscReadMeta;
  readonly verdict: Verdict;
  readonly queryPage: BriefGscQueryPageRow[];
  readonly pages: BriefGscPageRow[];
}

const GSC_NOT_REQUESTED: GscLane = {
  reads: { status: "unavailable", reason: "not_requested", attempted: null },
  verdict: { action: "undecidable", reason: "no_gsc_property", provenance: null },
  queryPage: [],
  pages: [],
};

function briefV2Window(now: number) {
  const window = coverageWindow(new Date(now));
  return {
    start: window.startDate,
    end: window.endDate,
    lookback_days: GSC_LOOKBACK_DAYS,
  } as const;
}

async function readProfileV2Lane(
  userId: string,
  websiteId: string,
  dependencies: ContentBriefHandlerDependencies,
): Promise<{
  readonly facts: readonly ProfileFact[];
  readonly snapshot: { readonly website_id: string; readonly revision: number; readonly hash: string } | null;
  readonly read: {
    readonly source: "profile";
    readonly status: "complete" | "partial" | "unavailable";
    readonly attempted: number | null;
    readonly retained: number | null;
    readonly reason: "provider_error" | "insufficient_evidence" | null;
  };
}> {
  const result = await dependencies.readWebsite(userId, websiteId).catch(
    (): ProfileReadResult => ({ kind: "error" }),
  );
  if (result.kind !== "ok" || result.websiteId !== websiteId) {
    return {
      facts: [],
      snapshot: null,
      read: {
        source: "profile",
        status: "unavailable",
        attempted: null,
        retained: null,
        reason: result.kind === "error" || result.kind === "ok" ? "provider_error" : "insufficient_evidence",
      },
    };
  }
  const allFacts = profileFacts(result.profile);
  const facts = allFacts.slice(0, BRIEF_V2_PROFILE_FACT_MAX);
  return {
    facts,
    snapshot: {
      website_id: result.websiteId,
      revision: result.snapshotRevision,
      hash: result.profileHash,
    },
    read: {
      source: "profile",
      status: facts.length < allFacts.length ? "partial" : "complete",
      attempted: allFacts.length,
      retained: facts.length,
      reason: null,
    },
  };
}

async function readGscV2Lane(
  input: ContentBriefRequestBody,
  gsc: Extract<GscPreflight, { kind: "ready" }>,
  dependencies: ContentBriefHandlerDependencies,
  deadlineAt: number,
  window: ReturnType<typeof briefV2Window>,
): Promise<ReturnType<typeof projectBriefV2Gsc>> {
  const read = await dependencies.readGscDimensions({
    property: gsc.property,
    accessToken: gsc.accessToken,
    window: { startDate: window.start, endDate: window.end },
    deadlineAt,
  });
  const partial = [read.query, read.queryPage, read.page].some((lane) => lane.paging.truncated || lane.unreadableRows > 0);
  return projectBriefV2Gsc({
    input: {
      primary: input.primary,
      supporting: input.supporting,
      market: input.market,
      language: input.language,
    },
    property: gsc.property,
    window,
    status: partial ? "partial" : "complete",
    rows: read.queryPage.rows,
    pages: read.page.rows,
  });
}

function gscUnavailable(reason: "timeout" | "provider_error"): GscLane {
  return {
    reads: { status: "unavailable", reason, attempted: 1 },
    verdict: { action: "undecidable", reason: "gsc_unavailable", provenance: { method: "heuristic", origin: "gsc" } },
    queryPage: [],
    pages: [],
  };
}

async function readGsc(
  gsc: Extract<GscPreflight, { kind: "ready" }> | null,
  input: ContentBriefRequestBody,
  dependencies: ContentBriefHandlerDependencies,
  clock: Clock,
): Promise<GscLane> {
  if (gsc === null) return GSC_NOT_REQUESTED;
  const budgetMs = remaining(clock, GSC_DEADLINE_MS);
  const window = coverageWindow(new Date(clock.now()));
  const read = await withBudget(
    () =>
      dependencies
        .readGscDimensions({ property: gsc.property, accessToken: gsc.accessToken, window, deadlineAt: clock.now() + budgetMs })
        .then((value): GscDimensionsRead | Error => value, (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)))),
    budgetMs,
  );
  if (read === TIMED_OUT) return gscUnavailable("timeout");
  if (read instanceof Error) return gscUnavailable("provider_error");

  const coverage = queryPageCoverage(read.query.rows, read.queryPage.rows);
  const result = computeVerdict({
    primary: input.primary,
    queryRows: read.query.rows,
    queryPageRows: read.queryPage.rows,
    queryPagingTruncated: read.query.paging.truncated,
    queryUnreadableRows: read.query.unreadableRows,
    coverageOf: (query) => coverage.get(query),
    minDimensionCoverage: MIN_DIMENSION_COVERAGE,
  });
  const truncated: ("query" | "query_page" | "page")[] = [];
  if (read.query.paging.truncated) truncated.push("query");
  if (read.queryPage.paging.truncated) truncated.push("query_page");
  if (read.page.paging.truncated) truncated.push("page");
  const unreadable = {
    query: read.query.unreadableRows,
    query_page: read.queryPage.unreadableRows,
    page: read.page.unreadableRows,
  };
  const rows = { query: read.query.rows.length, query_page: read.queryPage.rows.length, page: read.page.rows.length };
  const pages: BriefGscPageRow[] = [...read.page.rows]
    .sort((a, b) => b.impressions - a.impressions || (a.page < b.page ? -1 : a.page > b.page ? 1 : 0))
    .slice(0, GSC_PAGE_ROWS_MAX)
    .map((row, index) => ({
      id: `G${index + 1}`,
      page: row.page,
      clicks: row.clicks,
      impressions: row.impressions,
      position: normalizePosition(row.position),
    }));
  return {
    reads: {
      status: truncated.length > 0 || Object.values(unreadable).some((count) => count > 0) ? "partial" : "complete",
      property: gsc.property,
      window: { start: window.startDate, end: window.endDate, lookback_days: GSC_LOOKBACK_DAYS },
      matched_queries: result.matchedQueries,
      primary_coverage: result.primaryCoverage,
      truncated,
      rows,
      unreadable_rows: unreadable,
    },
    verdict: result.verdict,
    queryPage: result.ledgerRows,
    pages,
  };
}

/* ------------------------------------------------------------------ */
/* run                                                                  */
/* ------------------------------------------------------------------ */

interface RunLogLine {
  readonly tool: typeof TOOL;
  readonly run_id: string;
  readonly mode: string;
  readonly elapsed_ms: number;
  readonly reads: Record<string, string>;
  readonly llm_calls: number;
  /** SERP provider charge only; LLM spend is tracked as tokens on `reads.llm`. */
  readonly serp_cost_usd: number | null;
  readonly self_check: "ok" | "recovered" | "failed";
}

const SERP_TIMED_OUT: ContentBriefSerpResult = {
  rows: [],
  reads: { status: "unavailable", reason: "timeout", attempted: 0 },
  costUsd: null,
  itemTypes: null,
};

async function runBrief(
  input: ContentBriefRequestBody,
  userId: string,
  dependencies: ContentBriefHandlerDependencies,
  clock: Clock,
  gsc: Extract<GscPreflight, { kind: "ready" }> | null,
): Promise<ContentBrief | null> {
  const runId = dependencies.runId();
  const collectedAt = new Date(clock.start).toISOString();

  // A1 SERP, A2 GSC and A3 profile run in parallel; crawl starts when A1 is back.
  const serpBudget = remaining(clock, SERP_DEADLINE_MS);
  const serpController = new AbortController();
  const serpPromise = withBudget(() => {
    const timer = setTimeout(() => serpController.abort(), serpBudget);
    return dependencies
      .readSerp({ keyword: input.primary, market: input.market, language: input.language, signal: serpController.signal })
      .finally(() => clearTimeout(timer));
  }, serpBudget);
  const gscPromise = readGsc(gsc, input, dependencies, clock);
  const profilePromise = readProfile(input, userId, dependencies, clock);

  const serpOutcome = await serpPromise;
  const serp = serpOutcome === TIMED_OUT ? SERP_TIMED_OUT : serpOutcome;
  const serpObservations = buildSerpObservations(serp.rows);
  const plan = planCrawlTargets(serpObservations, hostKey);
  const crawlStarted = serp.reads.status !== "unavailable";
  let crawl: ContentBriefCrawlResult = { observed: [], failed: [] };
  if (crawlStarted && plan.targets.length > 0) {
    // The lane receives the run's absolute deadline and subtracts the envelope itself, once.
    crawl = await dependencies.crawl({ targets: plan.targets, deadlineAt: clock.deadlineAt, language: input.language });
  }
  const crawlReads = buildCrawlReadMeta({
    serpReturned: serp.reads.status === "unavailable" ? 0 : serp.reads.returned,
    observed: crawl.observed,
    failed: crawl.failed,
    skipped: plan.skipped,
    started: crawlStarted,
  });
  const [gscLane, profile] = await Promise.all([gscPromise, profilePromise]);

  // Step 5: local derivation.
  const mustAnswer = buildMustAnswerDraft({ serp: serpObservations, observed: crawl.observed, crawlReads, language: input.language });

  // Step 6: the one LLM call. A gap angle needs competitors to be absent from,
  // so without observed pages the profile facts are not offered to the model.
  const facts = profile.facts !== null && profile.facts.length > 0 && crawl.observed.length > 0 ? profile.facts : null;
  const gscPages = gscLane.pages.length > 0 ? gscLane.pages : null;
  const questions = mustAnswer.selected.map((cluster) => ({
    id: cluster.id,
    canonical_heading: cluster.canonical_heading,
    members: [...cluster.members],
    excerpts: excerptsFor(cluster.members.map((member) => member.observation_id), crawl.observed),
  }));
  const llm = await dependencies.runLlm({
    primary: input.primary,
    supporting: input.supporting,
    language: input.language,
    questions,
    requestOutline: questions.length >= OUTLINE_MIN_QUESTIONS,
    facts,
    gscPages,
    observedIds: crawl.observed.map((page) => page.id),
    observedPages: crawl.observed.map((page) => ({ id: page.id, url: page.final_url, h2: page.h2 })),
    deadlineAt: clock.deadlineAt,
  });

  const assemble = (output: ContentBriefLlmResult["output"], llmReads: ContentBriefLlmResult["reads"]) =>
    assembleContentBrief({
      run: { run_id: runId, collected_at: collectedAt, elapsed_ms: Math.max(0, clock.now() - clock.start), budget_ms: RUN_BUDGET_MS },
      keyword: { primary: input.primary, supporting: [...input.supporting], market: input.market, language: input.language },
      reads: {
        serp: serp.reads,
        crawl: crawlReads,
        gsc: gscLane.reads,
        product_profile: profile.reads,
        llm: llmReads,
      } satisfies BriefRunMeta["reads"],
      serp: serpObservations,
      crawl: { observed: crawl.observed, failed: crawl.failed, skipped: plan.skipped },
      profileFacts: profile.facts,
      gscQueryPage: gscLane.queryPage,
      gscPages: gscLane.pages,
      verdict: gscLane.verdict,
      mustAnswer,
      model: { output },
    });

  // Self-check: the brief must survive the draft side's parser. If the model's
  // answer is what broke it, drop the answer and say so; if the evidence
  // itself cannot be represented, that is a bug and nothing is sent.
  let brief = await assemble(llm.output, llm.reads);
  let selfCheck: RunLogLine["self_check"] = "ok";
  let check = await parseContentBrief(brief);
  if (!check.ok && llm.output !== null) {
    dependencies.emit(JSON.stringify({ tool: TOOL, run_id: runId, self_check_failed: check.path, code: check.code, retry: "without_model" }));
    brief = await assemble(null, {
      status: "unavailable",
      reason: "validation_failed",
      attempted: 1,
      calls: llm.reads.calls,
      model_id: llm.reads.model_id,
      input_tokens: llm.reads.input_tokens,
      output_tokens: llm.reads.output_tokens,
    });
    check = await parseContentBrief(brief);
    selfCheck = "recovered";
  }
  if (!check.ok) {
    dependencies.emit(JSON.stringify({ tool: TOOL, run_id: runId, self_check_failed: check.path, code: check.code, retry: "none" }));
    selfCheck = "failed";
  }

  const line: RunLogLine = {
    tool: TOOL,
    run_id: runId,
    mode: brief.run.mode,
    elapsed_ms: brief.run.elapsed_ms,
    reads: Object.fromEntries(Object.entries(brief.run.reads).map(([name, read]) => [name, read.status])),
    llm_calls: llm.reads.calls,
    serp_cost_usd: serp.costUsd,
    self_check: selfCheck,
  };
  dependencies.emit(JSON.stringify(line));
  return selfCheck === "failed" ? null : brief;
}

async function runBriefV2(
  input: ContentBriefRequestBody,
  userId: string,
  dependencies: ContentBriefHandlerDependencies,
  clock: Clock,
  gsc: Extract<GscPreflight, { kind: "ready" }> | null,
) {
  const gscWindow = briefV2Window(clock.start);
  const brief = await runContentBriefV2(
    {
      input: {
        primary: input.primary,
        supporting: input.supporting,
        market: input.market,
        language: input.language,
      },
      runId: dependencies.runId(),
      startedAt: clock.start,
      deadlineAt: clock.deadlineAt,
      gsc: gsc === null
        ? undefined
        : {
            property: gsc.property,
            window: gscWindow,
            read: ({ deadlineAt }) => readGscV2Lane(input, gsc, dependencies, deadlineAt, gscWindow),
          },
      profile: input.website_id === null
        ? undefined
        : {
            read: () => readProfileV2Lane(userId, input.website_id!, dependencies),
          },
    },
    {
      readSerp: dependencies.readSerp,
      crawl: dependencies.crawlV2,
      runLlm: dependencies.runLlmV2,
      now: dependencies.now,
    },
  );
  const requestedReads = brief.run.reads.filter((read) => read.reason !== "not_requested");
  const mode = brief.generated === null && requestedReads.every((read) => read.status === "unavailable") ? "unavailable"
    : brief.generated === null || requestedReads.some((read) => read.status === "unavailable") ? "degraded"
    : requestedReads.some((read) => read.status === "partial") ? "partial" : "complete";
  dependencies.emit(JSON.stringify({
    tool: TOOL,
    run_id: brief.run.run_id,
    mode,
    elapsed_ms: brief.run.elapsed_ms,
    reads: Object.fromEntries(brief.run.reads.map((read) => [read.source, read.status])),
    llm_calls: brief.run.llm.calls,
    serp_cost_usd: brief.run.serp_cost_usd,
    self_check: "ok",
    schema: brief.schema,
  }));
  return brief;
}

function excerptsFor(
  observationIds: readonly string[],
  observed: readonly CrawlObservation[],
): { observation_id: string; heading: string; text: string }[] {
  const wanted = new Set(observationIds);
  const result: { observation_id: string; heading: string; text: string }[] = [];
  for (const page of observed) {
    if (!wanted.has(page.id)) continue;
    for (const excerpt of page.excerpts) {
      result.push({ observation_id: page.id, heading: excerpt.heading, text: excerpt.text });
    }
  }
  return result;
}
