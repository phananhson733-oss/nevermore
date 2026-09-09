// @input  -- owner-scoped website id, an observation kind/url, and what one real fetch saw
// @output -- the latest stored observation for that (kind, url), a time-only freshness verdict, and one appended row per fetch
// @pos    -- server only: this module holds a Supabase service-role transport and must never be imported by a client component

/**
 * The website evidence observation library.
 *
 * One real fetch is one row, and a row is never updated or deleted. Reuse is
 * decided by asking "how old is the newest observation of this exact thing",
 * never by comparing bodies.
 *
 * Why body_hash must not be the reuse criterion
 * ---------------------------------------------
 * The tempting shortcut is: re-fetch, hash the body, and if the hash matches
 * the stored one, "confirm" the existing observation by moving its timestamp
 * forward instead of writing a new row. That is wrong in a way that is
 * invisible until someone reads an old version: an observation records a
 * moment, and a published snapshot from two months ago points at the
 * observations that supported it. Touching the timestamp rewrites the past --
 * the version card, the export and the Brief would all date two-month-old
 * evidence as observed today, and nothing would say otherwise.
 *
 * So: inside the TTL we reuse the stored row and send no traffic at all;
 * outside the TTL we fetch and append a new observation with a new
 * observed_at, even when the bytes are byte-for-byte identical. Equal hashes
 * across two rows is a fact worth having -- it says the page did not change
 * between two known times -- and it is only available because both rows exist.
 */

import { z } from "zod";
import { createAdminSupabaseClient } from "../supabase/admin.ts";

export const GEO_EVIDENCE_OBSERVATION_SCHEMA_VERSION =
  "marketing-website-evidence-observation.v1";

export const GEO_EVIDENCE_OBSERVATION_KINDS = [
  "own_page",
  "competitor_page",
  "robots",
  "sitemap",
  "llms",
  "gsc",
  "third_party",
] as const;
export type GeoEvidenceObservationKind =
  (typeof GEO_EVIDENCE_OBSERVATION_KINDS)[number];

/**
 * Why `rate_limited` is not a reason here.
 *
 * A gate refusal is an observation of our own quota, not of the target site.
 * Storing it would put a row in an evidence ledger that says nothing about the
 * site, and -- because freshness is time-only by design -- one busy minute
 * would then suppress the real fetch for the whole TTL. `recordObservation`
 * refuses it, and so does the table's own check constraint.
 */
export const GEO_EVIDENCE_UNAVAILABLE_REASONS = [
  "not_found",
  "not_published",
  "fetch_failed",
  "blocked",
  "timeout",
  "invalid_response",
  "partial_body",
  "insufficient_evidence",
] as const;
export type GeoEvidenceUnavailableReason =
  (typeof GEO_EVIDENCE_UNAVAILABLE_REASONS)[number];

/** Third-party only. Independence needs positive evidence; "no counter-evidence" is `undetermined`. */
export const GEO_EVIDENCE_INDEPENDENCE_VERDICTS = [
  "independent",
  "self_submitted",
  "syndicated",
  "undetermined",
] as const;
export type GeoEvidenceIndependence =
  (typeof GEO_EVIDENCE_INDEPENDENCE_VERDICTS)[number];

