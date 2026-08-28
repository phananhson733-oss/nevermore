// @input  -- verified user scope, Marketing website RPCs, and service-role reads
// @output -- strict website summaries/details and stable store outcomes
// @pos    -- the only server module that reads or writes account website tables

import { createAdminSupabaseClient } from "../supabase/admin.ts";
import { z } from "zod";
import {
  MARKETING_WEBSITE_PROFILE_VERSION,
  canonicalProfileJson,
  isMarketingWebsiteProfileReady,
  normalizeAccountWebsiteUrl,
  parseMarketingWebsiteProfile,
  parseWebsiteDetails,
  parseWebsiteList,
  parseWebsiteProfileReference,
  parseWebsiteSummary,
  profileSha256,
  profileState,
  WEBSITE_PROFILE_REFERENCE_VERSION,
  type MarketingWebsiteProfileV1,
  type WebsiteDetails,
  type WebsiteProfileReferenceV1,
  type WebsiteSummary,
} from "./contracts.ts";

export type TransportOutcome =
  | { readonly kind: "ok"; readonly data: unknown }
  | {
      readonly kind: "error";
      readonly code: string | null;
      readonly message: string;
    };

interface WebsiteReadBundle {
  readonly websites: unknown;
  readonly drafts: unknown;
  readonly snapshots: unknown;
}

export interface WebsiteStoreDependencies {
  readonly readList: (userId: string) => Promise<TransportOutcome>;
  readonly readDetails: (
    userId: string,
    websiteId: string,
  ) => Promise<TransportOutcome>;
  readonly readSnapshot: (
    userId: string,
    websiteId: string,
    snapshotId: string,
  ) => Promise<TransportOutcome>;
  readonly callRpc: (
    name: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<TransportOutcome>;
}

export type WebsiteStoreResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "missing" }
  | { readonly kind: "duplicate"; readonly website: WebsiteSummary }
  | { readonly kind: "conflict"; readonly current: WebsiteDetails }
  | {
      readonly kind: "invalid";
      readonly code: string;
      readonly fields?: readonly WebsiteProfileRequiredField[];
    }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface ResolvedWebsiteProfile {
  readonly website: WebsiteSummary;
  readonly reference: WebsiteProfileReferenceV1;
  readonly profile: MarketingWebsiteProfileV1;
}

export type WebsiteProfileRequiredField =
  | "productName"
  | "oneLinePositioning"
  | "valueProposition"
  | "primaryIcp"
  | "locale";

const REQUIRED_PROFILE_FIELDS = [
  "productName",
  "oneLinePositioning",
  "valueProposition",
  "primaryIcp",
  "locale",
] as const satisfies readonly WebsiteProfileRequiredField[];

function missingRequiredProfileFields(
  profile: MarketingWebsiteProfileV1,
): readonly WebsiteProfileRequiredField[] {
  return REQUIRED_PROFILE_FIELDS.filter((field) => profile[field].trim() === "");
}

const WEBSITE_COLUMNS =
  "id,user_id,canonical_site_key,origin,host,display_name,is_primary,current_confirmed_snapshot_id,created_at,updated_at";
const WEBSITE_DETAIL_COLUMNS = `${WEBSITE_COLUMNS},submitted_url`;
const DRAFT_COLUMNS =
  "website_id,user_id,schema_version,draft_version,profile,content_hash,updated_at";
const SNAPSHOT_COLUMNS =
  "id,website_id,user_id,revision,schema_version,profile,content_hash,source_draft_version,confirmed_at";

function transport(
  data: unknown,
  error: { readonly code?: string; readonly message?: string } | null,
): TransportOutcome {
  return error === null
    ? { kind: "ok", data }
    : {
        kind: "error",
        code: typeof error.code === "string" ? error.code : null,
        message:
          typeof error.message === "string" ? error.message : "store request failed",
      };
}

