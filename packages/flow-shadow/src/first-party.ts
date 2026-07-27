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
 * Pure and dependency-free like the QA closure that consumes it: URL validation
 * uses only the platform parser. There is no clock, network, filesystem,
 * locale-sensitive API or suffix database. Strict site-origin validation lives
 * in `first-party-site.ts`; neither module infers ownership from a DNS suffix.
 */

/** Kinds that describe the customer's own web identity, not outside evidence. */
export const FIRST_PARTY_SOURCE_KINDS: readonly ResearchSourceKind[] = [
  "first_party_site",
  "first_party_conversion",
  "first_party_page",
];

export function isFirstPartySourceKind(kind: ResearchSourceKind): boolean {
  return FIRST_PARTY_SOURCE_KINDS.includes(kind);
}

/**
 * WHICH first-party identity a source is — the three are not interchangeable.
 *
 * `site` is the project's verified origin. It owns arbitrary paths on that
 * exact hostname, but never a child hostname by inference. A docs/blog/app
 * subdomain must be frozen as its own verified origin or exact page identity.
 *
 * `conversion` is a booking/scheduling destination taken from the ICP profile,
 * and its host is routinely a THIRD-PARTY SaaS (Calendly, HubSpot, Typeform).
 * Widening that host to its subdomains would hand every other tenant of that
 * SaaS the customer's own-property status, so the distinction is carried in the
 * type rather than left to whoever reads the flag next. The repository's own
 * fixture already uses a different hostname for the two, which is the expected
 * shape, not an edge case.
 *
 * `page` is one exact frozen PageSnapshot URL. Like `conversion`, it never
 * widens to sibling hosts or subdomains.
 */
export type FirstPartyIdentityKind = "site" | "conversion" | "page";

export function firstPartyIdentityKind(
  kind: ResearchSourceKind,
): FirstPartyIdentityKind | null {
  if (kind === "first_party_site") return "site";
  if (kind === "first_party_conversion") return "conversion";
  if (kind === "first_party_page") return "page";
  return null;
}

/**
 * Upper bound on a frozen first-party URL. `PrimaryConversion.targetUrl` is
 * already capped at 2048 by its own contract; repeating the bound here keeps a
 * malformed row from widening the frozen tuple.
 */
const MAX_FIRST_PARTY_URL_CHARS = 2_048;

interface ParsedFirstPartyUrl {
  readonly source: string;
}

function parsedFirstPartyUrl(
  raw: string | null | undefined,
): ParsedFirstPartyUrl | null {
  if (typeof raw !== "string") return null;
  const source = raw.trim();
  if (source.length === 0 || source.length > MAX_FIRST_PARTY_URL_CHARS) {
    return null;
  }
  try {
    const parsed = new URL(source);
    const hostname = parsed.hostname
      .toLowerCase()
      .replace(/\.$/u, "");
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      hostname.length === 0 ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      return null;
    }
    return { source };
  } catch {
    return null;
  }
}

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
  const normalized = parsedFirstPartyUrl(raw);
  // Validate with URL, preserve the already-frozen spelling. Rewriting here
  // would change old content addresses for harmless slash/default-port
  // differences and is not needed for the fail-closed identity boundary.
  return normalized?.source ?? null;
}
