import { createHash } from "node:crypto";
import {
  SourceError,
  type Availability,
  type Capability,
  type CollectionResult,
  type NormalizeContext,
  type NormalizedObservation,
  type SourceAdapter,
} from "../adapter.ts";
import {
  verifyBacklinkSourcePage,
  type BacklinkSourcePageVerification,
  type VerifyBacklinkSourcePageInput,
} from "../backlinks/source-page-verifier.ts";
import { canonicalizeUrl } from "../canonical-url.ts";
import {
  buildObservation,
  METRIC_DATAFORSEO_BACKLINK,
  METRIC_DATAFORSEO_BACKLINK_PAGE,
  METRIC_DATAFORSEO_BACKLINK_SUMMARY,
  METRIC_DATAFORSEO_REFERRING_DOMAIN,
  type DataForSeoBacklinkPageProjection,
  type DataForSeoBacklinkProjection,
  type DataForSeoBacklinkSummaryProjection,
  type DataForSeoReferringDomainProjection,
} from "../observations.ts";
import {
  type DataForSeoBacklinkRow,
  type DataForSeoBacklinksClient,
  type DataForSeoBacklinksResponse,
  type DataForSeoDomainPagesResponse,
  type DataForSeoReferringDomainsResponse,
  MAX_DATAFORSEO_LIMIT,
} from "./client.ts";

export const DATAFORSEO_BACKLINKS_DATASET_KEY =
  "dataforseo.backlinks.v1" as const;
export const DATAFORSEO_BACKLINKS_METHOD_VERSION =
  "dataforseo.backlinks.v1" as const;
export const DATAFORSEO_BACKLINKS_OPERATION = "backlinks" as const;
export const DATAFORSEO_BACKLINKS_SCOPE_VERSION =
  "dataforseo.backlinks-scope.v1" as const;
export const DATAFORSEO_BACKLINKS_QUERY_KIND = "backlinks" as const;
export const DATAFORSEO_BACKLINKS_ROW_CAP_STOP_REASON =
  "DATAFORSEO_BACKLINKS_ROW_CAP_REACHED" as const;
export const MAX_DATAFORSEO_SOURCE_VERIFICATIONS = 20;

const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const STRICT_ZONED_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)$/u;
const DATAFORSEO_OFFSET_SEPARATOR = / ([+-]\d{2}:?\d{2})$/u;

const BASE_LIMITATION =
  "DataForSEO Backlinks is a live vendor-index observation using its 0–100 rank scale. Summary and referring-domain aggregates include indirect links. The backlink and target-page detail endpoints do not provide an indirect-link selector, so their bounded samples are not asserted to use the same configurable universe. Referring-domain rows are also bounded by the frozen collection cap. Selective source-page verification is direct public evidence and never changes the provider fact itself.";

export interface DataForSeoBacklinksScopeInput {
  readonly target: unknown;
  readonly maxBacklinks: unknown;
  readonly maxReferringDomains: unknown;
  readonly maxBacklinkPages: unknown;
  readonly maxSourceVerifications: unknown;
}

export type DataForSeoBacklinksScope = Readonly<{
  readonly schemaVersion: typeof DATAFORSEO_BACKLINKS_SCOPE_VERSION;
  readonly queryKind: typeof DATAFORSEO_BACKLINKS_QUERY_KIND;
  readonly target: string;
  readonly includeSubdomains: true;
  readonly indirectLinksPolicy: Readonly<{
    readonly summary: "included";
    readonly backlinks: "not_configurable";
    readonly referringDomains: "included";
    readonly domainPages: "not_configurable";
  }>;
  readonly excludeInternalBacklinks: true;
  readonly backlinksStatusType: "live";
  readonly rankScale: "one_hundred";
  readonly maxBacklinks: number;
  readonly maxReferringDomains: number;
  readonly maxBacklinkPages: number;
  readonly maxSourceVerifications: number;
}>;

export type DataForSeoBacklinkSourcePageVerifier = (
  input: VerifyBacklinkSourcePageInput,
  signal?: AbortSignal,
) => Promise<BacklinkSourcePageVerification>;

export interface DataForSeoBacklinksAdapterOptions {
  readonly now?: () => Date;
  readonly sourcePageVerifier?: DataForSeoBacklinkSourcePageVerifier;
}