async function readListViaSupabase(userId: string): Promise<TransportOutcome> {
  try {
    const client = createAdminSupabaseClient();
    const websites = await client
      .from("marketing_websites")
      .select(WEBSITE_COLUMNS)
      .eq("user_id", userId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (websites.error !== null) return transport(null, websites.error);
    const websiteRows = records(websites.data);
    if (websiteRows === null) {
      return {
        kind: "ok",
        data: { websites: websites.data, drafts: null, snapshots: null },
      };
    }
    const websiteIds = websiteRows.flatMap((row) =>
      typeof row.id === "string" ? [row.id] : [],
    );
    const snapshotIds = websiteRows.flatMap((row) =>
      typeof row.current_confirmed_snapshot_id === "string"
        ? [row.current_confirmed_snapshot_id]
        : [],
    );
    const empty = Promise.resolve({ data: [], error: null });
    const [drafts, snapshots] = await Promise.all([
      websiteIds.length === 0
        ? empty
        : client
            .from("marketing_website_profile_drafts")
            .select(DRAFT_COLUMNS)
            .eq("user_id", userId)
            .in("website_id", websiteIds),
      snapshotIds.length === 0
        ? empty
        : client
            .from("marketing_website_profile_snapshots")
            .select(SNAPSHOT_COLUMNS)
            .eq("user_id", userId)
            .in("id", snapshotIds),
    ]);
    const error = websites.error ?? drafts.error ?? snapshots.error;
    return transport(
      {
        websites: websites.data,
        drafts: drafts.data,
        snapshots: snapshots.data,
      },
      error,
    );
  } catch {
    return { kind: "error", code: null, message: "store request failed" };
  }
}

async function readDetailsViaSupabase(
  userId: string,
  websiteId: string,
): Promise<TransportOutcome> {
  try {
    const client = createAdminSupabaseClient();
    const [website, draft] = await Promise.all([
      client
        .from("marketing_websites")
        .select(WEBSITE_DETAIL_COLUMNS)
        .eq("user_id", userId)
        .eq("id", websiteId)
        .maybeSingle(),
      client
        .from("marketing_website_profile_drafts")
        .select(DRAFT_COLUMNS)
        .eq("user_id", userId)
        .eq("website_id", websiteId)
        .maybeSingle(),
    ]);
    if (website.error !== null || draft.error !== null) {
      return transport(null, website.error ?? draft.error);
    }
    if (website.data === null) {
      return {
        kind: "ok",
        data: { websites: [], drafts: [], snapshots: [] },
      };
    }
    const websiteRecord = website.data as Record<string, unknown>;
    const snapshotId = websiteRecord.current_confirmed_snapshot_id;
    let snapshotData: unknown = [];
    if (typeof snapshotId === "string") {
      const snapshot = await client
        .from("marketing_website_profile_snapshots")
        .select(SNAPSHOT_COLUMNS)
        .eq("user_id", userId)
        .eq("website_id", websiteId)
        .eq("id", snapshotId)
        .maybeSingle();
      if (snapshot.error !== null) return transport(null, snapshot.error);
      snapshotData = snapshot.data === null ? [] : [snapshot.data];
    }
    return {
      kind: "ok",
      data: {
        websites: [website.data],
        drafts: draft.data === null ? [] : [draft.data],
        snapshots: snapshotData,
      },
    };
  } catch {
    return { kind: "error", code: null, message: "store request failed" };
  }
}

async function readSnapshotViaSupabase(
  userId: string,
  websiteId: string,
  snapshotId: string,
): Promise<TransportOutcome> {
  try {
    const client = createAdminSupabaseClient();
    const snapshot = await client
      .from("marketing_website_profile_snapshots")
      .select(SNAPSHOT_COLUMNS)
      .eq("user_id", userId)
      .eq("website_id", websiteId)
      .eq("id", snapshotId)
      .maybeSingle();
    return transport(snapshot.data, snapshot.error);
  } catch {
    return { kind: "error", code: null, message: "store request failed" };
  }
}

async function callRpcViaSupabase(
  name: string,
  params: Readonly<Record<string, unknown>>,
): Promise<TransportOutcome> {
  try {
    const client = createAdminSupabaseClient();
    const { data, error } = await client.rpc(name, params);
    return transport(data, error);
  } catch {
    return { kind: "error", code: null, message: "store request failed" };
  }
}

export const DEFAULT_WEBSITE_STORE_DEPENDENCIES: WebsiteStoreDependencies = {
  readList: readListViaSupabase,
  readDetails: readDetailsViaSupabase,
  readSnapshot: readSnapshotViaSupabase,
  callRpc: callRpcViaSupabase,
};

function unavailable(outcome: {
  readonly code: string | null;
}): WebsiteStoreResult<never> {
  const reason = outcome.code ?? "store_unavailable";
  console.error("[account-websites-store] unavailable", { code: reason });
  return { kind: "unavailable", reason };
}

function records(value: unknown): readonly Record<string, unknown>[] | null {
  return Array.isArray(value) &&
    value.every(
      (entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry),
    )
    ? (value as readonly Record<string, unknown>[])
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readBundle(value: unknown): WebsiteReadBundle | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const bundle = value as Readonly<Record<string, unknown>>;
  return records(bundle.websites) !== null &&
    records(bundle.drafts) !== null &&
    records(bundle.snapshots) !== null
    ? {
        websites: bundle.websites,
        drafts: bundle.drafts,
        snapshots: bundle.snapshots,
      }
    : null;
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`${key} is malformed`);
  return value;
}