export const GEO_EVIDENCE_OBSERVATION_LIMITS = {
  urlChars: 2048,
  excerpts: 8,
  /**
   * UTF-16 code units, which is what zod's `.max()` counts -- not code points
   * and not bytes. The real bound is the column's `octet_length` budget in the
   * migration; this one exists to reject an obviously wrong producer early.
   */
  excerptChars: 1_200,
  jsonLdTypes: 64,
  faqPairs: 64,
  hreflangLocales: 128,
  robotsRules: 256,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long an observation stands in for a fresh fetch, by kind.
 *
 * All 24 h, per the redesign's section 3. Note the difference this unifies:
 * the Profile scan caches its crawl for 1 h today
 * (`CRAWL_CACHE_MAX_AGE_SECONDS` in `../tools/crawl-cache.ts`). That 1 h is a
 * different mechanism against a different table and is NOT changed by this
 * module; the decision to bring both to 24 h is S2's, and until the Profile
 * scan is moved onto this library the two numbers coexist on purpose.
 *
 * Kept per kind rather than as one constant so a kind can diverge later
 * without a caller having to know which one it is asking about.
 */
export const GEO_EVIDENCE_OBSERVATION_TTL_MS: Readonly<
  Record<GeoEvidenceObservationKind, number>
> = {
  own_page: DAY_MS,
  competitor_page: DAY_MS,
  robots: DAY_MS,
  sitemap: DAY_MS,
  llms: DAY_MS,
  gsc: DAY_MS,
  third_party: DAY_MS,
};

export function geoEvidenceTtlMs(kind: GeoEvidenceObservationKind): number {
  return GEO_EVIDENCE_OBSERVATION_TTL_MS[kind];
}

const structuredSchema = z
  .object({
    jsonLdTypes: z
      .array(z.string().min(1).max(200))
      .max(GEO_EVIDENCE_OBSERVATION_LIMITS.jsonLdTypes)
      .optional(),
    faqPairs: z
      .array(
        z
          .object({
            question: z.string().min(1).max(600),
            answer: z.string().min(1).max(2_000),
          })
          .strict(),
      )
      .max(GEO_EVIDENCE_OBSERVATION_LIMITS.faqPairs)
      .optional(),
    hreflangLocales: z
      .array(z.string().min(1).max(64))
      .max(GEO_EVIDENCE_OBSERVATION_LIMITS.hreflangLocales)
      .optional(),
    robotsRules: z
      .array(z.string().min(1).max(400))
      .max(GEO_EVIDENCE_OBSERVATION_LIMITS.robotsRules)
      .optional(),
    noindex: z.boolean().optional(),
    nosnippet: z.boolean().optional(),
    /** A string on purpose: this ledger's JSON carries no numbers, same rule as the GEO payloads. */
    maxSnippet: z.string().max(16).optional(),
    authorship: z
      .object({
        authors: z.array(z.string().min(1).max(200)).max(32),
        reviewers: z.array(z.string().min(1).max(200)).max(32),
        datePublished: z.string().max(64).nullable(),
      })
      .strict()
      .optional(),
  })
  /**
   * Unknown keys are validated as nothing and preserved as they are. Two
   * producers write here (GEO collection and the Profile scan) and the table
   * is append-only, so a shape pinned today would make tomorrow's rows
   * unreadable by the same parser. Known keys are still checked, so a typo in
   * one of them fails loudly instead of silently reading as absent.
   */
  .catchall(z.unknown());

export type GeoEvidenceStructured = z.infer<typeof structuredSchema>;

export type GeoEvidenceObservationStatus =
  | {
      readonly kind: "ok";
      readonly bodyHash: string;
      readonly excerpts: readonly string[];
      readonly structured: GeoEvidenceStructured;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: GeoEvidenceUnavailableReason;
    };

export interface GeoEvidenceObservation {
  readonly schemaVersion: typeof GEO_EVIDENCE_OBSERVATION_SCHEMA_VERSION;
  readonly observationId: string;
  readonly websiteId: string;
  readonly kind: GeoEvidenceObservationKind;
  /** For `gsc` this is a `property + window` key, not a URL. See `geoEvidenceGscKey`. */
  readonly url: string;
  readonly observedAt: string;
  readonly status: GeoEvidenceObservationStatus;
  readonly independence: GeoEvidenceIndependence | null;
}

export type GeoEvidenceInvalidCode =
  | "invalid_input"
  | "invalid_observed_at"
  | "invalid_observation"
  | "unrecordable_status";

export type GeoEvidenceStoreResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** The website is not there, or is not this user's. */
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly code: GeoEvidenceInvalidCode }
  | { readonly kind: "unavailable" };

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)));

