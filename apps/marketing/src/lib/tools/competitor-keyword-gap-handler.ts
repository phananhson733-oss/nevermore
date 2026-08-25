// @input  -- one authenticated competitor-keyword-gap request
// @output -- a private result envelope or stable public error code
// @pos    -- Marketing orchestration boundary for the standalone gap tool

import {
  buildCompetitorKeywordGapReport,
  COMPETITOR_KEYWORD_GAP_MAX_COMPETITOR_RANK,
  COMPETITOR_KEYWORD_GAP_PROVIDER_LIMIT,
  COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION,
  createPublicToolError,
  keywordCoverageProperty,
  normalizeCompetitorKeywordGapDomain,
  parseCompetitorKeywordGapInput,
  type CompetitorKeywordGapDataForSeoResult,
  type CompetitorKeywordGapErrorCode,
  type CompetitorKeywordGapGscRead,
  type CompetitorKeywordGapSampleRule,
  type KeywordCoverageRead,
} from "@sf/public-tools";
import {
  HttpDataForSeoClient,
  resolveDataForSeoMarket,
  type DataForSeoDomainIntersectionClient,
  type DataForSeoDomainIntersectionResponse,
  type DataForSeoMarketResolution,
} from "@sf/sources";

import {
  getServerAuthenticatedUser,
  type ServerAuthenticatedUser,
} from "../auth/server-auth-user.ts";
import type { GrantResolution } from "../auth/grant-cookie.ts";
import { extractClientIp } from "../rate-limit.ts";
import {
  openGscGate,
  refuseWithoutGrant,
  type GscGateResult,
} from "./gsc-gate.ts";
import { createKeywordCoverageReader } from "./keyword-coverage-reader.ts";
import {
  acquirePublicToolSlot,
  readPublicToolJson,
  type PublicToolJsonResult,
  type PublicToolSlot,
} from "./public-tool-request.ts";
import {
  readTrafficDropSession,
  resolveTrafficDropGrant,
  type TrafficDropSession,
} from "./traffic-drop-session.ts";

const REQUEST_BODY_LIMIT_BYTES = 4_096;
/**
 * The paid sample this handler asks the provider for. Echoed verbatim into
 * the envelope so the surface states what was sampled, never what it wishes
 * had been sampled.
 */
const SAMPLE_RULE: CompetitorKeywordGapSampleRule = Object.freeze({
  maxCompetitorRank: COMPETITOR_KEYWORD_GAP_MAX_COMPETITOR_RANK,
  perCompetitorLimit: COMPETITOR_KEYWORD_GAP_PROVIDER_LIMIT,
  serpSnapshotRequested: true,
});

interface DataForSeoCredentials {
  readonly login: string;
  readonly password: string;
}

export interface CompetitorKeywordGapFinalLog {
  readonly status: "complete" | "partial" | "unavailable";
  readonly requestedCompetitors: number;
  readonly completedCompetitors: number;
  readonly unavailableCompetitors: number;
  readonly rowCount: number;
  readonly costUsd: number | null;
  /**
   * `refused` is distinct from `unavailable`: the run never happened and
   * nothing was spent, so it must not be counted as a degraded delivery.
   */
  readonly gsc:
    | "not_requested"
    | "available"
    | "partial"
    | "unavailable"
    | "refused";
  readonly reportProduced: boolean;
}

export interface CompetitorKeywordGapHandlerDependencies {
  readonly getServerAuthenticatedUser: () => Promise<ServerAuthenticatedUser>;
  readonly readJson: (
    request: Request,
    maxBytes: number,
  ) => Promise<PublicToolJsonResult>;
  readonly resolveMarket: (
    marketCode: unknown,
    preferredLanguage?: unknown,
  ) => DataForSeoMarketResolution | null;
  readonly credentials: () => DataForSeoCredentials | null;
  readonly createProvider: (
    credentials: DataForSeoCredentials,
  ) => DataForSeoDomainIntersectionClient;
  readonly extractClientIp: (headers: Headers) => string;
  readonly acquireSlot: (key: string) => PublicToolSlot;
  readonly readGscSession: () => Promise<TrafficDropSession>;
  readonly openGscGate: (clientIp: string) => Promise<GscGateResult>;
  readonly resolveGscGrant: () => Promise<GrantResolution>;
  readonly readCoverageQueries: (input: {
    readonly property: string;
    readonly accessToken: string;
  }) => Promise<KeywordCoverageRead>;
  readonly now: () => Date;
  /** Sanitized final run telemetry only. */
  readonly log: (record: CompetitorKeywordGapFinalLog) => void;
}