function nullableString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${key} is malformed`);
  return value;
}

function requiredInteger(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (!Number.isInteger(value)) throw new Error(`${key} is malformed`);
  return value as number;
}

function requiredDbTimestamp(
  row: Record<string, unknown>,
  key: string,
): string {
  const value = requiredString(row, key);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    )
  ) {
    throw new Error(`${key} is malformed`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${key} is malformed`);
  return new Date(parsed).toISOString();
}

function assertOwnedBundle(bundle: WebsiteReadBundle, userId: string): void {
  const websites = records(bundle.websites) as readonly Record<string, unknown>[];
  const drafts = records(bundle.drafts) as readonly Record<string, unknown>[];
  const snapshots = records(bundle.snapshots) as readonly Record<string, unknown>[];
  const websiteIds = new Set<string>();
  const currentSnapshotWebsites = new Map<string, string>();

  for (const row of websites) {
    const websiteId = requiredString(row, "id");
    if (requiredString(row, "user_id") !== userId || websiteIds.has(websiteId)) {
      throw new Error("website ownership is malformed");
    }
    websiteIds.add(websiteId);
    const snapshotId = nullableString(row, "current_confirmed_snapshot_id");
    if (snapshotId !== null) {
      if (currentSnapshotWebsites.has(snapshotId)) {
        throw new Error("confirmed snapshot identity is duplicated");
      }
      currentSnapshotWebsites.set(snapshotId, websiteId);
    }
  }

  const draftWebsites = new Set<string>();
  for (const row of drafts) {
    const websiteId = requiredString(row, "website_id");
    if (
      requiredString(row, "user_id") !== userId ||
      requiredString(row, "schema_version") !==
        MARKETING_WEBSITE_PROFILE_VERSION ||
      !websiteIds.has(websiteId) ||
      draftWebsites.has(websiteId)
    ) {
      throw new Error("draft ownership or version is malformed");
    }
    draftWebsites.add(websiteId);
  }

  const snapshotIds = new Set<string>();
  for (const row of snapshots) {
    const snapshotId = requiredString(row, "id");
    const websiteId = requiredString(row, "website_id");
    if (
      requiredString(row, "user_id") !== userId ||
      requiredString(row, "schema_version") !==
        MARKETING_WEBSITE_PROFILE_VERSION ||
      currentSnapshotWebsites.get(snapshotId) !== websiteId ||
      snapshotIds.has(snapshotId)
    ) {
      throw new Error("snapshot ownership or version is malformed");
    }
    snapshotIds.add(snapshotId);
  }
  if (snapshotIds.size !== currentSnapshotWebsites.size) {
    throw new Error("confirmed snapshot details are incomplete");
  }
}