const rowSchema = z
  .object({
    schemaVersion: z.literal(GEO_EVIDENCE_OBSERVATION_SCHEMA_VERSION),
    observationId: uuid,
    websiteId: uuid,
    kind: z.enum(GEO_EVIDENCE_OBSERVATION_KINDS),
    url: z.string().min(1).max(GEO_EVIDENCE_OBSERVATION_LIMITS.urlChars),
    observedAt: timestamp,
    status: z.enum(["ok", "unavailable"]),
    statusReason: z.enum(GEO_EVIDENCE_UNAVAILABLE_REASONS).nullable(),
    bodyHash: sha256.nullable(),
    excerpts: z
      .array(
        z.string().min(1).max(GEO_EVIDENCE_OBSERVATION_LIMITS.excerptChars),
      )
      .max(GEO_EVIDENCE_OBSERVATION_LIMITS.excerpts),
    structured: structuredSchema,
    independence: z.enum(GEO_EVIDENCE_INDEPENDENCE_VERDICTS).nullable(),
  })
  .strict();

/**
 * Re-check the table's own pairing rules on the way out.
 *
 * The constraints exist, but a row that reaches here has crossed a network and
 * a schema cache, and an "unavailable" observation carrying last run's
 * excerpts would read downstream as a successful one. Throwing here surfaces
 * as `unavailable`, which makes the caller fetch rather than believe.
 */
export function parseGeoEvidenceObservation(
  value: unknown,
): GeoEvidenceObservation {
  const row = rowSchema.parse(value);
  if (
    row.kind === "third_party"
      ? row.independence === null
      : row.independence !== null
  ) {
    throw new Error("Independence is a third-party judgement only");
  }
  const status: GeoEvidenceObservationStatus =
    row.status === "ok"
      ? {
          kind: "ok",
          bodyHash: required(row.bodyHash),
          excerpts: row.excerpts,
          structured: row.structured,
        }
      : { kind: "unavailable", reason: required(row.statusReason) };
  if (
    row.status === "unavailable" &&
    (row.bodyHash !== null ||
      row.excerpts.length > 0 ||
      Object.keys(row.structured).length > 0)
  ) {
    throw new Error("Unavailable observation cannot carry content");
  }
  if (row.status === "ok" && row.statusReason !== null)
    throw new Error("Available observation cannot carry a reason");
  return {
    schemaVersion: row.schemaVersion,
    observationId: row.observationId,
    websiteId: row.websiteId,
    kind: row.kind,
    observedAt: new Date(row.observedAt).toISOString(),
    url: row.url,
    status,
    independence: row.independence,
  };
}

function required<T>(value: T | null): T {
  if (value === null)
    throw new Error("Observation is missing a required field");
  return value;
}

/**
 * Is the newest observation still standing in for a fetch?
 *
 * Time only. It does not look at `bodyHash`, and it must not: see this file's
 * header for what confirming-by-hash costs. It does not look at the status
 * either -- a stored failure is a real observation of the target, and the
 * one status that is about us rather than the target (`rate_limited`) never
 * gets into the library in the first place.
 *
 * An observation dated in the future is NOT fresh. That is clock skew or a bad
 * producer, and treating it as fresh would suppress fetching until that time
 * arrives; treating it as stale costs one fetch.
 */
export function isObservationFresh(
  observation: Pick<GeoEvidenceObservation, "observedAt">,
  now: Date,
  ttlMs: number,
): boolean {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return false;
  const observedAt = Date.parse(observation.observedAt);
  const current = now.getTime();
  if (!Number.isFinite(observedAt) || !Number.isFinite(current)) return false;
  const age = current - observedAt;
  // Exactly at the TTL is expired: the boundary belongs to the fetch, so a
  // caller that runs on an exact 24h cadence refreshes rather than drifting.
  return age >= 0 && age < ttlMs;
}

