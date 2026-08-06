import { and, eq, isNull } from "drizzle-orm";
import { canonicalUtcTimestamptz } from "../instant.ts";
import {
  backlinkAuthoritySnapshots,
  backlinkFacts,
  backlinkPageMetrics,
} from "../schema.ts";
import type { Executor, ProjectScope } from "./base.ts";
import type { ObservationInsert } from "./observations.ts";

export const DATAFORSEO_BACKLINKS_DATASET_KEY =
  "dataforseo.backlinks.v1" as const;
export const DATAFORSEO_BACKLINKS_METHOD_VERSION =
  "dataforseo.backlinks.v1" as const;
export const METRIC_DATAFORSEO_BACKLINK_SUMMARY =
  "dataforseo.backlink_summary.v1" as const;
export const METRIC_DATAFORSEO_BACKLINK =
  "dataforseo.backlink.v1" as const;
export const METRIC_DATAFORSEO_BACKLINK_PAGE =
  "dataforseo.backlink_page.v1" as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const DOMAIN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const CUSTOMER_SAFE_REF = /^[^/\\?&#=]+$/u;
const LINK_KINDS = [
  "dofollow",
  "nofollow",
  "ugc",
  "sponsored",
  "unknown",
] as const;
const VERIFICATION_STATUSES = [
  "verified",
  "absent",
  "blocked",
  "inconclusive",
] as const;

type LinkKind = (typeof LINK_KINDS)[number];
type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export interface DataForSeoBacklinkProjectionInput {
  readonly scope: ProjectScope;
  readonly siteId: string;
  readonly dataSnapshot: {
    readonly id: string;
    readonly provider: string;
    readonly datasetKey: string;
    readonly methodVersion: string;
    readonly capturedAt: string;
    readonly availability: string;
    readonly checksum: string;
    readonly rowCount: number;
  };
  /** Canonical observations after exact SitePage lineage resolution. */
  readonly observations: readonly ObservationInsert[];
}

export interface DataForSeoBacklinkProjectionResult {
  readonly snapshotId: string;
  readonly replayed: boolean;
  readonly factCount: number;
  readonly pageMetricCount: number;
}

interface SummaryProjection {
  readonly targetDomain: string;
  readonly rank: number;
  readonly backlinks: number;
  readonly referringDomains: number;
}

interface FactProjection {
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly referring_domain: string;
  readonly source_url: string;
  readonly target_url: string;
  readonly target_site_page_id: string | null;
  readonly source_authority_metric_kind: "dataforseo_rank";
  readonly source_authority_metric_value: number;
  readonly link_kind: LinkKind;
  readonly source_ref: string;
  readonly anchor_text: string | null;
  readonly first_seen_at: string | null;
  readonly last_seen_at: string | null;
  readonly is_new: boolean;
  readonly is_lost: boolean;
  readonly verification_status:
    | "not_checked"
    | VerificationStatus;
  readonly verified_at: string | null;
  readonly verification_final_url: string | null;
  readonly verification_http_status: number | null;
  readonly verification_limitation: string | null;
}

interface PageProjection {
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly site_page_id: string;
  readonly title: string | null;
  readonly backlink_count: number;
  readonly referring_domain_count: number;
  readonly metric_semantics: "provider_index_total";
}

function fail(message: string): never {
  throw new Error(`DataForSEO backlink projection: ${message}`);
}

function assertUuid(label: string, value: string): void {
  if (!UUID.test(value)) fail(`${label} must be a UUID`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxLength ||
    value.trim() !== value
  ) {
    return fail(`${label} must be bounded, non-empty text`);
  }
  return value;
}

function nullableText(
  value: unknown,
  label: string,
  maxLength: number,
): string | null {
  return value === null ? null : text(value, label, maxLength);
}

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return fail(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function rank(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    return fail(`${label} must be between 0 and 100`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") return fail(`${label} must be boolean`);
  return value;
}

function instant(value: unknown, label: string): string {
  const serialized = text(value, label, 64);
  try {
    return canonicalUtcTimestamptz(serialized);
  } catch {
    return fail(`${label} must be a strict timestamp instant`);
  }
}

function nullableInstant(value: unknown, label: string): string | null {
  return value === null ? null : instant(value, label);
}

function publicUrl(value: unknown, label: string): string {
  const serialized = text(value, label, 2048);
  let parsed: URL;
  try {
    parsed = new URL(serialized);
  } catch {
    return fail(`${label} must be an absolute URL`);
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    return fail(`${label} must be a credential-free HTTP(S) URL`);
  }
  return serialized;
}

function nullablePublicUrl(value: unknown, label: string): string | null {
  return value === null ? null : publicUrl(value, label);
}

function domain(value: unknown, label: string): string {
  const normalized = text(value, label, 253).toLowerCase();
  if (!DOMAIN.test(normalized)) return fail(`${label} must be a domain`);
  return normalized;
}

function sourceRef(value: unknown, label: string): string {
  const ref = text(value, label, 240);
  if (
    !CUSTOMER_SAFE_REF.test(ref) ||
    [...ref].some((character) => {
      const code = character.codePointAt(0);
      return code === undefined || code < 32 || code === 127;
    })
  ) {
    return fail(`${label} must be a customer-safe reference`);
  }
  return ref;
}

function belongsToDomain(url: string, targetDomain: string): boolean {
  const hostname = new URL(url).hostname.toLowerCase();
  return hostname === targetDomain || hostname.endsWith(`.${targetDomain}`);
}

function commonObservation(
  observation: ObservationInsert,
  capturedAt: string,
): void {
  if (
    observation.availability !== "available" ||
    observation.origin !== "vendor_observation" ||
    observation.grade !== "B" ||
    (observation.method ?? "observed") !== "observed" ||
    instant(observation.observedAt, "observation observedAt") !== capturedAt
  ) {
    fail("canonical observation lineage is invalid");
  }
}

function summaryObservation(
  observations: readonly ObservationInsert[],
  capturedAt: string,
): SummaryProjection {
  const rows = observations.filter(
    (observation) =>
      observation.metricKey === METRIC_DATAFORSEO_BACKLINK_SUMMARY &&
      observation.availability === "available",
  );
  if (rows.length !== 1) fail("exactly one available summary is required");
  const observation = rows[0]!;
  commonObservation(observation, capturedAt);
  const value = record(observation.valueJson, "summary valueJson");
  const targetDomain = domain(value["targetDomain"], "summary targetDomain");
  if (
    observation.subjectType !== "site" ||
    observation.subjectRef !== targetDomain
  ) {
    fail("summary subject must equal its target domain");
  }
  return {
    targetDomain,
    rank: rank(value["rank"], "summary rank"),
    backlinks: safeInteger(value["backlinks"], "summary backlinks"),
    referringDomains: safeInteger(
      value["referringDomains"],
      "summary referringDomains",
    ),
  };
}

function verificationProjection(value: unknown): Pick<
  FactProjection,
  | "verification_status"
  | "verified_at"
  | "verification_final_url"
  | "verification_http_status"
  | "verification_limitation"
> {
  if (value === null) {
    return {
      verification_status: "not_checked",
      verified_at: null,
      verification_final_url: null,
      verification_http_status: null,
      verification_limitation: null,
    };
  }
  const item = record(value, "backlink verification");
  const status = text(item["status"], "verification status", 32);
  if (!VERIFICATION_STATUSES.includes(status as VerificationStatus)) {
    return fail("verification status is unsupported");
  }
  const checkedAt = instant(item["checkedAt"], "verification checkedAt");
  const finalUrl = nullablePublicUrl(
    item["finalUrl"],
    "verification finalUrl",
  );
  const rawHttpStatus = item["httpStatus"];
  const httpStatus =
    rawHttpStatus === null
      ? null
      : safeInteger(rawHttpStatus, "verification httpStatus");
  if (httpStatus !== null && (httpStatus < 100 || httpStatus > 599)) {
    fail("verification httpStatus must be an HTTP status code");
  }
  return {
    verification_status: status as VerificationStatus,
    verified_at: status === "verified" ? checkedAt : null,
    verification_final_url: finalUrl,
    verification_http_status: httpStatus,
    verification_limitation: nullableText(
      item["limitation"],
      "verification limitation",
      2000,
    ),
  };
}

function factProjections(
  input: DataForSeoBacklinkProjectionInput,
  targetDomain: string,
  capturedAt: string,
): FactProjection[] {
  const rows = input.observations
    .filter(
      (observation) =>
        observation.metricKey === METRIC_DATAFORSEO_BACKLINK &&
        observation.availability === "available",
    )
    .map((observation) => {
      commonObservation(observation, capturedAt);
      const value = record(observation.valueJson, "backlink valueJson");
      const targetUrl = publicUrl(value["targetUrl"], "backlink targetUrl");
      const referringDomain = domain(
        value["referringDomain"],
        "backlink referringDomain",
      );
      const sourceUrl = publicUrl(value["sourceUrl"], "backlink sourceUrl");
      const sitePageId = observation.sitePageId ?? null;
      if (sitePageId !== null) assertUuid("backlink sitePageId", sitePageId);
      if (
        observation.subjectType !== "url" ||
        observation.subjectRef !== targetUrl ||
        !belongsToDomain(targetUrl, targetDomain) ||
        !belongsToDomain(sourceUrl, referringDomain)
      ) {
        fail("backlink subject or domain lineage is invalid");
      }
      const linkKind = text(value["linkKind"], "backlink linkKind", 32);
      if (!LINK_KINDS.includes(linkKind as LinkKind)) {
        fail("backlink linkKind is unsupported");
      }
      return {
        workspace_id: input.scope.workspaceId,
        project_id: input.scope.projectId,
        site_id: input.siteId,
        referring_domain: referringDomain,
        source_url: sourceUrl,
        target_url: targetUrl,
        target_site_page_id: sitePageId,
        source_authority_metric_kind: "dataforseo_rank" as const,
        source_authority_metric_value: rank(
          value["sourceRank"],
          "backlink sourceRank",
        ),
        link_kind: linkKind as LinkKind,
        source_ref: sourceRef(value["sourceRef"], "backlink sourceRef"),
        anchor_text: nullableText(
          value["anchorText"],
          "backlink anchorText",
          2000,
        ),
        first_seen_at: nullableInstant(
          value["firstSeenAt"],
          "backlink firstSeenAt",
        ),
        last_seen_at: nullableInstant(
          value["lastSeenAt"],
          "backlink lastSeenAt",
        ),
        is_new: boolean(value["isNew"], "backlink isNew"),
        is_lost: boolean(value["isLost"], "backlink isLost"),
        ...verificationProjection(value["verification"]),
      } satisfies FactProjection;
    })
    .sort((left, right) => left.source_ref.localeCompare(right.source_ref));
  if (new Set(rows.map((row) => row.source_ref)).size !== rows.length) {
    fail("backlink source references must be unique");
  }
  return rows;
}

function pageProjections(
  input: DataForSeoBacklinkProjectionInput,
  targetDomain: string,
  capturedAt: string,
): PageProjection[] {
  const rows = input.observations
    .filter(
      (observation) =>
        observation.metricKey === METRIC_DATAFORSEO_BACKLINK_PAGE &&
        observation.availability === "available" &&
        observation.sitePageId !== null &&
        observation.sitePageId !== undefined,
    )
    .map((observation) => {
      commonObservation(observation, capturedAt);
      const value = record(observation.valueJson, "backlink page valueJson");
      const targetUrl = publicUrl(
        value["targetUrl"],
        "backlink page targetUrl",
      );
      const sitePageId = observation.sitePageId!;
      assertUuid("backlink page sitePageId", sitePageId);
      sourceRef(value["sourceRef"], "backlink page sourceRef");
      if (
        observation.subjectType !== "url" ||
        observation.subjectRef !== targetUrl ||
        !belongsToDomain(targetUrl, targetDomain)
      ) {
        fail("backlink page subject or domain lineage is invalid");
      }
      return {
        workspace_id: input.scope.workspaceId,
        project_id: input.scope.projectId,
        site_id: input.siteId,
        site_page_id: sitePageId,
        title: nullableText(value["title"], "backlink page title", 500),
        backlink_count: safeInteger(
          value["backlinks"],
          "backlink page backlinks",
        ),
        referring_domain_count: safeInteger(
          value["referringDomains"],
          "backlink page referringDomains",
        ),
        metric_semantics: "provider_index_total" as const,
      } satisfies PageProjection;
    })
    .sort((left, right) => left.site_page_id.localeCompare(right.site_page_id));
  if (new Set(rows.map((row) => row.site_page_id)).size !== rows.length) {
    fail("backlink page lineage must be unique");
  }
  return rows;
}

function canonicalStoredInstant(value: unknown): string | null {
  if (value === null) return null;
  const serialized = value instanceof Date ? value.toISOString() : value;
  if (typeof serialized !== "string") return null;
  try {
    return canonicalUtcTimestamptz(serialized);
  } catch {
    return null;
  }
}

function sameNullableNumber(left: unknown, right: number | null): boolean {
  if (right === null) return left === null;
  return Number(left) === right;
}

function assertAuthorityReplay(
  row: Record<string, unknown>,
  expected: typeof backlinkAuthoritySnapshots.$inferInsert,
): string {
  const id = row["id"];
  if (
    typeof id !== "string" ||
    !UUID.test(id) ||
    row["workspace_id"] !== expected.workspace_id ||
    row["project_id"] !== expected.project_id ||
    row["site_id"] !== expected.site_id ||
    row["competitor_id"] !== null ||
    row["subject_kind"] !== expected.subject_kind ||
    row["source_kind"] !== expected.source_kind ||
    row["provider"] !== expected.provider ||
    canonicalStoredInstant(row["captured_at"]) !== expected.captured_at ||
    row["availability"] !== expected.availability ||
    row["index_scope"] !== expected.index_scope ||
    !sameNullableNumber(row["total_backlinks"], expected.total_backlinks ?? null) ||
    !sameNullableNumber(
      row["total_referring_domains"],
      expected.total_referring_domains ?? null,
    ) ||
    row["observed_backlinks"] !== null ||
    row["observed_referring_domains"] !== null ||
    row["authority_metric_kind"] !== expected.authority_metric_kind ||
    !sameNullableNumber(
      row["authority_metric_value"],
      expected.authority_metric_value ?? null,
    ) ||
    row["source_ref"] !== expected.source_ref ||
    row["checksum"] !== expected.checksum ||
    Number(row["row_count"]) !== expected.row_count ||
    row["import_preview_id"] !== null ||
    row["limitation"] !== null
  ) {
    fail("authority replay conflicts with immutable values");
  }
  return id;
}

function factMatches(row: Record<string, unknown>, expected: FactProjection): boolean {
  return (
    row["workspace_id"] === expected.workspace_id &&
    row["project_id"] === expected.project_id &&
    row["site_id"] === expected.site_id &&
    row["referring_domain"] === expected.referring_domain &&
    row["source_url"] === expected.source_url &&
    row["target_url"] === expected.target_url &&
    row["target_site_page_id"] === expected.target_site_page_id &&
    row["source_authority_metric_kind"] ===
      expected.source_authority_metric_kind &&
    Number(row["source_authority_metric_value"]) ===
      expected.source_authority_metric_value &&
    row["link_kind"] === expected.link_kind &&
    row["source_ref"] === expected.source_ref &&
    row["anchor_text"] === expected.anchor_text &&
    canonicalStoredInstant(row["first_seen_at"]) === expected.first_seen_at &&
    canonicalStoredInstant(row["last_seen_at"]) === expected.last_seen_at &&
    row["is_new"] === expected.is_new &&
    row["is_lost"] === expected.is_lost &&
    row["verification_status"] === expected.verification_status &&
    canonicalStoredInstant(row["verified_at"]) === expected.verified_at &&
    row["verification_final_url"] === expected.verification_final_url &&
    sameNullableNumber(
      row["verification_http_status"],
      expected.verification_http_status,
    ) &&
    row["verification_limitation"] === expected.verification_limitation
  );
}

function pageMatches(row: Record<string, unknown>, expected: PageProjection): boolean {
  return (
    row["workspace_id"] === expected.workspace_id &&
    row["project_id"] === expected.project_id &&
    row["site_id"] === expected.site_id &&
    row["site_page_id"] === expected.site_page_id &&
    row["title"] === expected.title &&
    Number(row["backlink_count"]) === expected.backlink_count &&
    Number(row["referring_domain_count"]) ===
      expected.referring_domain_count &&
    row["metric_semantics"] === expected.metric_semantics
  );
}

function assertExactFactReplay(
  rows: readonly Record<string, unknown>[],
  expected: readonly FactProjection[],
): void {
  const ordered = [...rows].sort((left, right) =>
    String(left["source_ref"]).localeCompare(String(right["source_ref"])),
  );
  if (
    ordered.length !== expected.length ||
    ordered.some((row, index) => !factMatches(row, expected[index]!))
  ) {
    fail("fact replay conflicts with immutable values");
  }
}

function assertExactPageReplay(
  rows: readonly Record<string, unknown>[],
  expected: readonly PageProjection[],
): void {
  const ordered = [...rows].sort((left, right) =>
    String(left["site_page_id"]).localeCompare(
      String(right["site_page_id"]),
    ),
  );
  if (
    ordered.length !== expected.length ||
    ordered.some((row, index) => !pageMatches(row, expected[index]!))
  ) {
    fail("page replay conflicts with immutable values");
  }
}

/**
 * Project one available canonical DataForSEO Backlinks snapshot inside the
 * caller's collection terminal transaction. The authority identity binds the
 * projection to the immutable DataSnapshot checksum; an exact replay reads and
 * verifies every append-only row instead of silently accepting a conflict.
 */
export async function projectDataForSeoBacklinkSnapshot(
  tx: Executor,
  input: DataForSeoBacklinkProjectionInput,
): Promise<DataForSeoBacklinkProjectionResult> {
  assertUuid("workspaceId", input.scope.workspaceId);
  assertUuid("projectId", input.scope.projectId);
  assertUuid("siteId", input.siteId);
  assertUuid("dataSnapshot.id", input.dataSnapshot.id);
  if (
    input.dataSnapshot.provider !== "dataforseo" ||
    input.dataSnapshot.datasetKey !== DATAFORSEO_BACKLINKS_DATASET_KEY ||
    input.dataSnapshot.methodVersion !== DATAFORSEO_BACKLINKS_METHOD_VERSION ||
    input.dataSnapshot.availability !== "available" ||
    !SHA256.test(input.dataSnapshot.checksum) ||
    !Number.isSafeInteger(input.dataSnapshot.rowCount) ||
    input.dataSnapshot.rowCount < 0
  ) {
    fail("DataSnapshot identity is invalid or unavailable");
  }
  const capturedAt = instant(
    input.dataSnapshot.capturedAt,
    "dataSnapshot capturedAt",
  );
  const summary = summaryObservation(input.observations, capturedAt);
  const facts = factProjections(input, summary.targetDomain, capturedAt);
  const pages = pageProjections(input, summary.targetDomain, capturedAt);
  const authorityValues = {
    workspace_id: input.scope.workspaceId,
    project_id: input.scope.projectId,
    site_id: input.siteId,
    competitor_id: null,
    subject_kind: "primary_site",
    source_kind: "provider_import",
    provider: "dataforseo",
    captured_at: capturedAt,
    availability: "available",
    index_scope: "provider_index",
    total_backlinks: summary.backlinks,
    total_referring_domains: summary.referringDomains,
    observed_backlinks: null,
    observed_referring_domains: null,
    authority_metric_kind: "dataforseo_rank",
    authority_metric_value: summary.rank,
    source_ref: `dfs-${input.dataSnapshot.id}`,
    checksum: input.dataSnapshot.checksum,
    row_count: input.dataSnapshot.rowCount,
    import_preview_id: null,
    limitation: null,
  } satisfies typeof backlinkAuthoritySnapshots.$inferInsert;

  const insertedAuthority = await tx
    .insert(backlinkAuthoritySnapshots)
    .values(authorityValues)
    .onConflictDoNothing()
    .returning({ id: backlinkAuthoritySnapshots.id });
  if (insertedAuthority.length > 1) fail("authority insert was ambiguous");

  let snapshotId: string;
  const replayed = insertedAuthority.length === 0;
  if (replayed) {
    const existing = (await tx
      .select()
      .from(backlinkAuthoritySnapshots)
      .where(
        and(
          eq(backlinkAuthoritySnapshots.workspace_id, input.scope.workspaceId),
          eq(backlinkAuthoritySnapshots.project_id, input.scope.projectId),
          eq(backlinkAuthoritySnapshots.site_id, input.siteId),
          isNull(backlinkAuthoritySnapshots.competitor_id),
          eq(backlinkAuthoritySnapshots.subject_kind, "primary_site"),
          eq(backlinkAuthoritySnapshots.source_kind, "provider_import"),
          eq(backlinkAuthoritySnapshots.provider, "dataforseo"),
          eq(
            backlinkAuthoritySnapshots.source_ref,
            authorityValues.source_ref,
          ),
        ),
      )
      .limit(2)) as unknown as Record<string, unknown>[];
    if (existing.length !== 1) fail("authority conflict replay is missing");
    snapshotId = assertAuthorityReplay(existing[0]!, authorityValues);
  } else {
    snapshotId = insertedAuthority[0]!.id;
    assertUuid("authority snapshot id", snapshotId);
  }

  const factValues = facts.map((fact) => ({
    snapshot_id: snapshotId,
    ...fact,
  })) satisfies (typeof backlinkFacts.$inferInsert)[];
  const pageValues = pages.map((page) => ({
    snapshot_id: snapshotId,
    ...page,
  })) satisfies (typeof backlinkPageMetrics.$inferInsert)[];

  if (replayed) {
    const [storedFacts, storedPages] = await Promise.all([
      tx
        .select()
        .from(backlinkFacts)
        .where(
          and(
            eq(backlinkFacts.workspace_id, input.scope.workspaceId),
            eq(backlinkFacts.project_id, input.scope.projectId),
            eq(backlinkFacts.snapshot_id, snapshotId),
          ),
        )
        .limit(factValues.length + 1),
      tx
        .select()
        .from(backlinkPageMetrics)
        .where(
          and(
            eq(backlinkPageMetrics.workspace_id, input.scope.workspaceId),
            eq(backlinkPageMetrics.project_id, input.scope.projectId),
            eq(backlinkPageMetrics.snapshot_id, snapshotId),
          ),
        )
        .limit(pageValues.length + 1),
    ]);
    assertExactFactReplay(
      storedFacts as unknown as Record<string, unknown>[],
      facts,
    );
    assertExactPageReplay(
      storedPages as unknown as Record<string, unknown>[],
      pages,
    );
  } else {
    if (factValues.length > 0) {
      const insertedFacts = await tx
        .insert(backlinkFacts)
        .values(factValues)
        .onConflictDoNothing()
        .returning({ id: backlinkFacts.id });
      if (insertedFacts.length !== factValues.length) {
        fail("fact insert conflicted inside a new authority transaction");
      }
    }
    if (pageValues.length > 0) {
      const insertedPages = await tx
        .insert(backlinkPageMetrics)
        .values(pageValues)
        .onConflictDoNothing()
        .returning({ sitePageId: backlinkPageMetrics.site_page_id });
      if (insertedPages.length !== pageValues.length) {
        fail("page insert conflicted inside a new authority transaction");
      }
    }
  }

  return {
    snapshotId,
    replayed,
    factCount: facts.length,
    pageMetricCount: pages.length,
  };
}