function mapSummaryRows(
  bundle: WebsiteReadBundle,
  userId: string,
): readonly WebsiteSummary[] {
  assertOwnedBundle(bundle, userId);
  const websites = records(bundle.websites) as readonly Record<string, unknown>[];
  const drafts = records(bundle.drafts) as readonly Record<string, unknown>[];
  const snapshots = records(bundle.snapshots) as readonly Record<string, unknown>[];
  const draftByWebsite = new Map(drafts.map((row) => [row.website_id, row]));
  const snapshotById = new Map(snapshots.map((row) => [row.id, row]));

  return websites.map((row) => {
    const websiteId = requiredString(row, "id");
    const draft = draftByWebsite.get(websiteId);
    const snapshotId = nullableString(row, "current_confirmed_snapshot_id");
    const snapshot = snapshotId === null ? undefined : snapshotById.get(snapshotId);
    return parseWebsiteSummary({
      websiteId,
      origin: requiredString(row, "origin"),
      host: requiredString(row, "host"),
      canonicalSiteKey: requiredString(row, "canonical_site_key"),
      displayName: nullableString(row, "display_name"),
      isPrimary:
        typeof row.is_primary === "boolean"
          ? row.is_primary
          : (() => {
              throw new Error("is_primary is malformed");
            })(),
      profileState: profileState(
        draft === undefined ? null : requiredString(draft, "content_hash"),
        snapshot === undefined ? null : requiredString(snapshot, "content_hash"),
      ),
      confirmedSnapshotId: snapshotId,
      confirmedSnapshotRevision:
        snapshot === undefined ? null : requiredInteger(snapshot, "revision"),
      confirmedAt:
        snapshot === undefined
          ? null
          : requiredDbTimestamp(snapshot, "confirmed_at"),
      createdAt: requiredDbTimestamp(row, "created_at"),
      updatedAt: requiredDbTimestamp(row, "updated_at"),
    });
  });
}

function mapSummaries(
  bundle: WebsiteReadBundle,
  userId: string,
): readonly WebsiteSummary[] {
  return parseWebsiteList(mapSummaryRows(bundle, userId));
}

async function mapDetails(
  bundle: WebsiteReadBundle,
  userId: string,
): Promise<WebsiteDetails | null> {
  const summaries = mapSummaryRows(bundle, userId);
  if (summaries.length > 1) {
    throw new Error("detail response contains more than one website");
  }
  const summary = summaries[0];
  if (summary === undefined) return null;
  const websiteRows = records(bundle.websites) as readonly Record<
    string,
    unknown
  >[];
  const websiteRow = websiteRows.find((row) => row.id === summary.websiteId);
  if (websiteRow === undefined) {
    throw new Error("detail response is missing its website row");
  }
  const drafts = records(bundle.drafts) as readonly Record<string, unknown>[];
  const snapshots = records(bundle.snapshots) as readonly Record<string, unknown>[];
  const draft = drafts.find((row) => row.website_id === summary.websiteId);
  const snapshot = snapshots.find(
    (row) => row.id === summary.confirmedSnapshotId,
  );
  return parseWebsiteDetails({
    ...summary,
    submittedUrl: requiredString(websiteRow, "submitted_url"),
    draft:
      draft === undefined
        ? null
        : {
            draftVersion: requiredInteger(draft, "draft_version"),
            updatedAt: requiredDbTimestamp(draft, "updated_at"),
            profileHash: requiredString(draft, "content_hash"),
            profile: parseMarketingWebsiteProfile(draft.profile),
          },
    currentConfirmedSnapshot:
      snapshot === undefined
        ? null
        : {
            schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
            websiteId: requiredString(snapshot, "website_id"),
            snapshotId: requiredString(snapshot, "id"),
            snapshotRevision: requiredInteger(snapshot, "revision"),
            profileSchemaVersion: requiredString(snapshot, "schema_version"),
            profileHash: requiredString(snapshot, "content_hash"),
            confirmedAt: requiredDbTimestamp(snapshot, "confirmed_at"),
            profile: parseMarketingWebsiteProfile(snapshot.profile),
          },
  });
}

function summaryFromDetails({
  submittedUrl: _submittedUrl,
  draft: _draft,
  currentConfirmedSnapshot: _currentConfirmedSnapshot,
  ...summary
}: WebsiteDetails): WebsiteSummary {
  return parseWebsiteSummary(summary);
}

