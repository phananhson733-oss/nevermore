// @input  -- one exact confirmed Marketing website snapshot or profile
// @output -- bounded detached or pinned seed projections for Keyword Map
// @pos    -- client/server-safe adapter between website profiles and keyword runs

import {
  normalizeAccountWebsiteUrl,
  parseMarketingWebsiteProfile,
  parseWebsiteDetails,
  parseWebsiteProfileReference,
  profileSha256,
  type MarketingWebsiteProfileV1,
  type WebsiteDetails,
  type WebsiteProfileReferenceV1,
} from "./contracts.ts";

export const KEYWORD_PROFILE_PINNED_SEED_CAP = 6;
const KEYWORD_SEED_CAP = 10;
const KEYWORD_SEED_MAX_LENGTH = 80;

export interface ImportedKeywordWebsiteProfile {
  readonly kind: "import";
  readonly websiteOrigin: string;
  readonly canonicalSiteKey: string;
  readonly country: string;
  readonly locale: string;
  readonly editableSeeds: readonly string[];
  readonly reference: null;
}

export interface ReferencedKeywordWebsiteProfile {
  readonly kind: "reference";
  readonly websiteOrigin: string;
  readonly canonicalSiteKey: string;
  readonly country: string;
  readonly locale: string;
  readonly pinnedSeeds: readonly string[];
  readonly reference: WebsiteProfileReferenceV1;
}

function normalizeSeed(value: string, rejectComma: boolean): string | null {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (
    normalized === "" ||
    normalized.length > KEYWORD_SEED_MAX_LENGTH ||
    (rejectComma && normalized.includes(","))
  ) {
    return null;
  }
  return normalized;
}

function appendUnique(
  output: string[],
  seen: Set<string>,
  value: string,
  rejectComma: boolean,
): void {
  const normalized = normalizeSeed(value, rejectComma);
  if (normalized === null) return;
  const key = normalized.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  output.push(normalized);
}

/**
 * Project the smallest useful keyword context from a confirmed profile.
 *
 * Source order is part of the contract. Values that do not fit the existing
 * 80-character comma-separated input are omitted, never truncated into a new
 * fact. Six pinned terms leave four of the existing ten slots for a visitor's
 * run-local overlay.
 */
export function projectKeywordProfileSeeds(
  input: MarketingWebsiteProfileV1,
): readonly string[] {
  const profile = parseMarketingWebsiteProfile(input);
  const output: string[] = [];
  const seen = new Set<string>();
  const sources: readonly (readonly string[])[] = [
    profile.categories,
    profile.coreFeatures,
    profile.useCases,
    profile.icpInterests,
    [profile.primaryIcp],
    [profile.jtbd],
  ];
  for (const source of sources) {
    for (const value of source) {
      appendUnique(output, seen, value, true);
      if (output.length === KEYWORD_PROFILE_PINNED_SEED_CAP) return output;
    }
  }
  return output;
}

/** Pinned terms lead; the visitor overlay fills only the remaining slots. */
export function mergeKeywordProfileSeeds(
  pinned: readonly string[],
  overlay: readonly string[],
): readonly string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of pinned.slice(0, KEYWORD_PROFILE_PINNED_SEED_CAP)) {
    appendUnique(output, seen, value, true);
  }
  for (const value of overlay) {
    appendUnique(output, seen, value, false);
    if (output.length === KEYWORD_SEED_CAP) break;
  }
  return output;
}

async function exactProjectionSource(input: WebsiteDetails): Promise<{
  readonly websiteOrigin: string;
  readonly canonicalSiteKey: string;
  readonly country: string;
  readonly locale: string;
  readonly seeds: readonly string[];
  readonly reference: WebsiteProfileReferenceV1;
}> {
  const website = await parseWebsiteDetails(input);
  const normalized = normalizeAccountWebsiteUrl(website.origin);
  if (
    normalized === null ||
    normalized.origin !== website.origin ||
    normalized.canonicalSiteKey !== website.canonicalSiteKey
  ) {
    throw new Error("website profile canonical identity does not match");
  }
  const snapshot = website.currentConfirmedSnapshot;
  if (snapshot === null) {
    throw new Error("website profile must have a confirmed snapshot");
  }
  const reference = parseWebsiteProfileReference({
    schemaVersion: snapshot.schemaVersion,
    websiteId: snapshot.websiteId,
    snapshotId: snapshot.snapshotId,
    snapshotRevision: snapshot.snapshotRevision,
    profileSchemaVersion: snapshot.profileSchemaVersion,
    profileHash: snapshot.profileHash,
  });
  if (
    reference.websiteId !== website.websiteId ||
    (await profileSha256(snapshot.profile)) !== reference.profileHash
  ) {
    throw new Error("website profile hash or reference identity does not match");
  }
  return {
    websiteOrigin: normalized.origin,
    canonicalSiteKey: normalized.canonicalSiteKey,
    country: snapshot.profile.country,
    locale: snapshot.profile.locale,
    seeds: projectKeywordProfileSeeds(snapshot.profile),
    reference,
  };
}

/** Detached copy: editable seeds and no durable link or write-back path. */
export async function importWebsiteProfileForKeywords(
  website: WebsiteDetails,
): Promise<ImportedKeywordWebsiteProfile> {
  const source = await exactProjectionSource(website);
  return {
    kind: "import",
    websiteOrigin: source.websiteOrigin,
    canonicalSiteKey: source.canonicalSiteKey,
    country: source.country,
    locale: source.locale,
    editableSeeds: source.seeds,
    reference: null,
  };
}

/** Exact link: pinned seeds plus the immutable snapshot reference. */
export async function referenceWebsiteProfileForKeywords(
  website: WebsiteDetails,
): Promise<ReferencedKeywordWebsiteProfile> {
  const source = await exactProjectionSource(website);
  return {
    kind: "reference",
    websiteOrigin: source.websiteOrigin,
    canonicalSiteKey: source.canonicalSiteKey,
    country: source.country,
    locale: source.locale,
    pinnedSeeds: source.seeds,
    reference: source.reference,
  };
}

function sameReference(
  left: WebsiteProfileReferenceV1,
  right: WebsiteProfileReferenceV1,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.websiteId === right.websiteId &&
    left.snapshotId === right.snapshotId &&
    left.snapshotRevision === right.snapshotRevision &&
    left.profileSchemaVersion === right.profileSchemaVersion &&
    left.profileHash === right.profileHash
  );
}

/** Strictly bind the context response to the reference that was requested. */
export function parseAcceptedKeywordProfileReference(
  value: unknown,
  expected: WebsiteProfileReferenceV1 | null,
): WebsiteProfileReferenceV1 | null {
  if (expected === null) {
    if (value !== undefined) {
      throw new Error("detached keyword context returned a profile reference");
    }
    return null;
  }
  const parsed = parseWebsiteProfileReference(value);
  if (!sameReference(parsed, expected)) {
    throw new Error("keyword context accepted a different profile reference");
  }
  return parsed;
}