export interface DataForSeoVerifiedBacklinkRow extends DataForSeoBacklinkRow {
  readonly verification: BacklinkSourcePageVerification | null;
}

export interface DataForSeoBacklinksRawResponse
  extends Omit<DataForSeoBacklinksResponse, "rows"> {
  readonly rows: readonly DataForSeoVerifiedBacklinkRow[];
}

export interface DataForSeoBacklinksRaw {
  readonly schemaVersion: typeof DATAFORSEO_BACKLINKS_METHOD_VERSION;
  readonly collectionScope: DataForSeoBacklinksScope;
  readonly summary: Awaited<
    ReturnType<DataForSeoBacklinksClient["backlinkSummary"]>
  >;
  readonly backlinks: DataForSeoBacklinksRawResponse;
  readonly referringDomains: DataForSeoReferringDomainsResponse;
  readonly domainPages: DataForSeoDomainPagesResponse;
  readonly capturedAt: string;
  readonly availability: Availability;
  readonly stopReason: string | null;
  readonly limitation: string;
}

export type DataForSeoBacklinksAdapter = SourceAdapter<
  DataForSeoBacklinksScope,
  DataForSeoBacklinksScope,
  DataForSeoBacklinksRaw
>;

export interface DataForSeoBacklinksSnapshotSummary {
  readonly collectionScope: DataForSeoBacklinksScope;
  readonly timing: {
    readonly collectedAt: string;
    readonly dataAsOf: null;
    readonly observedAt: null;
    readonly freshness: "unknown";
  };
}

function normalizeTarget(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO Backlinks target must be a non-empty public hostname.",
    );
  }
  const input = value.trim();
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`,
    );
  } catch {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO Backlinks target must be a valid public hostname.",
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO Backlinks target must be a public HTTP(S) hostname.",
    );
  }
  const target = url.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  if (!HOSTNAME_RE.test(target) || /^\d+(?:\.\d+){3}$/.test(target)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO Backlinks target must be a valid public hostname.",
    );
  }
  return target;
}

function normalizeRowCap(value: unknown, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_DATAFORSEO_LIMIT
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `${label} must be an integer from 1 to ${MAX_DATAFORSEO_LIMIT}.`,
    );
  }
  return value as number;
}

function normalizeVerificationCap(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > MAX_DATAFORSEO_SOURCE_VERIFICATIONS
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `DataForSEO maxSourceVerifications must be an integer from 0 to ${MAX_DATAFORSEO_SOURCE_VERIFICATIONS}.`,
    );
  }
  return value as number;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SourceError("INVALID_CONFIGURATION", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const allowed = new Set(expected);
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => !allowed.has(key))
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `${label} contains an unknown or missing field.`,
    );
  }
}

export function createDataForSeoBacklinksScope(
  input: DataForSeoBacklinksScopeInput,
): DataForSeoBacklinksScope {
  const maxBacklinks = normalizeRowCap(
    input.maxBacklinks,
    "DataForSEO maxBacklinks",
  );
  const maxSourceVerifications = normalizeVerificationCap(
    input.maxSourceVerifications,
  );
  if (maxSourceVerifications > maxBacklinks) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO maxSourceVerifications cannot exceed maxBacklinks.",
    );
  }
  return {
    schemaVersion: DATAFORSEO_BACKLINKS_SCOPE_VERSION,
    queryKind: DATAFORSEO_BACKLINKS_QUERY_KIND,
    target: normalizeTarget(input.target),
    includeSubdomains: true,
    indirectLinksPolicy: {
      summary: "included",
      backlinks: "not_configurable",
      referringDomains: "included",
      domainPages: "not_configurable",
    },
    excludeInternalBacklinks: true,
    backlinksStatusType: "live",
    rankScale: "one_hundred",
    maxBacklinks,
    maxReferringDomains: normalizeRowCap(
      input.maxReferringDomains,
      "DataForSEO maxReferringDomains",
    ),
    maxBacklinkPages: normalizeRowCap(
      input.maxBacklinkPages,
      "DataForSEO maxBacklinkPages",
    ),
    maxSourceVerifications,
  };
}

export function parseDataForSeoBacklinksScope(
  value: unknown,
): DataForSeoBacklinksScope {
  const input = asRecord(value, "DataForSEO Backlinks scope");
  assertExactKeys(
    input,
    [
      "schemaVersion",
      "queryKind",
      "target",
      "includeSubdomains",
      "indirectLinksPolicy",
      "excludeInternalBacklinks",
      "backlinksStatusType",
      "rankScale",
      "maxBacklinks",
      "maxReferringDomains",
      "maxBacklinkPages",
      "maxSourceVerifications",
    ],
    "DataForSEO Backlinks scope",
  );
  const indirectLinksPolicy = asRecord(
    input.indirectLinksPolicy,
    "DataForSEO Backlinks indirect-links policy",
  );
  assertExactKeys(
    indirectLinksPolicy,
    ["summary", "backlinks", "referringDomains", "domainPages"],
    "DataForSEO Backlinks indirect-links policy",
  );
  if (
    input.schemaVersion !== DATAFORSEO_BACKLINKS_SCOPE_VERSION ||
    input.queryKind !== DATAFORSEO_BACKLINKS_QUERY_KIND ||
    input.includeSubdomains !== true ||
    indirectLinksPolicy.summary !== "included" ||
    indirectLinksPolicy.backlinks !== "not_configurable" ||
    indirectLinksPolicy.referringDomains !== "included" ||
    indirectLinksPolicy.domainPages !== "not_configurable" ||
    input.excludeInternalBacklinks !== true ||
    input.backlinksStatusType !== "live" ||
    input.rankScale !== "one_hundred"
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO Backlinks scope did not match the fixed provider policy.",
    );
  }
  return createDataForSeoBacklinksScope({
    target: input.target,
    maxBacklinks: input.maxBacklinks,
    maxReferringDomains: input.maxReferringDomains,
    maxBacklinkPages: input.maxBacklinkPages,
    maxSourceVerifications: input.maxSourceVerifications,
  });
}

function canonicalSubjectUrl(value: string, label: string): string {
  const canonical = canonicalizeUrl(value);
  if (!canonical) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${label} was not a canonicalizable public HTTP(S) URL.`,
    );
  }
  return canonical.subjectUrl;
}