export async function listAccountWebsites(
  userId: string,
  dependencies: WebsiteStoreDependencies = DEFAULT_WEBSITE_STORE_DEPENDENCIES,
): Promise<WebsiteStoreResult<readonly WebsiteSummary[]>> {
  const outcome = await dependencies.readList(userId).catch(() => ({
    kind: "error" as const,
    code: null,
    message: "store request failed",
  }));
  if (outcome.kind === "error") return unavailable(outcome);
  const bundle = readBundle(outcome.data);
  if (bundle === null) return unavailable({ code: "malformed_store_response" });
  try {
    return { kind: "ok", value: mapSummaries(bundle, userId) };
  } catch {
    return unavailable({ code: "malformed_store_response" });
  }
}

export async function readAccountWebsite(
  userId: string,
  websiteId: string,
  dependencies: WebsiteStoreDependencies = DEFAULT_WEBSITE_STORE_DEPENDENCIES,
): Promise<WebsiteStoreResult<WebsiteDetails>> {
  const outcome = await dependencies.readDetails(userId, websiteId).catch(() => ({
    kind: "error" as const,
    code: null,
    message: "store request failed",
  }));
  if (outcome.kind === "error") return unavailable(outcome);
  const bundle = readBundle(outcome.data);
  if (bundle === null) return unavailable({ code: "malformed_store_response" });
  try {
    const details = await mapDetails(bundle, userId);
    return details === null ? { kind: "missing" } : { kind: "ok", value: details };
  } catch {
    return unavailable({ code: "malformed_store_response" });
  }
}

export async function findAccountWebsiteByUrl(
  userId: string,
  url: string,
  dependencies: WebsiteStoreDependencies = DEFAULT_WEBSITE_STORE_DEPENDENCIES,
): Promise<WebsiteStoreResult<ResolvedWebsiteProfile>> {
  const normalized = normalizeAccountWebsiteUrl(url);
  if (normalized === null) return { kind: "invalid", code: "invalid_url" };
  const list = await listAccountWebsites(userId, dependencies);
  if (list.kind !== "ok") return list;
  const website = list.value.find(
    (entry) => entry.canonicalSiteKey === normalized.canonicalSiteKey,
  );
  if (website === undefined) return { kind: "missing" };
  const details = await readAccountWebsite(userId, website.websiteId, dependencies);
  if (details.kind !== "ok") return details;
  const snapshot = details.value.currentConfirmedSnapshot;
  if (snapshot === null) {
    return { kind: "invalid", code: "profile_not_confirmed" };
  }
  const reference = parseWebsiteProfileReference({
    schemaVersion: snapshot.schemaVersion,
    websiteId: snapshot.websiteId,
    snapshotId: snapshot.snapshotId,
    snapshotRevision: snapshot.snapshotRevision,
    profileSchemaVersion: snapshot.profileSchemaVersion,
    profileHash: snapshot.profileHash,
  });
  return {
    kind: "ok",
    value: {
      website: summaryFromDetails(details.value),
      reference,
      profile: snapshot.profile,
    },
  };
}

export async function resolveAccountWebsiteProfileReference(
  userId: string,
  input: unknown,
  dependencies: WebsiteStoreDependencies = DEFAULT_WEBSITE_STORE_DEPENDENCIES,
): Promise<WebsiteStoreResult<ResolvedWebsiteProfile>> {
  let reference: WebsiteProfileReferenceV1;
  try {
    reference = parseWebsiteProfileReference(input);
  } catch {
    return { kind: "invalid", code: "invalid_reference" };
  }

  const website = await readAccountWebsite(
    userId,
    reference.websiteId,
    dependencies,
  );
  if (website.kind !== "ok") return website;
  if (website.value.websiteId !== reference.websiteId) {
    return unavailable({ code: "malformed_store_response" });
  }

  const outcome = await dependencies
    .readSnapshot(userId, reference.websiteId, reference.snapshotId)
    .catch(() => ({
      kind: "error" as const,
      code: null,
      message: "store request failed",
    }));
  if (outcome.kind === "error") return unavailable(outcome);
  if (outcome.data === null) return { kind: "missing" };

  const row = record(outcome.data);
  if (row === null) return unavailable({ code: "malformed_store_response" });
  try {
    const rowUserId = z.string().uuid().parse(row.user_id);
    const rowReference = parseWebsiteProfileReference({
      schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
      websiteId: requiredString(row, "website_id"),
      snapshotId: requiredString(row, "id"),
      snapshotRevision: requiredInteger(row, "revision"),
      profileSchemaVersion: requiredString(row, "schema_version"),
      profileHash: requiredString(row, "content_hash"),
    });
    const sourceDraftVersion = requiredInteger(row, "source_draft_version");
    requiredDbTimestamp(row, "confirmed_at");
    const profile = parseMarketingWebsiteProfile(row.profile);
    const computedHash = await profileSha256(profile);

    if (
      rowUserId !== userId ||
      rowReference.websiteId !== reference.websiteId ||
      rowReference.snapshotId !== reference.snapshotId ||
      rowReference.snapshotRevision !== reference.snapshotRevision ||
      rowReference.profileSchemaVersion !== reference.profileSchemaVersion ||
      rowReference.profileHash !== reference.profileHash ||
      sourceDraftVersion <= 0 ||
      computedHash !== reference.profileHash
    ) {
      throw new Error("referenced snapshot identity is malformed");
    }

    return {
      kind: "ok",
      value: {
        website: summaryFromDetails(website.value),
        reference,
        profile,
      },
    };
  } catch {
    return unavailable({ code: "malformed_store_response" });
  }
}