function providerCredentials(): DataForSeoCredentials | null {
  const login = process.env["DATAFORSEO_LOGIN"]?.trim() ?? "";
  const password = process.env["DATAFORSEO_PASSWORD"]?.trim() ?? "";
  return login === "" || password === "" ? null : { login, password };
}

function defaultLog(record: CompetitorKeywordGapFinalLog): void {
  console.info(JSON.stringify({ event: "competitor_keyword_gap", ...record }));
}

function inflightKey(userId: string): string {
  return `tools:competitor-keyword-gap:inflight:${userId}`;
}

function completedProviderResult(
  domain: string,
  response: DataForSeoDomainIntersectionResponse,
): CompetitorKeywordGapDataForSeoResult {
  return {
    domain,
    status: "complete",
    rows: response.rows.flatMap((row) =>
      row.firstDomainRank === null
        ? []
        : [
            {
              keyword: row.keyword,
              searchVolume: row.searchVolume,
              cpc: row.cpc,
              keywordDifficulty: row.keywordDifficulty,
              providerIntent: row.providerIntent,
              firstDomainRank: row.firstDomainRank,
              secondDomainRank: row.secondDomainRank,
              firstDomainUrl: row.firstDomainUrl,
              firstDomainTitle: row.firstDomainTitle,
              firstDomainEtv: row.firstDomainEtv,
              coreKeyword: row.coreKeyword,
              searchVolumeTrend: row.searchVolumeTrend,
              serpItemTypes: row.serpItemTypes,
              serpUpdatedAt: row.serpUpdatedAt,
            },
          ],
    ),
    totalCount: response.totalCount,
    costUsd: response.costUsd,
    providerStatusCode: response.providerStatusCode,
    taskStatusCode: response.taskStatusCode,
  };
}

function unavailableProviderResult(
  domain: string,
): CompetitorKeywordGapDataForSeoResult {
  return {
    domain,
    status: "unavailable",
    rows: [],
    totalCount: null,
    costUsd: null,
    providerStatusCode: null,
    taskStatusCode: null,
    failureCode: "keyword_source_unavailable",
  };
}

function unavailableGscRead(): CompetitorKeywordGapGscRead {
  return {
    status: "unavailable",
    queryRows: [],
    queryPageRows: [],
    queryTruncated: false,
    queryPageTruncated: false,
  };
}

function gscLogStatus(
  gsc: CompetitorKeywordGapGscRead | null,
): CompetitorKeywordGapFinalLog["gsc"] {
  if (gsc === null) return "not_requested";
  if (gsc.status === "unavailable") return "unavailable";
  return gsc.queryTruncated || gsc.queryPageTruncated ? "partial" : "available";
}

function propertyMatchesSite(property: string, siteDomain: string): boolean {
  if (/^https?:\/\//i.test(property)) {
    try {
      return (
        normalizeCompetitorKeywordGapDomain(new URL(property).hostname) ===
        siteDomain
      );
    } catch {
      return false;
    }
  }

  return (
    keywordCoverageProperty(`https://${siteDomain}/`, [property]) === property
  );
}

/**
 * Everything about the Search Console overlay that can be known WITHOUT
 * spending anything: the selected property is one this session may read, it
 * belongs to the site under analysis, the shared per-IP gate admits the read,
 * and a usable grant exists.
 *
 * It runs before the paid DataForSEO calls on purpose. A request that names a
 * property is asking for both halves of the report; when the first-party half
 * provably cannot happen, refusing costs the visitor nothing and names what to
 * fix, while proceeding charges for a run whose "your status" column would be
 * empty. Only the read itself -- which cannot be predicted -- is allowed to
 * fail after the money is spent.
 *
 * The per-IP quota unit is consumed here rather than at read time. In the
 * normal path that is the same single unit the read used to spend; the one
 * case it costs more is a run whose competitors all fail afterwards, and a
 * durable counter cannot be un-incremented to avoid it.
 *
 * On success the caller owns `release` and must call it once the read is done.
 */
type CompetitorKeywordGapGscPreflight =
  | {
      readonly kind: "ready";
      readonly accessToken: string;
      readonly release: () => void;
    }
  | { readonly kind: "refused"; readonly response: Response };

