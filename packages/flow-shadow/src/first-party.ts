import type { ResearchSourceKind } from "./types.ts";

/**
 * The customer's own web identity — the ONE definition, shared by the accepting
 * service, the worker's replay guard, the research pack and the QA gate.
 *
 * It lives in its own module because two callers on opposite sides of a hash
 * comparison have to normalize a URL identically or every normal replay becomes
 * an input-drift failure. A second, "obviously equivalent" implementation in the
 * worker is exactly the split-brain that decision O-1 already had to repair once
 * for the prompt-set constant.
 *
 * Pure and dependency-free like the rest of this package: no URL parser, no
 * clock, no locale-sensitive API.
 */

/** Kinds that describe the customer's own web identity, not outside evidence. */
export const FIRST_PARTY_SOURCE_KINDS: readonly ResearchSourceKind[] = [
  "first_party_site",
  "first_party_conversion",
];

export function isFirstPartySourceKind(kind: ResearchSourceKind): boolean {
  return FIRST_PARTY_SOURCE_KINDS.includes(kind);
}

/**
 * WHICH first-party identity a source is — the two are not interchangeable.
 *
 * `site` is the project's own origin, so its SUBDOMAINS belong to the customer
 * too: a B2B site routinely serves its blog, docs and app from `blog.`/`docs.`.
 *
 * `conversion` is a booking/scheduling destination taken from the ICP profile,
 * and its host is routinely a THIRD-PARTY SaaS (Calendly, HubSpot, Typeform).
 * Widening that host to its subdomains would hand every other tenant of that
 * SaaS the customer's own-property status, so the distinction is carried in the
 * type rather than left to whoever reads the flag next. The repository's own
 * fixture already uses a different registrable domain for the two, which is the
 * expected shape, not an edge case.
 */
export type FirstPartyIdentityKind = "site" | "conversion";

export function firstPartyIdentityKind(
  kind: ResearchSourceKind,
): FirstPartyIdentityKind | null {
  if (kind === "first_party_site") return "site";
  if (kind === "first_party_conversion") return "conversion";
  return null;
}

/**
 * Upper bound on a frozen first-party URL. `PrimaryConversion.targetUrl` is
 * already capped at 2048 by its own contract; repeating the bound here keeps a
 * malformed row from widening the frozen tuple.
 */
const MAX_FIRST_PARTY_URL_CHARS = 2_048;

/**
 * Normalize a first-party URL for the frozen tuple, or `null` when the value is
 * not an absolute http(s) URL.
 *
 * `null` is the honest answer for anything else. Freezing a non-URL would put a
 * bare token into the pack, where the name-matching half of the resolution chain
 * could match it against unrelated prose and silently confirm a reference
 * nothing in our records supports.
 */
export function normalizeFirstPartyUrl(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_FIRST_PARTY_URL_CHARS) {
    return null;
  }
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : null;
}