function rpcRow(outcome: TransportOutcome): Record<string, unknown> | null {
  if (outcome.kind === "error") return null;
  const rows = records(outcome.data);
  return rows?.[0] ?? null;
}

export async function addAccountWebsite(
  input: {
    readonly userId: string;
    readonly url: string;
    readonly displayName: string | null;
  },
  dependencies: WebsiteStoreDependencies = DEFAULT_WEBSITE_STORE_DEPENDENCIES,
): Promise<WebsiteStoreResult<WebsiteDetails>> {
  const normalized = normalizeAccountWebsiteUrl(input.url);
  if (normalized === null) return { kind: "invalid", code: "invalid_url" };
  const outcome = await dependencies.callRpc("marketing_add_website", {
    p_user_id: input.userId,
    p_submitted_url: normalized.submittedUrl,
    p_origin: normalized.origin,
    p_host: normalized.host,
    p_canonical_site_key: normalized.canonicalSiteKey,
    p_display_name: input.displayName,
  });
  if (outcome.kind === "error") return unavailable(outcome);
  const row = rpcRow(outcome);
  if (row === null || typeof row.outcome !== "string") {
    return unavailable({ code: "malformed_store_response" });
  }
  if (row.outcome !== "created" && row.outcome !== "duplicate") {
    return unavailable({ code: "malformed_store_response" });
  }
  const websiteIdResult = z.string().uuid().safeParse(row.website_id);
  if (!websiteIdResult.success) {
    return unavailable({ code: "malformed_store_response" });
  }
  const websiteId = websiteIdResult.data;
  const current = await readAccountWebsite(
    input.userId,
    websiteId,
    dependencies,
  );
  if (current.kind !== "ok") return current;
  return row.outcome === "duplicate"
    ? { kind: "duplicate", website: summaryFromDetails(current.value) }
    : current;
}

export async function setPrimaryAccountWebsite(
  input: { readonly userId: string; readonly websiteId: string },
  dependencies: WebsiteStoreDependencies = DEFAULT_WEBSITE_STORE_DEPENDENCIES,
): Promise<WebsiteStoreResult<WebsiteDetails>> {
  const outcome = await dependencies.callRpc("marketing_set_primary_website", {
    p_user_id: input.userId,
    p_website_id: input.websiteId,
  });
  if (outcome.kind === "error") return unavailable(outcome);
  const row = rpcRow(outcome);
  if (row?.outcome === "not_found") return { kind: "missing" };
  if (row?.outcome !== "ok") return unavailable({ code: "malformed_store_response" });
  return readAccountWebsite(input.userId, input.websiteId, dependencies);
}