const DATE_ONLY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;

/**
 * GSC has no URL, so its identity is the property plus the exact window.
 *
 * Keying on the window is what makes a different window a different
 * observation instead of a refresh of the old one -- last week's 90-day window
 * and today's 90-day window are not the same measurement.
 */
export function geoEvidenceGscKey(input: {
  readonly property: string;
  readonly windowStart: string;
  readonly windowEnd: string;
}): string | null {
  const property = input.property.trim();
  if (property === "" || property.length > 1_024 || property.includes("#"))
    return null;
  if (!DATE_ONLY.test(input.windowStart) || !DATE_ONLY.test(input.windowEnd))
    return null;
  if (input.windowStart > input.windowEnd) return null;
  return `${property}#${input.windowStart}..${input.windowEnd}`;
}

export interface GeoEvidenceObservationDependencies {
  readonly callRpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ readonly data: unknown; readonly error: unknown }>;
}

export const DEFAULT_GEO_EVIDENCE_OBSERVATION_DEPENDENCIES: GeoEvidenceObservationDependencies =
  {
    callRpc: async (name, params) =>
      await createAdminSupabaseClient().rpc(name, params),
  };

function rpcRow(value: unknown): Record<string, unknown> {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    value[0] === null ||
    typeof value[0] !== "object"
  ) {
    throw new Error("Invalid evidence observation RPC response");
  }
  return value[0] as Record<string, unknown>;
}

export interface GeoEvidenceObservationSelector {
  /**
   * Required even though `websiteId` is globally unique. Service-role calls
   * bypass RLS, so ownership is proved by the RPC against
   * `marketing_websites (id, user_id)` -- passing only the website id would
   * make a handler bug enough to read another account's observations.
   */
  readonly userId: string;
  readonly websiteId: string;
  readonly kind: GeoEvidenceObservationKind;
  readonly url: string;
}

/** The newest observation of one exact `(kind, url)`, or null if it was never observed. */
export async function readLatestObservation(
  input: GeoEvidenceObservationSelector,
  dependencies: GeoEvidenceObservationDependencies = DEFAULT_GEO_EVIDENCE_OBSERVATION_DEPENDENCIES,
): Promise<GeoEvidenceStoreResult<GeoEvidenceObservation | null>> {
  try {
    uuid.parse(input.userId);
    uuid.parse(input.websiteId);
    z.enum(GEO_EVIDENCE_OBSERVATION_KINDS).parse(input.kind);
    z.string()
      .min(1)
      .max(GEO_EVIDENCE_OBSERVATION_LIMITS.urlChars)
      .parse(input.url);
  } catch {
    return { kind: "invalid", code: "invalid_input" };
  }
  try {
    const result = await dependencies.callRpc(
      "marketing_website_read_latest_evidence_observation",
      {
        p_user_id: input.userId,
        p_website_id: input.websiteId,
        p_kind: input.kind,
        p_url: input.url,
      },
    );
    if (result.error) return { kind: "unavailable" };
    const row = rpcRow(result.data);
    if (row.outcome === "not_found") return { kind: "missing" };
    if (row.outcome === "none") return { kind: "ok", value: null };
    if (row.outcome !== "found") return { kind: "unavailable" };
    const observation = parseGeoEvidenceObservation(row.observation);
    if (
      observation.websiteId !== input.websiteId ||
      observation.kind !== input.kind ||
      observation.url !== input.url
    ) {
      return { kind: "unavailable" };
    }
    return { kind: "ok", value: observation };
  } catch {
    return { kind: "unavailable" };
  }
}

export interface GeoEvidenceObservationAppend extends GeoEvidenceObservationSelector {
  /** When we looked. Not when we are writing: a re-used clock would date every row at persist time. */
  readonly observedAt: string;
  readonly status: GeoEvidenceObservationStatus;
  readonly independence?: GeoEvidenceIndependence | null;
}