async function openGscPreflight(
  property: string,
  siteDomain: string,
  clientIp: string,
  dependencies: Pick<
    CompetitorKeywordGapHandlerDependencies,
    "readGscSession" | "openGscGate" | "resolveGscGrant"
  >,
): Promise<CompetitorKeywordGapGscPreflight> {
  let release: (() => void) | null = null;
  let transferred = false;
  try {
    const session = await dependencies.readGscSession();
    if (session.properties === null || !session.properties.includes(property)) {
      return refusedPreflight("gsc_property_not_granted", 403);
    }
    if (!propertyMatchesSite(property, siteDomain)) {
      return refusedPreflight("gsc_property_site_mismatch", 400);
    }

    // The gate releases its own slot on every refusal, so `gate.response` is
    // returned without touching `release`.
    const gate = await dependencies.openGscGate(clientIp);
    if (!gate.ok) return { kind: "refused", response: gate.response };
    release = gate.release;

    const grant = await dependencies.resolveGscGrant();
    if (grant.kind !== "grant") {
      // Distinguishes a grant that is genuinely gone (401, reconnect) from a
      // Google blip (503, come back) instead of collapsing both.
      return { kind: "refused", response: refuseWithoutGrant(grant) };
    }
    if (!grant.properties.includes(property)) {
      return refusedPreflight("gsc_property_not_granted", 403);
    }

    transferred = true;
    return { kind: "ready", accessToken: grant.accessToken, release };
  } catch {
    return refusedPreflight("gsc_temporarily_unavailable", 503);
  } finally {
    if (!transferred) release?.();
  }
}

function refusedPreflight(
  code: CompetitorKeywordGapErrorCode,
  status: number,
): CompetitorKeywordGapGscPreflight {
  return { kind: "refused", response: json(createPublicToolError(code), status) };
}

/**
 * The one overlay failure that survives the preflight. It cannot be predicted
 * before the provider calls, so it is the only reason a delivered report may
 * still carry an unavailable overlay.
 */
async function readGscCoverage(
  property: string,
  accessToken: string,
  dependencies: Pick<
    CompetitorKeywordGapHandlerDependencies,
    "readCoverageQueries"
  >,
): Promise<CompetitorKeywordGapGscRead> {
  try {
    const coverage = await dependencies.readCoverageQueries({
      property,
      accessToken,
    });
    return {
      status: "available",
      queryRows: coverage.queryRows,
      queryPageRows: coverage.queryPageRows,
      queryTruncated: coverage.queryPaging.truncated,
      queryPageTruncated: coverage.queryPagePaging.truncated,
    };
  } catch {
    return unavailableGscRead();
  }
}

const DEFAULT_DEPENDENCIES: CompetitorKeywordGapHandlerDependencies = {
  getServerAuthenticatedUser,
  readJson: readPublicToolJson,
  resolveMarket: resolveDataForSeoMarket,
  credentials: providerCredentials,
  createProvider: (credentials) => new HttpDataForSeoClient(credentials),
  extractClientIp,
  acquireSlot: acquirePublicToolSlot,
  readGscSession: readTrafficDropSession,
  openGscGate: (clientIp) => openGscGate(clientIp),
  resolveGscGrant: resolveTrafficDropGrant,
  readCoverageQueries: createKeywordCoverageReader({}),
  now: () => new Date(),
  log: defaultLog,
};

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private" },
  });
}

function conflict(body: unknown): Response {
  return Response.json(body, {
    status: 409,
    headers: {
      "Cache-Control": "no-store, private",
      "Retry-After": "5",
    },
  });
}