export async function saveAccountWebsiteDraft(
  input: {
    readonly userId: string;
    readonly websiteId: string;
    readonly baseVersion: number;
    readonly profile: MarketingWebsiteProfileV1;
    readonly expectedReference?: WebsiteProfileReferenceV1;
  },
  dependencies: WebsiteStoreDependencies = DEFAULT_WEBSITE_STORE_DEPENDENCIES,
): Promise<WebsiteStoreResult<WebsiteDetails>> {
  let profile: MarketingWebsiteProfileV1;
  try {
    profile = parseMarketingWebsiteProfile(input.profile);
  } catch {
    return { kind: "invalid", code: "invalid_profile" };
  }
  let expectedReference: WebsiteProfileReferenceV1 | undefined;
  try {
    expectedReference =
      input.expectedReference === undefined
        ? undefined
        : parseWebsiteProfileReference(input.expectedReference);
  } catch {
    return { kind: "invalid", code: "invalid_reference" };
  }
  if (
    expectedReference !== undefined &&
    expectedReference.websiteId !== input.websiteId
  ) {
    return { kind: "invalid", code: "invalid_reference" };
  }
  const canonical = canonicalProfileJson(profile);
  const hash = await profileSha256(profile);
  const outcome = await dependencies.callRpc(
    expectedReference === undefined
      ? "marketing_save_website_profile_draft"
      : "marketing_save_website_profile_draft_from_snapshot",
    {
      p_user_id: input.userId,
      p_website_id: input.websiteId,
      p_base_version: input.baseVersion,
      p_schema_version: MARKETING_WEBSITE_PROFILE_VERSION,
      p_profile: profile,
      p_canonical_profile: canonical,
      p_content_hash: hash,
      ...(expectedReference === undefined
        ? {}
        : {
            p_expected_snapshot_id: expectedReference.snapshotId,
            p_expected_snapshot_hash: expectedReference.profileHash,
          }),
    },
  );
  if (outcome.kind === "error") return unavailable(outcome);
  const row = rpcRow(outcome);
  if (row === null || typeof row.outcome !== "string") {
    return unavailable({ code: "malformed_store_response" });
  }
  if (row?.outcome === "not_found") return { kind: "missing" };
  if (
    row.outcome !== "ok" &&
    row.outcome !== "conflict" &&
    row.outcome !== "snapshot_conflict" &&
    row.outcome !== "invalid_hash"
  ) {
    return unavailable({ code: "malformed_store_response" });
  }
  if (row.outcome === "invalid_hash") {
    return unavailable({ code: "profile_hash_rejected" });
  }
  const current = await readAccountWebsite(
    input.userId,
    input.websiteId,
    dependencies,
  );
  if (current.kind !== "ok") return current;
  if (
    row.outcome === "conflict" ||
    row.outcome === "snapshot_conflict"
  ) {
    return { kind: "conflict", current: current.value };
  }
  return current;
}

export async function confirmAccountWebsiteProfile(
  input: {
    readonly userId: string;
    readonly websiteId: string;
    readonly baseVersion: number;
  },
  dependencies: WebsiteStoreDependencies = DEFAULT_WEBSITE_STORE_DEPENDENCIES,
): Promise<WebsiteStoreResult<WebsiteDetails>> {
  const before = await readAccountWebsite(
    input.userId,
    input.websiteId,
    dependencies,
  );
  if (before.kind !== "ok") return before;
  if (
    before.value.draft === null ||
    !isMarketingWebsiteProfileReady(before.value.draft.profile)
  ) {
    return {
      kind: "invalid",
      code: "profile_incomplete",
      fields:
        before.value.draft === null
          ? REQUIRED_PROFILE_FIELDS
          : missingRequiredProfileFields(before.value.draft.profile),
    };
  }
  const outcome = await dependencies.callRpc(
    "marketing_confirm_website_profile",
    {
      p_user_id: input.userId,
      p_website_id: input.websiteId,
      p_base_version: input.baseVersion,
    },
  );
  if (outcome.kind === "error") return unavailable(outcome);
  const row = rpcRow(outcome);
  if (row === null || typeof row.outcome !== "string") {
    return unavailable({ code: "malformed_store_response" });
  }
  if (row.outcome === "not_found") return { kind: "missing" };
  if (row.outcome === "conflict") {
    const current = await readAccountWebsite(
      input.userId,
      input.websiteId,
      dependencies,
    );
    return current.kind === "ok"
      ? { kind: "conflict", current: current.value }
      : current;
  }
  if (row.outcome !== "ok") {
    return unavailable({ code: "malformed_store_response" });
  }
  return readAccountWebsite(input.userId, input.websiteId, dependencies);
}