function appendParams(
  input: GeoEvidenceObservationAppend,
): Record<string, unknown> {
  const ok = input.status.kind === "ok" ? input.status : null;
  return {
    p_user_id: input.userId,
    p_website_id: input.websiteId,
    p_kind: input.kind,
    p_url: input.url,
    p_observed_at: new Date(input.observedAt).toISOString(),
    p_status: input.status.kind,
    p_status_reason:
      input.status.kind === "unavailable" ? input.status.reason : null,
    p_body_hash: ok?.bodyHash ?? null,
    p_excerpts: ok === null ? [] : [...ok.excerpts],
    p_structured: ok === null ? {} : ok.structured,
    p_independence: input.independence ?? null,
  };
}

function validateAppend(
  input: GeoEvidenceObservationAppend,
): GeoEvidenceInvalidCode | null {
  // A reason the ledger refuses -- `rate_limited` above all -- gets its own
  // code, so a caller can tell "I sent junk" from "this is an outcome the
  // library deliberately does not store".
  if (
    input.status.kind === "unavailable" &&
    !(GEO_EVIDENCE_UNAVAILABLE_REASONS as readonly string[]).includes(
      input.status.reason,
    )
  ) {
    return "unrecordable_status";
  }
  try {
    uuid.parse(input.userId);
    uuid.parse(input.websiteId);
    z.enum(GEO_EVIDENCE_OBSERVATION_KINDS).parse(input.kind);
    z.string()
      .min(1)
      .max(GEO_EVIDENCE_OBSERVATION_LIMITS.urlChars)
      .parse(input.url);
    timestamp.parse(input.observedAt);
    if (input.status.kind === "ok") {
      sha256.parse(input.status.bodyHash);
      structuredSchema.parse(input.status.structured);
      z.array(
        z.string().min(1).max(GEO_EVIDENCE_OBSERVATION_LIMITS.excerptChars),
      )
        .max(GEO_EVIDENCE_OBSERVATION_LIMITS.excerpts)
        .parse([...input.status.excerpts]);
    }
  } catch {
    return "invalid_input";
  }
  // Independence is a third-party judgement only, and every third-party row
  // must carry one -- `undetermined` is a verdict, not an absence.
  return (input.kind === "third_party") ===
    ((input.independence ?? null) !== null)
    ? null
    : "invalid_observation";
}

/**
 * Append one observation. There is no update path, by design.
 *
 * A repeat of the same `(websiteId, kind, url, observedAt)` is idempotent and
 * still succeeds -- the caller wants "the library now holds this observation",
 * not "this insert was mine".
 */
export async function recordObservation(
  input: GeoEvidenceObservationAppend,
  dependencies: GeoEvidenceObservationDependencies = DEFAULT_GEO_EVIDENCE_OBSERVATION_DEPENDENCIES,
): Promise<GeoEvidenceStoreResult<GeoEvidenceObservation>> {
  const invalid = validateAppend(input);
  if (invalid !== null) return { kind: "invalid", code: invalid };
  try {
    const result = await dependencies.callRpc(
      "marketing_website_record_evidence_observation",
      appendParams(input),
    );
    if (result.error) return { kind: "unavailable" };
    const row = rpcRow(result.data);
    if (row.outcome === "not_found") return { kind: "missing" };
    if (row.outcome === "invalid")
      return { kind: "invalid", code: "invalid_observation" };
    if (row.outcome !== "recorded" && row.outcome !== "duplicate")
      return { kind: "unavailable" };
    const observation = parseGeoEvidenceObservation(row.observation);
    if (
      observation.websiteId !== input.websiteId ||
      observation.kind !== input.kind ||
      observation.url !== input.url
    ) {
      return { kind: "unavailable" };
    }
    return { kind: "ok", value: observation };
  } catch {
    return { kind: "unavailable" };
  }
}