export async function handleCompetitorKeywordGapRequest(
  request: Request,
  overrides: Partial<CompetitorKeywordGapHandlerDependencies> = {},
): Promise<Response> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  let authentication: ServerAuthenticatedUser;
  try {
    authentication = await dependencies.getServerAuthenticatedUser();
  } catch {
    authentication = { status: "unavailable" };
  }

  if (authentication.status === "unauthenticated") {
    return json(createPublicToolError("auth_required"), 401);
  }
  if (authentication.status === "unavailable") {
    return json(createPublicToolError("auth_unavailable"), 503);
  }

  const body = await dependencies.readJson(request, REQUEST_BODY_LIMIT_BYTES);
  if (!body.ok) {
    const status =
      body.code === "unsupported_media_type"
        ? 415
        : body.code === "payload_too_large"
          ? 413
          : 400;
    return json(createPublicToolError(body.code), status);
  }

  const parsed = parseCompetitorKeywordGapInput(body.value);
  if (!parsed.ok) {
    return json(createPublicToolError("invalid_input"), 400);
  }

  // A client bundle declares the contract version it was built against. A
  // mismatch is refused HERE -- before market resolution, credentials, slot
  // admission, and every provider/GSC call -- because the visitor must not
  // be charged for a paid DataForSEO run whose result their stale page
  // cannot read. It also precedes acquireSlot so a request that never ran
  // emits no run telemetry. Unlike conflict(), no Retry-After: retrying
  // from the same stale bundle can never succeed; the remedy is a reload.
  if (
    parsed.value.acceptSchemaVersion !== undefined &&
    parsed.value.acceptSchemaVersion !== COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION
  ) {
    return json(createPublicToolError("client_out_of_date"), 409);
  }

  const market = dependencies.resolveMarket(
    parsed.value.marketCode,
    parsed.value.languageCode,
  );
  if (market === null) {
    return json(createPublicToolError("invalid_input"), 400);
  }

  const credentials = dependencies.credentials();
  if (credentials === null) {
    return json(createPublicToolError("keyword_source_unavailable"), 503);
  }

  const clientIp = dependencies.extractClientIp(request.headers);
  const slot = dependencies.acquireSlot(inflightKey(authentication.userId));
  if (!slot.acquired) {
    return conflict(createPublicToolError("search_in_progress"));
  }

  const property = parsed.value.property;
  let finalLog: CompetitorKeywordGapFinalLog = {
    status: "unavailable",
    requestedCompetitors: parsed.value.competitorDomains.length,
    completedCompetitors: 0,
    unavailableCompetitors: parsed.value.competitorDomains.length,
    rowCount: 0,
    costUsd: null,
    gsc: property === undefined ? "not_requested" : "unavailable",
    reportProduced: false,
  };
  let releaseGsc: (() => void) | null = null;

  try {
    // Before the provider, not after: see openGscPreflight.
    let accessToken: string | null = null;
    if (property !== undefined) {
      const preflight = await openGscPreflight(
        property,
        parsed.value.siteDomain,
        clientIp,
        dependencies,
      );
      if (preflight.kind === "refused") {
        finalLog = { ...finalLog, gsc: "refused" };
        return preflight.response;
      }
      accessToken = preflight.accessToken;
      releaseGsc = preflight.release;
    }

    const provider = dependencies.createProvider(credentials);
    const settled = await Promise.allSettled(
      parsed.value.competitorDomains.map((domain) =>
        Promise.resolve().then(() =>
          provider.domainIntersection(
            {
              target1: domain,
              target2: parsed.value.siteDomain,
              locationCode: market.locationCode,
              languageCode: market.languageCode,
              intersections: false,
              limit: SAMPLE_RULE.perCompetitorLimit,
              maxFirstDomainRank: SAMPLE_RULE.maxCompetitorRank,
              includeSerpInfo: SAMPLE_RULE.serpSnapshotRequested,
            },
            request.signal,
          ),
        ),
      ),
    );
    const completedCompetitors = settled.filter(
      (outcome) => outcome.status === "fulfilled",
    ).length;
    const providerResults = settled.map((outcome, index) => {
      const domain = parsed.value.competitorDomains[index]!;
      return outcome.status === "fulfilled"
        ? completedProviderResult(domain, outcome.value)
        : unavailableProviderResult(domain);
    });
    const costUsd = providerResults.reduce<number | null>(
      (sum, result) =>
        result.costUsd === null
          ? sum
          : Number(((sum ?? 0) + result.costUsd).toFixed(12)),
      null,
    );
    finalLog = {
      ...finalLog,
      completedCompetitors,
      unavailableCompetitors:
        parsed.value.competitorDomains.length - completedCompetitors,
      costUsd,
    };

    if (completedCompetitors === 0) {
      return json(createPublicToolError("keyword_source_unavailable"), 502);
    }

    const gsc =
      property === undefined || accessToken === null
        ? null
        : await readGscCoverage(property, accessToken, dependencies);
    finalLog = { ...finalLog, gsc: gscLogStatus(gsc) };

    const envelope = buildCompetitorKeywordGapReport({
      completedAt: dependencies.now().toISOString(),
      siteDomain: parsed.value.siteDomain,
      marketCode: parsed.value.marketCode,
      languageCode: market.languageCode,
      competitorDomains: parsed.value.competitorDomains,
      sampleRule: SAMPLE_RULE,
      competitors: providerResults,
      gsc,
    });
    finalLog = {
      status: envelope.run.status,
      requestedCompetitors: envelope.result.requestedCompetitors,
      completedCompetitors: envelope.result.completedCompetitors,
      unavailableCompetitors: envelope.result.unavailableCompetitors,
      rowCount: envelope.result.rows.length,
      costUsd,
      gsc: envelope.result.overlayStatus,
      reportProduced: true,
    };
    return json({ data: envelope }, 200);
  } catch {
    return json(createPublicToolError("keyword_source_unavailable"), 502);
  } finally {
    try {
      releaseGsc?.();
    } catch {
      // Releasing an admission slot must never replace the result response.
    }
    try {
      slot.release();
    } finally {
      try {
        dependencies.log(finalLog);
      } catch {
        // Operational telemetry must never replace the result response.
      }
    }
  }
}