function canonicalBacklinkInstant(
  value: string | null,
  label: string,
): string | null {
  if (value === null) return null;

  // DataForSEO inserts one separator space before numeric offsets. Remove only
  // that documented separator, then preserve the DB's strict instant boundary.
  const normalized = value.replace(DATAFORSEO_OFFSET_SEPARATOR, "$1");
  const match = STRICT_ZONED_TIMESTAMP.exec(normalized);
  if (!match) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${label} must be a strict zoned timestamp instant.`,
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetSign = match[8] === "-" ? -1 : 1;
  const offsetHour = Number(match[9] ?? "0");
  const offsetMinute = Number(match[10] ?? "0");
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (days[month - 1] ?? 0) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${label} must be a strict zoned timestamp instant.`,
    );
  }

  const wallClock = new Date(0);
  wallClock.setUTCFullYear(year, month - 1, day);
  wallClock.setUTCHours(hour, minute, second, 0);
  const utcMs =
    wallClock.getTime() -
    offsetSign * (offsetHour * 60 + offsetMinute) * 60_000;
  const utc = new Date(utcMs);
  if (
    !Number.isFinite(utcMs) ||
    utc.getUTCFullYear() < 1 ||
    utc.getUTCFullYear() > 9999
  ) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${label} must be a strict zoned timestamp instant.`,
    );
  }

  return normalized;
}

function safeSourceRef(prefix: "link" | "page", ...parts: readonly string[]) {
  const digest = createHash("sha256")
    .update(parts.join("\u0000"), "utf8")
    .digest("hex")
    .slice(0, 40);
  return `dfs-${prefix}-${digest}`;
}

function assertListResponse(
  response:
    | DataForSeoBacklinksResponse
    | DataForSeoReferringDomainsResponse
    | DataForSeoDomainPagesResponse,
  limit: number,
  label: string,
): void {
  if (
    !Array.isArray(response.rows) ||
    !Number.isSafeInteger(response.itemsCount) ||
    response.itemsCount !== response.rows.length ||
    response.itemsCount > limit ||
    !Number.isSafeInteger(response.totalCount) ||
    response.totalCount < response.itemsCount ||
    typeof response.costUsd !== "number" ||
    !Number.isFinite(response.costUsd) ||
    response.costUsd < 0
  ) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `DataForSEO ${label} response contained contradictory counts or cost.`,
    );
  }
}

function assertSummary(
  summary: DataForSeoBacklinksRaw["summary"],
  target: string,
): void {
  const values = [
    summary.summary.rank,
    summary.summary.backlinks,
    summary.summary.referringDomains,
    summary.summary.referringMainDomains,
    summary.costUsd,
  ];
  if (
    summary.summary.target !== target ||
    values.some(
      (value) =>
        typeof value !== "number" || !Number.isFinite(value) || value < 0,
    )
  ) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO backlink-summary response did not match its frozen target.",
    );
  }
}

function inconclusiveVerification(
  checkedAt: string,
): BacklinkSourcePageVerification {
  return {
    status: "inconclusive",
    checkedAt,
    finalUrl: null,
    httpStatus: null,
    anchorText: null,
    rel: null,
    limitation: "source_page_verifier_failed",
  };
}

async function verifySelectedRows(
  rows: readonly DataForSeoBacklinkRow[],
  limit: number,
  verifier: DataForSeoBacklinkSourcePageVerifier,
  signal: AbortSignal | undefined,
  now: () => Date,
): Promise<{
  readonly rows: readonly DataForSeoVerifiedBacklinkRow[];
  readonly attempts: number;
}> {
  const selected = new Map<
    string,
    { readonly row: DataForSeoBacklinkRow; readonly index: number }
  >();
  for (const candidate of rows
    .map((row, index) => ({ row, index }))
    .sort(
      (left, right) =>
        right.row.domainRank - left.row.domainRank ||
        right.row.pageRank - left.row.pageRank ||
        left.row.sourceUrl.localeCompare(right.row.sourceUrl, "en") ||
        left.row.targetUrl.localeCompare(right.row.targetUrl, "en"),
    )) {
    if (!selected.has(candidate.row.sourceUrl)) {
      selected.set(candidate.row.sourceUrl, candidate);
    }
    if (selected.size >= limit) break;
  }
  const verificationByRow = new Map<
    number,
    BacklinkSourcePageVerification
  >();
  await Promise.all(
    [...selected.values()].map(async ({ row, index }) => {
      let verification: BacklinkSourcePageVerification;
      try {
        verification = await verifier(
          { sourceUrl: row.sourceUrl, targetUrl: row.targetUrl },
          signal,
        );
      } catch {
        verification = inconclusiveVerification(now().toISOString());
      }
      verificationByRow.set(index, verification);
    }),
  );
  return {
    rows: rows.map((row, index) => ({
      ...row,
      verification: verificationByRow.get(index) ?? null,
    })),
    attempts: selected.size,
  };
}

function roundedCost(...values: readonly number[]): number {
  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(12));
}

function detailCapDisclosure(
  scope: DataForSeoBacklinksScope,
  backlinks: DataForSeoBacklinksResponse,
  referringDomains: DataForSeoReferringDomainsResponse,
  domainPages: DataForSeoDomainPagesResponse,
): {
  readonly reached: boolean;
  readonly reachedCount: number;
  readonly limitation: string;
} {
  const caps = [
    {
      label: "backlinks",
      total: backlinks.totalCount,
      cap: scope.maxBacklinks,
    },
    {
      label: "referring domains",
      total: referringDomains.totalCount,
      cap: scope.maxReferringDomains,
    },
    {
      label: "backlink pages",
      total: domainPages.totalCount,
      cap: scope.maxBacklinkPages,
    },
  ];
  const reached = caps.filter(({ total, cap }) => total > cap);
  if (reached.length === 0) {
    return { reached: false, reachedCount: 0, limitation: BASE_LIMITATION };
  }
  return {
    reached: true,
    reachedCount: reached.length,
    limitation: `${BASE_LIMITATION} Frozen detail caps were reached: ${reached
      .map(({ label, total, cap }) => `${label} ${total}/${cap}`)
      .join(", ")}. Provider summary totals remain complete; only the detailed samples are truncated.`,
  };
}

function linkKind(
  row: DataForSeoBacklinkRow,
): DataForSeoBacklinkProjection["linkKind"] {
  const attributes = new Set(row.attributes.map((value) => value.toLowerCase()));
  if (attributes.has("sponsored")) return "sponsored";
  if (attributes.has("ugc")) return "ugc";
  return row.dofollow ? "dofollow" : "nofollow";
}

export function dataForSeoBacklinksSnapshotSummary(
  value: DataForSeoBacklinksScope,
  collectedAt: string,
): DataForSeoBacklinksSnapshotSummary {
  const collectionScope = parseDataForSeoBacklinksScope(value);
  const date = new Date(collectedAt);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== collectedAt) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO Backlinks collection time must be canonical UTC.",
    );
  }
  return {
    collectionScope,
    timing: {
      collectedAt,
      dataAsOf: null,
      observedAt: null,
      freshness: "unknown",
    },
  };
}

export function createDataForSeoBacklinksAdapter(
  client: DataForSeoBacklinksClient,
  options: DataForSeoBacklinksAdapterOptions = {},
): DataForSeoBacklinksAdapter {
  const now = options.now ?? (() => new Date());
  const verifier: DataForSeoBacklinkSourcePageVerifier =
    options.sourcePageVerifier ??
    ((input) => verifyBacklinkSourcePage(input));
  return {
    provider: "dataforseo",
    async validateConfig(config) {
      return parseDataForSeoBacklinksScope(config);
    },
    async capabilities(config): Promise<Capability[]> {
      parseDataForSeoBacklinksScope(config);
      return [
        {
          datasetKey: DATAFORSEO_BACKLINKS_DATASET_KEY,
          operation: DATAFORSEO_BACKLINKS_OPERATION,
          available: true,
          limitation: BASE_LIMITATION,
        },
      ];
    },
    async collect(params, ctx): Promise<CollectionResult<DataForSeoBacklinksRaw>> {
      const scope = parseDataForSeoBacklinksScope(params);
      const [summary, backlinks, referringDomains, domainPages] =
        await Promise.all([
          client.backlinkSummary({ target: scope.target }, ctx.signal),
          client.backlinks(
            { target: scope.target, limit: scope.maxBacklinks },
            ctx.signal,
          ),
          client.referringDomains(
            { target: scope.target, limit: scope.maxReferringDomains },
            ctx.signal,
          ),
          client.domainPages(
            { target: scope.target, limit: scope.maxBacklinkPages },
            ctx.signal,
          ),
        ]);
      assertSummary(summary, scope.target);
      assertListResponse(backlinks, scope.maxBacklinks, "backlinks");
      assertListResponse(
        referringDomains,
        scope.maxReferringDomains,
        "referring-domains",
      );
      assertListResponse(domainPages, scope.maxBacklinkPages, "domain-pages");

      const verified = await verifySelectedRows(
        backlinks.rows,
        scope.maxSourceVerifications,
        verifier,
        ctx.signal,
        now,
      );
      const capturedAt = now().toISOString();
      const capDisclosure = detailCapDisclosure(
        scope,
        backlinks,
        referringDomains,
        domainPages,
      );
      // All four provider calls succeeded. The summary is complete even when
      // detail endpoints exceed their frozen sample caps, so collection-level
      // availability remains honest and usable by the authority projection.
      const availability: Availability = "available";
      const stopReason = capDisclosure.reached
        ? DATAFORSEO_BACKLINKS_ROW_CAP_STOP_REASON
        : null;
      const rowCount =
        1 +
        verified.rows.length +
        referringDomains.rows.length +
        domainPages.rows.length;
      const raw: DataForSeoBacklinksRaw = {
        schemaVersion: DATAFORSEO_BACKLINKS_METHOD_VERSION,
        collectionScope: scope,
        summary,
        backlinks: { ...backlinks, rows: verified.rows },
        referringDomains,
        domainPages,
        capturedAt,
        availability,
        stopReason,
        limitation: capDisclosure.limitation,
      };
      return {
        availability,
        raw,
        capturedAt,
        sourceWindow: { start: null, end: null },
        rowCount,
        stopReason,
        providerUsage: {
          apiCalls: 4,
          rowsReturned: rowCount,
          rowsRetained: rowCount,
          sourcePagesVerified: verified.attempts,
          backlinksTotalCount: backlinks.totalCount,
          referringDomainsTotalCount: referringDomains.totalCount,
          backlinkPagesTotalCount: domainPages.totalCount,
          rowCapsReached: capDisclosure.reachedCount,
          costUsd: roundedCost(
            summary.costUsd,
            backlinks.costUsd,
            referringDomains.costUsd,
            domainPages.costUsd,
          ),
        },
        limitation: capDisclosure.limitation,
      };
    },
    async *normalize(
      raw: DataForSeoBacklinksRaw,
      ctx: NormalizeContext,
    ): AsyncIterable<NormalizedObservation> {
      const scope = parseDataForSeoBacklinksScope(raw.collectionScope);
      const summary: DataForSeoBacklinkSummaryProjection = {
        targetDomain: scope.target,
        rank: raw.summary.summary.rank,
        backlinks: raw.summary.summary.backlinks,
        referringDomains: raw.summary.summary.referringDomains,
      };
      yield buildObservation({
        provider: "dataforseo",
        metricKey: METRIC_DATAFORSEO_BACKLINK_SUMMARY,
        subjectType: "site",
        subjectRef: scope.target,
        observedAt: ctx.capturedAt,
        availability: "available",
        value: { json: summary },
        limitation: raw.limitation,
      });

      for (const row of raw.backlinks.rows) {
        const targetUrl = canonicalSubjectUrl(
          row.targetUrl,
          "DataForSEO backlink target URL",
        );
        canonicalSubjectUrl(row.sourceUrl, "DataForSEO backlink source URL");
        const projection: DataForSeoBacklinkProjection = {
          sourceRef: safeSourceRef("link", row.sourceUrl, targetUrl),
          referringDomain: row.sourceDomain,
          sourceUrl: row.sourceUrl,
          targetUrl,
          sourceRank: row.domainRank,
          linkKind: linkKind(row),
          anchorText: row.anchor,
          firstSeenAt: canonicalBacklinkInstant(
            row.firstSeen,
            "DataForSEO backlink firstSeen",
          ),
          lastSeenAt: canonicalBacklinkInstant(
            row.lastSeen,
            "DataForSEO backlink lastSeen",
          ),
          isNew: row.isNew,
          isLost: row.isLost,
          verification: row.verification,
        };
        yield buildObservation({
          provider: "dataforseo",
          metricKey: METRIC_DATAFORSEO_BACKLINK,
          subjectType: "url",
          subjectRef: targetUrl,
          observedAt: ctx.capturedAt,
          availability: "available",
          value: { json: projection },
          limitation: raw.limitation,
        });
      }

      for (const row of raw.referringDomains.rows) {
        const projection: DataForSeoReferringDomainProjection = {
          targetDomain: scope.target,
          referringDomain: row.domain,
          rank: row.rank,
          backlinks: row.backlinks,
        };
        yield buildObservation({
          provider: "dataforseo",
          metricKey: METRIC_DATAFORSEO_REFERRING_DOMAIN,
          subjectType: "site",
          subjectRef: row.domain,
          observedAt: ctx.capturedAt,
          availability: "available",
          value: { json: projection },
          limitation: raw.limitation,
        });
      }

      for (const row of raw.domainPages.rows) {
        const targetUrl = canonicalSubjectUrl(
          row.pageUrl,
          "DataForSEO backlink page URL",
        );
        const projection: DataForSeoBacklinkPageProjection = {
          sourceRef: safeSourceRef("page", targetUrl),
          targetUrl,
          title: row.title,
          backlinks: row.backlinks,
          referringDomains: row.referringDomains,
        };
        yield buildObservation({
          provider: "dataforseo",
          metricKey: METRIC_DATAFORSEO_BACKLINK_PAGE,
          subjectType: "url",
          subjectRef: targetUrl,
          observedAt: ctx.capturedAt,
          availability: "available",
          value: { json: projection },
          limitation: raw.limitation,
        });
      }
    },
  };
}

const unboundClient: DataForSeoBacklinksClient = {
  backlinkSummary: () =>
    Promise.reject(
      new SourceError("AUTH_REQUIRED", "DataForSEO credentials are required."),
    ),
  backlinks: () =>
    Promise.reject(
      new SourceError("AUTH_REQUIRED", "DataForSEO credentials are required."),
    ),
  referringDomains: () =>
    Promise.reject(
      new SourceError("AUTH_REQUIRED", "DataForSEO credentials are required."),
    ),
  domainPages: () =>
    Promise.reject(
      new SourceError("AUTH_REQUIRED", "DataForSEO credentials are required."),
    ),
};

export const dataforseoBacklinksAdapter =
  createDataForSeoBacklinksAdapter(unboundClient);
