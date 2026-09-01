// @input  -- an untrusted knowledge-base payload from the editor, or a row read back from Postgres
// @output -- a validated payload, its canonical text, and the digest both sides agree on
// @pos    -- the identity of a GEO knowledge base; the database recomputes this digest and refuses a mismatch

import { isMatchableGeoName } from "../agents/geo-alias-match.ts";
import { isSupportedGeoQuestionLanguage } from "./asset-context.ts";
import { geoKbJsonbBytes, parseGeoProfileCopy, type GeoProfileCopy } from "./kb-profile-copy.ts";

export const GEO_KB_SCHEMA_VERSION = "marketing-geo-kb.v1" as const;

/**
 * Payload scalars are strings, booleans or null (including exact Profile
 * provenance). No numbers; source revisions use an explicit string.
 *
 * The digest below has to be byte-identical to the one Postgres computes from
 * its own canonical form, and number formatting is the one place JSON.stringify
 * and jsonb::text can legitimately disagree (1e3 against 1000). Banning numbers
 * removes the disagreement instead of documenting it.
 */
export type GeoKbScalar = string | boolean | null;
export type GeoKbValue =
  | GeoKbScalar
  | readonly GeoKbValue[]
  | { readonly [key: string]: GeoKbValue };

export interface GeoKbRole {
  readonly id: string;
  readonly label: string;
  readonly segment: string;
  readonly painPoints: readonly string[];
  readonly decisionCriteria: readonly string[];
  /** Words this role actually uses; they become required entities in questions. */
  readonly vocabulary: readonly string[];
}

export interface GeoKbCompetitor {
  /** Omitted on historical v1 payloads; aliases never count as extra brands. */
  readonly aliases?: readonly string[];
  /**
   * Empty when the competitor is known by name only.
   *
   * An import from the account profile carries free text - some entries are
   * hostnames and some are brand names - and dropping the ones without a
   * hostname would quietly shorten a list the visitor wrote themselves.
   */
  readonly domain: string;
  /**
   * What a model calls them, which is not the domain.
   *
   * Empty until someone confirms it. A competitor without a confirmed brand
   * name is carried and excluded from share-of-voice rather than dropped, so
   * the report can say which ones it left out.
   */
  readonly brandName: string;
  readonly confirmed: boolean;
}

export interface GeoKbFact {
  readonly key: string;
  /** Empty string means unverified; `reason` then says why. Never invented. */
  readonly value: string;
  readonly reason: "" | "notPublished" | "fetchFailed" | "lowConfidence" | "conflicting";
  readonly sourceUrl: string;
  readonly observedAt: string;
}

export interface GeoKbPayload {
  /** Complete exact source data; absent only in legacy partial payloads. */
  readonly profileCopy?: GeoProfileCopy;
  readonly schemaVersion: typeof GEO_KB_SCHEMA_VERSION;
  readonly targetUrl: string;
  /** What a model calls this brand. The root of every mention decision. */
  readonly officialName: string;
  readonly aliases: readonly string[];
  readonly categoryTerms: readonly string[];
  readonly market: { readonly country: string; readonly language: string };
  readonly roles: readonly GeoKbRole[];
  readonly competitors: readonly GeoKbCompetitor[];
  readonly facts: readonly GeoKbFact[];
  /**
   * Which confirmed website-profile snapshot the import came from, if any.
   *
   * Recorded rather than synced: the account profile and this knowledge base
   * are edited separately after the import, and pretending otherwise would let
   * one silently rewrite the other's frozen history.
   */
  readonly importedFrom: {
    readonly websiteId: string;
    readonly snapshotId: string;
    readonly snapshotRevision: string;
  } | null;
}

/* ------------------------------------------------------------------ */
/* Canonical text and digest                                           */
/* ------------------------------------------------------------------ */

/**
 * The same canonical form `marketing_canonical_jsonb_text` produces: object
 * keys sorted, array order kept, no presentation whitespace.
 *
 * This module stays free of Node builtins because the editor imports its
 * limits and types. The digest lives in `kb-digest.ts`, which does not.
 */
export function canonicalGeoKbText(value: GeoKbValue | null): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalGeoKbText(entry)).join(",")}]`;
  }
  const record = value as { readonly [key: string]: GeoKbValue };
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalGeoKbText(record[key]!)}`)
    .join(",")}}`;
}


/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type GeoKbRejection =
  | "not_an_object"
  | "schema_version"
  | "target_url"
  | "official_name"
  | "aliases"
  | "category_terms"
  | "market"
  | "roles"
  | "competitors"
  | "facts"
  | "imported_from"
  | "profile_copy"
  | "too_large"
  | "control_characters";

export type GeoKbParseResult =
  | { readonly ok: true; readonly value: GeoKbPayload }
  | { readonly ok: false; readonly reason: GeoKbRejection };

export const GEO_KB_LIMITS = {
  aliases: 12,
  categoryTerms: 8,
  roles: 5,
  competitors: 5,
  facts: 24,
  listItem: 80,
  text: 200,
  url: 2_048,
  payloadBytes: 393_216,
} as const;

/**
 * Control characters are rejected outright.
 *
 * Postgres normalizes some escapes when a string enters jsonb, so a payload
 * carrying them can come back out spelled differently and stop matching its own
 * digest. Refusing them keeps the two canonical forms identical rather than
 * approximately identical.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > maxLength) return null;
  if (CONTROL_CHARACTERS.test(trimmed)) return null;
  return trimmed.normalize("NFC");
}

function cleanList(
  value: unknown,
  maxItems: number,
  maxLength: number,
): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > maxItems) return null;
  const out: string[] = [];
  for (const entry of value) {
    const cleaned = cleanString(entry, maxLength);
    if (cleaned === null) return null;
    if (cleaned.length === 0) continue;
    if (!out.includes(cleaned)) out.push(cleaned);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FACT_REASONS: ReadonlySet<string> = new Set([
  "",
  "notPublished",
  "fetchFailed",
  "lowConfidence",
  "conflicting",
]);

function parseRoles(value: unknown): readonly GeoKbRole[] | null {
  if (!Array.isArray(value) || value.length > GEO_KB_LIMITS.roles) return null;
  const roles: GeoKbRole[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const id = cleanString(entry["id"], 64);
    const label = cleanString(entry["label"], GEO_KB_LIMITS.text);
    const segment = cleanString(entry["segment"], GEO_KB_LIMITS.text);
    const painPoints = cleanList(entry["painPoints"], 8, GEO_KB_LIMITS.listItem);
    const decisionCriteria = cleanList(
      entry["decisionCriteria"],
      8,
      GEO_KB_LIMITS.listItem,
    );
    const vocabulary = cleanList(entry["vocabulary"], 12, GEO_KB_LIMITS.listItem);
    if (
      id === null ||
      id.length === 0 ||
      label === null ||
      segment === null ||
      painPoints === null ||
      decisionCriteria === null ||
      vocabulary === null ||
      seen.has(id)
    ) {
      return null;
    }
    seen.add(id);
    roles.push({ id, label, segment, painPoints, decisionCriteria, vocabulary });
  }
  return roles;
}

function parseCompetitors(value: unknown): readonly GeoKbCompetitor[] | null {
  if (!Array.isArray(value) || value.length > GEO_KB_LIMITS.competitors) {
    return null;
  }
  const competitors: GeoKbCompetitor[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const domain = cleanString(entry["domain"], 255)?.toLowerCase() ?? null;
    const brandName = cleanString(entry["brandName"], GEO_KB_LIMITS.text);
    const confirmed = entry["confirmed"];
    const aliases = Object.hasOwn(entry, "aliases")
      ? cleanList(entry["aliases"], 10, GEO_KB_LIMITS.text)
      : undefined;
    if (aliases === null) return null;
    if (domain === null || brandName === null || typeof confirmed !== "boolean") {
      return null;
    }
    // One of the two has to identify the competitor; an entry with neither is
    // an empty row, not a competitor.
    if (domain.length === 0 && brandName.length === 0) return null;
    // A competitor cannot be confirmed without the name the confirmation is
    // about; otherwise it would enter share-of-voice with nothing to match.
    if (confirmed && brandName.length === 0) return null;
    const key = domain.length > 0 ? `d:${domain}` : `n:${brandName.toLowerCase()}`;
    if (seen.has(key)) return null;
    seen.add(key);
    competitors.push({ domain, brandName, confirmed, ...(aliases === undefined ? {} : { aliases }) });
  }
  return competitors;
}

function parseFacts(value: unknown): readonly GeoKbFact[] | null {
  if (!Array.isArray(value) || value.length > GEO_KB_LIMITS.facts) return null;
  const facts: GeoKbFact[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const key = cleanString(entry["key"], GEO_KB_LIMITS.text);
    const factValue = cleanString(entry["value"], GEO_KB_LIMITS.text);
    const reason = cleanString(entry["reason"], 32);
    const sourceUrl = cleanString(entry["sourceUrl"], GEO_KB_LIMITS.url);
    const observedAt = cleanString(entry["observedAt"], 40);
    if (
      key === null ||
      key.length === 0 ||
      factValue === null ||
      reason === null ||
      !FACT_REASONS.has(reason) ||
      sourceUrl === null ||
      observedAt === null ||
      seen.has(key)
    ) {
      return null;
    }
    // The two halves of the honesty rule, enforced where the payload is built
    // rather than only in the database: a value has to say where it came from,
    // and its absence has to say why.
    if (factValue.length > 0 && sourceUrl.length === 0) return null;
    if (factValue.length === 0 && reason.length === 0) return null;
    seen.add(key);
    facts.push({ key, value: factValue, reason: reason as GeoKbFact["reason"], sourceUrl, observedAt });
  }
  return facts;
}

export function parseGeoKbPayload(input: unknown): GeoKbParseResult {
  if (!isRecord(input)) return { ok: false, reason: "not_an_object" };
  if (input["schemaVersion"] !== GEO_KB_SCHEMA_VERSION) {
    return { ok: false, reason: "schema_version" };
  }

  const targetUrl = cleanString(input["targetUrl"], GEO_KB_LIMITS.url);
  if (targetUrl === null || targetUrl.length === 0) {
    return { ok: false, reason: "target_url" };
  }
  const officialName = cleanString(input["officialName"], GEO_KB_LIMITS.text);
  if (officialName === null || officialName.length === 0) {
    return { ok: false, reason: "official_name" };
  }
  const aliases = cleanList(
    input["aliases"],
    GEO_KB_LIMITS.aliases,
    GEO_KB_LIMITS.listItem,
  );
  if (aliases === null) return { ok: false, reason: "aliases" };
  const categoryTerms = cleanList(
    input["categoryTerms"],
    GEO_KB_LIMITS.categoryTerms,
    GEO_KB_LIMITS.listItem,
  );
  if (categoryTerms === null || categoryTerms.length === 0) {
    return { ok: false, reason: "category_terms" };
  }

  const market = input["market"];
  if (!isRecord(market)) return { ok: false, reason: "market" };
  const country = cleanString(market["country"], 2)?.toUpperCase() ?? null;
  const language = cleanString(market["language"], 8)?.toLowerCase() ?? null;
  if (
    country === null ||
    !/^[A-Z]{2}$/.test(country) ||
    language === null ||
    !/^[a-z]{2}(-[a-z]{2})?$/.test(language)
  ) {
    return { ok: false, reason: "market" };
  }

  const roles = parseRoles(input["roles"]);
  if (roles === null) return { ok: false, reason: "roles" };
  const competitors = parseCompetitors(input["competitors"]);
  if (competitors === null) return { ok: false, reason: "competitors" };
  const facts = parseFacts(input["facts"]);
  if (facts === null) return { ok: false, reason: "facts" };

  let importedFrom: GeoKbPayload["importedFrom"] = null;
  const imported = input["importedFrom"];
  if (imported !== null && imported !== undefined) {
    if (!isRecord(imported)) return { ok: false, reason: "imported_from" };
    const websiteId = cleanString(imported["websiteId"], 64);
    const snapshotId = cleanString(imported["snapshotId"], 64);
    const snapshotRevision = cleanString(imported["snapshotRevision"], 16);
    if (
      websiteId === null ||
      snapshotId === null ||
      snapshotRevision === null ||
      websiteId.length === 0 ||
      snapshotId.length === 0
    ) {
      return { ok: false, reason: "imported_from" };
    }
    importedFrom = { websiteId, snapshotId, snapshotRevision };
  }

  let profileCopy: GeoProfileCopy | undefined;
  if (Object.hasOwn(input, "profileCopy")) {
    try { profileCopy = parseGeoProfileCopy(input["profileCopy"]); }
    catch { return { ok: false, reason: "profile_copy" }; }
  }
  const value: GeoKbPayload = {
    schemaVersion: GEO_KB_SCHEMA_VERSION,
    targetUrl,
    officialName,
    aliases,
    categoryTerms,
    market: { country, language },
    roles,
    competitors,
    facts,
    importedFrom,
    ...(profileCopy === undefined ? {} : { profileCopy }),
  };
  if (
    geoKbJsonbBytes(value) >
    GEO_KB_LIMITS.payloadBytes
  ) {
    return { ok: false, reason: "too_large" };
  }
  return { ok: true, value };
}

/** An empty knowledge base, so the editor always has a shape to render. */
export function emptyGeoKbPayload(targetUrl: string): GeoKbPayload {
  return {
    schemaVersion: GEO_KB_SCHEMA_VERSION,
    targetUrl,
    officialName: "",
    aliases: [],
    categoryTerms: [],
    market: { country: "US", language: "en" },
    roles: [],
    competitors: [],
    facts: [],
    importedFrom: null,
  };
}

/**
 * What still has to be true before this knowledge base can be frozen.
 *
 * Returned as codes rather than sentences, and rendered next to the button, so
 * a visitor is never told "freeze" by a control that will refuse.
 */
export type GeoKbBlocker =
  | "official_name_missing"
  | "aliases_missing"
  | "alias_too_short"
  | "category_terms_missing"
  | "no_confirmed_competitor"
  | "role_missing"
  | "unsupported_language";

export function geoKbBlockers(
  payload: GeoKbPayload,
  options: { readonly roleLayersSkipped?: boolean } = {},
): readonly GeoKbBlocker[] {
  const blockers: GeoKbBlocker[] = [];
  if (!isSupportedGeoQuestionLanguage(payload.market.language)) {
    blockers.push("unsupported_language");
  }
  if (payload.officialName.length === 0) blockers.push("official_name_missing");
  if (payload.aliases.length === 0) blockers.push("aliases_missing");
  // A name the mention matcher will not look for has to be refused here, before
  // the run is paid for. Freezing it costs a full round of provider calls and
  // then reports every answer that names the brand as not mentioning it - the
  // visitor gets a bill and a zero, and nothing on the page says why. The floor
  // is the matcher's own, and it is lower for scripts written without spaces,
  // where two characters is a whole name.
  // The test is on the whole set, not on each name. Mention detection searches
  // for the official name and every alias together, so one matchable spelling
  // is enough - blocking because a short alias sits beside a usable official
  // name would refuse a knowledge base that works.
  const names = [payload.officialName, ...payload.aliases].filter(
    (name) => name.length > 0,
  );
  if (names.length > 0 && !names.some((name) => isMatchableGeoName(name))) {
    blockers.push("alias_too_short");
  }
  if (payload.categoryTerms.length === 0) blockers.push("category_terms_missing");
  if (payload.roles.length === 0 && options.roleLayersSkipped !== true) blockers.push("role_missing");
  if (!payload.competitors.some((entry) => entry.confirmed)) {
    blockers.push("no_confirmed_competitor");
  }
  return blockers;
}
