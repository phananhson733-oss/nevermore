import {
  firstPartyIdentityKind,
  type FirstPartyIdentityKind,
} from "../first-party.ts";
import type {
  AuthorityTier,
  ResearchPack,
  ResearchSource,
} from "../types.ts";
import { QA_THRESHOLDS } from "./thresholds.ts";
import {
  canonicalHostname,
  canonicalUrl,
  clauseBefore,
  flattenLine,
  hasDirectNegation,
  normalizeName,
  sentenceSpanAt,
  spansOverlap,
  spanWithin,
  type FlatLine,
  type FlatSpan,
} from "./text.ts";

/**
 * claim -> source -> authority: the one resolution chain the three blocking
 * rules share.
 *
 * The tooling this is ported from answered "does this line LOOK attributed?"
 * with a list of shapes: a bare four-digit year counted, and so did `by
 * <Capitalized word>`. A model that writes "According to a 2024 Forrester
 * study" satisfies both without either the year or the firm existing anywhere
 * in our records, so the check passed exactly the sentences it was built to
 * catch.
 *
 * This chain answers a different question: "does the attribution RESOLVE to a
 * source the frozen research pack actually carries?" The pack contains frozen
 * project records and immutable page snapshots, so a name absent from that
 * tuple has nowhere to resolve to. Shape is used to FIND the attribution; only
 * an eligible source identity decides whether it holds.
 *
 * Two properties of this chain are load-bearing, and each was absent once:
 *
 * 1. **A resolution has a ROLE, and the role decides what it licenses.** When
 *    the only question was "is `source` non-null?", one link to the customer's
 *    own website vouched for any invented external reference sharing its line —
 *    "According to a 2024 Forrester study, 73% … [Book a demo](our-site)" was
 *    `passed`, and the same sentence WITHOUT the link was `blocked`. The
 *    blocking rules call `resolveAssertionSupport`, whose return type has no
 *    first-party inhabitant, so that mistake is now unspellable rather than
 *    merely fixed.
 * 2. **An attribution is LOCATED by construction, not harvested from the
 *    line.** Scanning a whole line for domain literals pulled the customer's
 *    own host out of another url's query string
 *    (`https://attacker.test/?u=https://our-site/`) and let it support the
 *    sentence. Attributions carry spans, nothing is read out of the inside of a
 *    url, and an assertion that NAMES who it attributes to can only be
 *    supported by that name and by the link the name is written as.
 *
 * Current governed packs can carry frozen `external_page` captures. Those page
 * identities can resolve an attribution; project rows such as search keywords,
 * content briefs and unfetched competitor identities cannot. Resolution is
 * therefore evidence-specific rather than a proxy for whether the pack happens
 * to contain a human-readable label.
 */

export interface SourceIdentity {
  readonly kind: string;
  readonly ref: string;
  readonly label: string;
  readonly authority: AuthorityTier;
  readonly url: string | null;
  /**
   * Lowercase hostname with every label preserved. Ownership compares this
   * field; `domain` may fold `www.` for citation lookup and must not be used to
   * infer control.
   */
  readonly hostname: string | null;
  readonly domain: string | null;
  readonly name: string | null;
  /** Longest alphabetic token of `name`, for partial name matching. */
  readonly nameToken: string | null;
  /** Frozen page bytes; identity-only rows carry `null`. */
  readonly contentText: string | null;
  /** The frozen body is only a prefix of the retrieved page. */
  readonly contentTruncated: boolean;
  /**
   * Which half of the customer's own web identity this is, or `null` for an
   * outside source. A first-party identity answers "does this link point at the
   * customer's own property?" and NOTHING else — never "this claim is
   * supported".
   */
  readonly firstParty: FirstPartyIdentityKind | "page" | null;
  readonly role: SourceRole;
}

export interface SourceIndex {
  readonly identities: readonly SourceIdentity[];
  /**
   * How many sources carry an identity a draft could plausibly cite AS OUTSIDE
   * EVIDENCE (a URL, a domain, or a human-readable name).
   *
   * First-party identities are deliberately excluded even though they carry
   * URLs. The rules that read this ask one question — "is there anything
   * external in the pack to resolve a citation against?" A governed pack can
   * now answer yes through `external_page` captures. Counting the customer's own
   * site would still corrupt that answer by presenting ownership as independent
   * support.
   */
  readonly citableCount: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function longestAlphaToken(name: string): string | null {
  let best: string | null = null;
  for (const token of name.split(" ")) {
    if (token.length < QA_THRESHOLDS.nameMatchMinTokenLen) continue;
    if (!/[a-z]/.test(token)) continue;
    if (best === null || token.length > best.length) best = token;
  }
  return best;
}

interface StructuralResearchSource {
  readonly label?: unknown;
  readonly url?: unknown;
  readonly contentText?: unknown;
}

function identityFor(source: ResearchSource): SourceIdentity {
  const fields = source as ResearchSource & StructuralResearchSource;
  const kind = String(source.kind);
  const firstParty: SourceIdentity["firstParty"] =
    kind === "first_party_page"
      ? "page"
      : firstPartyIdentityKind(source.kind);
  const contentText =
    typeof fields.contentText === "string" &&
    fields.contentText.trim().length > 0
      ? fields.contentText
      : null;
  // `competitor` rows produced by the governed pack are project records, not
  // retrieved evidence. A few pre-page-capture tests intentionally construct a
  // human-readable competitor ref as a legacy citable source; keep that narrow
  // compatibility seam without allowing UUID-backed competitor/search/brief
  // rows to launder an attribution merely because they carry a display label.
  const legacyExternalIdentity =
    kind === "competitor" && !UUID.test(source.ref.trim());
  const role: SourceRole =
    kind === "external_page"
      ? "external_evidence"
      : kind === "first_party_page"
      ? contentText === null
        ? "first_party_identity"
        : "first_party_evidence"
      : firstParty !== null
        ? "first_party_identity"
        : legacyExternalIdentity
          ? "external_evidence"
          : "project_record";
  const label =
    typeof fields.label === "string" && fields.label.trim().length > 0
      ? fields.label.trim()
      : source.ref;
  const address =
    typeof fields.url === "string" && fields.url.trim().length > 0
      ? fields.url.trim()
      : source.ref;
  const shared = {
    kind,
    ref: source.ref,
    label,
    authority: source.authorityTier,
    contentText,
    contentTruncated: source.contentTruncated === true,
    firstParty,
    role,
  } as const;

  if (UUID.test(address.trim()) && label === source.ref) {
    return {
      ...shared,
      url: null,
      hostname: null,
      domain: null,
      name: null,
      nameToken: null,
    };
  }
  // Frozen brief/search/generative/competitor identity rows describe project
  // inputs. Their labels and opaque refs must never become attribution keys.
  // Only retrieved external pages (plus the explicit legacy fixture seam above)
  // can provide external evidence.
  if (role === "project_record") {
    return {
      ...shared,
      url: null,
      hostname: null,
      domain: null,
      name: null,
      nameToken: null,
    };
  }
  const url = canonicalUrl(address);
  const hostname = canonicalHostname(address);
  if (url && hostname) {
    const name = normalizeName(label);
    return {
      ...shared,
      url: url.url,
      hostname,
      domain: url.domain,
      name: name.length > 0 && label !== address ? name : null,
      nameToken:
        name.length > 0 && label !== address ? longestAlphaToken(name) : null,
    };
  }
  // A first-party identity that is not URL-shaped resolves NOTHING: it is
  // deliberately not given a name token. A malformed origin must not become a
  // fuzzy name matcher that confirms references by accident.
  if (firstParty !== null) {
    return {
      ...shared,
      url: null,
      hostname: null,
      domain: null,
      name: null,
      nameToken: null,
    };
  }
  const name = normalizeName(label);
  return {
    ...shared,
    url: null,
    hostname: null,
    domain: null,
    name: name.length > 0 ? name : null,
    nameToken: longestAlphaToken(name),
  };
}

export function buildSourceIndex(pack: ResearchPack): SourceIndex {
  const rawIdentities = pack.sources.map(identityFor);
  // Source kind alone cannot override ownership. If an `external_page` row
  // points at the frozen customer site (or exactly at another first-party
  // identity such as the conversion target), demote it to a first-party role.
  // This closes both URL and label/name laundering: the row cannot become
  // independent evidence merely because an upstream target was misclassified.
  const identities = rawIdentities.map((identity): SourceIdentity => {
    if (identity.role !== "external_evidence" || identity.url === null) {
      return identity;
    }
    const exactPageOwner = rawIdentities.find(
      (owner) =>
        (owner.firstParty === "page" || owner.firstParty === "site") &&
        owner.hostname === identity.hostname &&
        owner.url === identity.url,
    );
    const siteOwner = rawIdentities.find(
      (owner) =>
        owner.firstParty === "site" &&
        owner.hostname !== null &&
        identity.hostname !== null &&
        identity.hostname === owner.hostname,
    );
    const exactIdentityOwner = rawIdentities.find(
      (owner) =>
        owner.role === "first_party_identity" &&
        owner.hostname === identity.hostname &&
        owner.url === identity.url,
    );
    if (
      exactPageOwner === undefined &&
      siteOwner === undefined &&
      exactIdentityOwner === undefined
    ) {
      return identity;
    }
    // A conversion target can be a third-party scheduler. Exact ownership there
    // proves only "this is the configured destination"; it does not turn the
    // scheduler's page body into customer evidence. An exact-host site capture
    // or exact frozen first-party page is different: its captured body can
    // support a precise customer statement.
    if (exactPageOwner === undefined && siteOwner === undefined) {
      return {
        ...identity,
        firstParty: exactIdentityOwner?.firstParty ?? "conversion",
        role: "first_party_identity",
      };
    }
    return {
      ...identity,
      firstParty: "page",
      role:
        identity.contentText === null
          ? "first_party_identity"
          : "first_party_evidence",
    };
  });
  const citableCount = identities.filter(
    (identity) =>
      identity.role === "external_evidence" &&
      (identity.url !== null || identity.nameToken !== null),
  ).length;
  return { identities, citableCount };
}

export type AttributionKind = "url" | "name";

export interface Attribution {
  readonly kind: AttributionKind;
  readonly value: string;
}

/** An attribution plus WHERE it sits on the flattened line. */
export interface LocatedAttribution extends Attribution, FlatSpan {}

/**
 * What an attribution resolved to, and in what ROLE.
 *
 * This is the low-level identity lookup: "does the pack hold anything this
 * attribution names?" It is deliberately NOT what a rule calls — the two
 * questions a rule can ask are `resolveAssertionSupport` (may this support a
 * claim?) and `resolveLinkProvenance` (is this address one of ours?), and
 * neither can be answered by reading `source !== null`.
 */
export interface Resolution {
  /** `null` when nothing in the pack matched. */
  readonly source: SourceIdentity | null;
  /** `null` when nothing matched; otherwise what the match may be used for. */
  readonly role: SourceRole | null;
  /** `A`/`B`/`C` copied from the resolved source; `D` when nothing resolved. */
  readonly authority: AuthorityTier;
}

export type SourceRole =
  | "external_evidence"
  | "first_party_evidence"
  | "first_party_identity"
  | "project_record";

const UNRESOLVED: Resolution = { source: null, role: null, authority: "D" };

function resolved(identity: SourceIdentity): Resolution {
  return {
    source: identity,
    role: identity.role,
    authority: identity.authority,
  };
}

function preferredIdentity(
  identities: readonly SourceIdentity[],
  predicate: (identity: SourceIdentity) => boolean,
  roles: readonly SourceRole[] = [
    "external_evidence",
    "first_party_evidence",
    "first_party_identity",
    "project_record",
  ],
): SourceIdentity | null {
  for (const role of roles) {
    for (const identity of identities) {
      if (identity.role === role && predicate(identity)) return identity;
    }
  }
  return null;
}

/**
 * `D` is deliberately asymmetric with `AuthorityTier` on the pack side (Q1):
 * `A`/`B`/`C` are identical to the existing `EvidenceGrade` and describe where
 * a source came from, while `D` is not a source property at all — it is this
 * gate's output for "this reference resolves to nothing we hold". The pack must
 * never emit `D`; a source with no provenance has nowhere to have come from.
 */
export function resolveAttribution(
  index: SourceIndex,
  attribution: Attribution,
): Resolution {
  if (attribution.kind === "url") {
    const url = canonicalUrl(attribution.value);
    const hostname = canonicalHostname(attribution.value);
    if (!url || !hostname) return UNRESOLVED;
    // Customer ownership wins before any external-page row. Otherwise a frozen
    // external target pointed at the customer's own host could relabel an
    // internal page as independent evidence and launder a claim.
    const exactFirstParty = preferredIdentity(
      index.identities,
      (identity) =>
        identity.hostname === hostname && identity.url === url.url,
      ["first_party_evidence", "first_party_identity"],
    );
    if (exactFirstParty !== null) return resolved(exactFirstParty);
    // Arbitrary paths on the exact verified SITE hostname are first-party. DNS
    // suffix resemblance is not an ownership proof: a docs/blog/app subdomain
    // needs its own frozen site origin or exact first-party page identity.
    // External sources and conversion targets are exact-only for the same
    // reason, especially when the latter is a multi-tenant SaaS scheduler.
    for (const identity of index.identities) {
      if (identity.firstParty !== "site" || identity.hostname === null) {
        continue;
      }
      if (hostname === identity.hostname) {
        return resolved(identity);
      }
    }
    const exactExternal = preferredIdentity(
      index.identities,
      (identity) => identity.url === url.url,
      ["external_evidence"],
    );
    if (exactExternal !== null) return resolved(exactExternal);
    const sameExternalDomain = preferredIdentity(
      index.identities,
      (identity) => identity.domain === url.domain,
      ["external_evidence"],
    );
    if (sameExternalDomain !== null) return resolved(sameExternalDomain);
    return UNRESOLVED;
  }

  const name = normalizeName(attribution.value);
  if (name.length === 0) return UNRESOLVED;
  const exactName = preferredIdentity(
    index.identities,
    (identity) => identity.name !== null && identity.name === name,
  );
  if (exactName !== null) return resolved(exactName);
  // Partial match, but only on a token long enough to be an identity: "the",
  // "data" and "2024" must never be able to resolve an attribution.
  const nameTokens = name.split(" ");
  const partialName = preferredIdentity(
    index.identities,
    (identity) =>
      identity.nameToken !== null &&
      nameTokens.includes(identity.nameToken),
  );
  if (partialName !== null) return resolved(partialName);
  return UNRESOLVED;
}

/**
 * A source that can SUPPORT an assertion.
 *
 * There is no first-party inhabitant of this type, by construction. RL8, RL12
 * and SC9b ask "is there a source behind this claim?", and the customer's own
 * site origin is never an answer to that question — it says where a link points,
 * which is a different fact about a different subject.
 */
export interface AssertionSupport {
  readonly source: SourceIdentity;
  readonly authority: AuthorityTier;
}

/** The FIRST attribution that resolves to external evidence, or `null`. */
export function resolveAssertionSupport(
  index: SourceIndex,
  attributions: readonly Attribution[],
): AssertionSupport | null {
  for (const attribution of attributions) {
    const resolution = resolveAttribution(index, attribution);
    if (resolution.role === "external_evidence" && resolution.source !== null) {
      return { source: resolution.source, authority: resolution.authority };
    }
  }
  return null;
}

/** The FIRST exact first-party page that may support a customer-owned claim. */
export function resolveFirstPartyAssertionSupport(
  index: SourceIndex,
  attributions: readonly Attribution[],
): AssertionSupport | null {
  for (const attribution of attributions) {
    if (attribution.kind !== "url") continue;
    const resolution = resolveAttribution(index, attribution);
    if (
      resolution.role === "first_party_evidence" &&
      resolution.source !== null
    ) {
      return { source: resolution.source, authority: resolution.authority };
    }
  }
  return null;
}

/**
 * Where an address points, for the one rule that asks that question.
 *
 * RL12b reports links the frozen inputs cannot account for. A first-party
 * identity is a complete answer there — the whole point of freezing the
 * customer's origin is that their own call to action stops reading as an
 * unverifiable outside reference — and it is a complete answer NOWHERE else.
 */
export type LinkProvenance =
  | "external_evidence"
  | "first_party_evidence"
  | "first_party_identity"
  | "unresolved";

export function resolveLinkProvenance(
  index: SourceIndex,
  attribution: Attribution,
): LinkProvenance {
  const resolution = resolveAttribution(index, attribution);
  if (resolution.role === "external_evidence") return "external_evidence";
  if (resolution.role === "first_party_evidence")
    return "first_party_evidence";
  if (resolution.role === "first_party_identity")
    return "first_party_identity";
  return "unresolved";
}

const LEADING_NOISE = /^(?:a|an|the|its|their|our|this|that|recent|new)\s+/i;
const LEADING_YEAR = /^(?:19|20)\d{2}\s+/;
// `report`/`survey`/`index` are deliberately NOT stop words: they are part of a
// title ("Forrester Digital Experience Report"), and cutting there would leave a
// truncated name that resolves against the wrong source or none at all.
const NAME_STOP =
  /[,.;:!?)]|\s+(?:which|that|who|whose|and|but|found|shows?|showed|suggests?|reported|says?|said|estimates?|indicates?)\b/i;

/** A cleaned attribution name together with WHERE that name actually sits. */
interface CleanName {
  readonly value: string;
  readonly span: FlatSpan;
}

/**
 * Clean a name candidate, and narrow its span to the name that survives.
 *
 * The span is not cosmetic. `according to\s+([^\n]{2,120})` captures up to 120
 * characters, which on a line with two attributions is the whole rest of the
 * line — so the FIRST `According to <source we hold>` carried a span covering
 * every later sentence, and `According to Forrester, 73% …` two sentences
 * downstream drew that resolvable name into its own support candidates and read
 * as attributed. The value was always cut at the comma; only the span was not,
 * and locality is half of "an assertion is supported by the source it attributes
 * to". Cutting both in one place is what keeps them from drifting apart again.
 */
function cleanNameAt(text: string, span: FlatSpan): CleanName | null {
  let start = span.start;
  let end = span.end;
  const isSpace = (at: number): boolean => /\s/.test(text.charAt(at));
  while (start < end && isSpace(start)) start += 1;
  while (end > start && isSpace(end - 1)) end -= 1;
  const stop = NAME_STOP.exec(text.slice(start, end));
  if (stop?.index !== undefined && stop.index > 0) end = start + stop.index;
  for (;;) {
    const rest = text.slice(start, end);
    const noise = LEADING_NOISE.exec(rest) ?? LEADING_YEAR.exec(rest);
    if (noise === null) break;
    start += noise[0].length;
  }
  while (end > start && isSpace(end - 1)) end -= 1;
  // The eight-token cap is `cleanNameCandidate`'s, kept here so the value and
  // the span are truncated at the same place by construction.
  const tokens = [...text.slice(start, end).matchAll(/\S+/g)];
  const eighth = tokens[8];
  if (eighth?.index !== undefined) end = start + eighth.index;
  while (end > start && isSpace(end - 1)) end -= 1;
  const value = text.slice(start, end).trim().split(/\s+/).join(" ");
  return value.length === 0 ? null : { value, span: { start, end } };
}

function cleanNameCandidate(raw: string): string {
  return cleanNameAt(raw, { start: 0, end: raw.length })?.value ?? "";
}

/**
 * Every pattern here carries the `d` flag: `groupSpan` reads capture positions
 * off `match.indices`, and a pattern without `d` silently yields no span, which
 * would drop the attribution entirely rather than mislocate it.
 */
const NAMED_ATTRIBUTION_PATTERNS: readonly RegExp[] = [
  /\baccording to\s+([^\n]{2,120})/dgi,
  /\bper\s+(?:a|an|the)\s+([^\n]{2,120})/dgi,
  /\bsource\s*:\s*([^\n]{2,120})/dgi,
  /\b(?:study|studies|report|survey|research|analysis|benchmark|index|data)\s+(?:by|from)\s+([^\n]{2,120})/dgi,
  /\b(?:by|from)\s+((?:[A-Z][A-Za-z&.'-]+)(?:\s+[A-Z][A-Za-z&.'-]+){0,5})/dg,
];

/** A bare domain literal used as an attribution ("per Forrester.com"). */
const BARE_DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi;

/**
 * Attribution tokens on one flattened line, WITH their spans.
 *
 * Nothing is read out of the inside of a url. That single restriction is what
 * closes the laundering path where `https://attacker.test/?u=https://our-site/`
 * yielded `our-site` as a fourth attribution candidate and — because the old
 * "any attribution that resolves" rule accepted the first one that did — made
 * the fabricated sentence carrying it read as supported.
 */
export function locatedAttributions(
  flat: FlatLine,
): readonly LocatedAttribution[] {
  const found: LocatedAttribution[] = [];
  const seen = new Set<string>();
  const insideUrl = (span: FlatSpan): boolean =>
    flat.urls.some((url) => spansOverlap(span, url));
  const push = (kind: AttributionKind, value: string, span: FlatSpan): void => {
    const cleaned = kind === "name" ? cleanNameCandidate(value) : value.trim();
    if (cleaned.length === 0) return;
    const key = `${kind}|${cleaned.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ kind, value: cleaned, start: span.start, end: span.end });
  };

  // A link's ATTRIBUTION is its target, located where the reader sees it: at
  // the label. That is what makes `[Forrester](url) reports that 73% …`
  // resolvable against the link the name is written as.
  for (const link of flat.links) push("url", link.target, link);
  for (const url of flat.urls) push("url", url.value, url);

  for (const pattern of NAMED_ATTRIBUTION_PATTERNS) {
    for (const match of flat.text.matchAll(pattern)) {
      const span = groupSpan(match, 1);
      // The url guard is applied to the CAPTURED span, never to the narrowed
      // one: narrowing decides where a name sits, and it must not readmit a
      // candidate the "nothing is read out of the inside of a url" rule already
      // excluded.
      if (span === null || insideUrl(span)) continue;
      const name = cleanNameAt(flat.text, span);
      if (name === null) continue;
      push("name", name.value, name.span);
    }
  }
  for (const match of flat.text.matchAll(BARE_DOMAIN)) {
    if (match.index === undefined) continue;
    const span = { start: match.index, end: match.index + match[0].length };
    if (insideUrl(span)) continue;
    push("url", match[0], span);
  }
  return found;
}

/**
 * The span of one capture group, read off the `d`-flag indices.
 *
 * Positions come from the regex engine rather than from `indexOf`, because a
 * name that also appears earlier in the sentence would otherwise be located at
 * the wrong occurrence — and locating an attribution wrongly is the defect this
 * whole mechanism exists to remove.
 */
function groupSpan(match: RegExpMatchArray, group: number): FlatSpan | null {
  const indices = match.indices?.[group];
  const start = indices?.[0];
  const end = indices?.[1];
  if (start === undefined || end === undefined) return null;
  return { start, end };
}

/**
 * Attribution tokens on one line, in priority order (URLs first, then named
 * attributions). Shape only — none of these is an ALLOW by itself.
 */
export function extractAttributions(line: string): readonly Attribution[] {
  return locatedAttributions(flattenLine(line)).map(({ kind, value }) => ({
    kind,
    value,
  }));
}

export interface ClaimResolution {
  /** `null` when no source in the pack can support this assertion. */
  readonly support: AssertionSupport | null;
  /** `A`/`B`/`C` from the supporting source; `D` when there is none. */
  readonly authority: AuthorityTier;
}

export interface ClaimHit {
  readonly line: number;
  readonly excerpt: string;
  /** The complete sentence containing the assertion, for evidence alignment. */
  readonly statement: string;
  readonly resolution: ClaimResolution;
}

/**
 * Research-assertion patterns.
 *
 * These target EXTERNAL research specifically. "our data shows" / "the export
 * indicates" are deliberately absent: customer drafts can be written over
 * frozen first-party evidence, and treating every mention of customer-owned
 * numbers as an outside attribution would block honest drafts while teaching
 * reviewers to ignore the block.
 */
/**
 * Nouns that name a piece of external research. `analysis`/`analyses` are
 * spelled out because `analysts?` does NOT match them, which is how "A recent
 * McKinsey analysis found a 30 percent lift" scored as no assertion at all.
 */
const RESEARCH_NOUN =
  "research|researchers|studies|study|surveys?|reports?|analyses|analysis|analysts?|scientists?|experts?|evidence|benchmarks?|whitepapers?|polls?|indices|index";

/**
 * Verbs that turn a subject into an assertion. ONE list, shared by both the
 * research-noun pattern and the named-entity pattern.
 *
 * They used to be two lists, and the entity list was the shorter one, so
 * "Forrester notes that 73% of teams abandon activation tracking" was no
 * assertion at all while "Forrester found that 73% …" was blocked. A vocabulary
 * duplicated in two places drifts on the next edit by construction, so it is
 * declared once and consumed twice.
 */
const ASSERTION_VERB =
  "shows?|showed|suggests?|indicates?|indicated|finds?|found|proves?|proven|confirms?|reveals?|revealed|says?|said|estimates?|estimated|recommends?|warns?|concludes?|concluded|puts?|pegs?|ranks?|ranked|polled|surveys?|surveyed|calculates?|calculated|measures?|measured|observes?|observed|records?|recorded|forecasts?|forecast|projects?|projected|predicts?|predicted";

/**
 * Verbs that are also research NOUNS. A set that overlaps itself matches any
 * line carrying the word twice — "Read our onboarding analytics report at [the
 * product report page](…)" was reported as an unsupported research assertion
 * for exactly that reason — so these are readmitted only in a verbal frame.
 */
const AMBIGUOUS_VERB_FRAME =
  "\\b(?:reports?|reported|notes?|noted)\\s+(?:that\\b|an?\\b|the\\b|\\d)";

const ASSERTION_VERB_FRAME = `(?:\\b(?:${ASSERTION_VERB})\\b|${AMBIGUOUS_VERB_FRAME})`;

export const RESEARCH_ASSERTION_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `\\b(?:${RESEARCH_NOUN})\\b[^.!?]{0,60}?${ASSERTION_VERB_FRAME}`,
    "gid",
  ),
  /\baccording to\s+((?:a|an|the)?\s*(?:(?:19|20)\d{2}\s+)?[^.,;:!?]{0,80}?\b(?:study|studies|report|survey|research|analysis|benchmark|index|whitepaper|poll)\b)/dgi,
  /\b((?:19|20)\d{2}\s+[A-Z][^.,;:!?]{0,60}?\b(?:study|report|survey|benchmark|analysis|whitepaper|poll)\b)/dg,
];

/** Which capture group of each pattern names the attributed source, if any. */
const ATTRIBUTED_GROUP: readonly (number | null)[] = [null, 1, 1];

/**
 * `<Named entity> <assertion verb> <statistic>` — the most common shape a
 * hallucinated citation actually takes, and the one none of the patterns above
 * reached. "Forrester found that 73% of B2B onboarding analytics teams abandon
 * activation tracking in week one" names no research noun, says nothing
 * "according to", and carries no year, so it scored as no assertion.
 *
 * Three constraints keep this from swallowing honest first-party writing:
 *
 * 1. The subject must be a capitalized name, and its head word must not be a
 *    pronoun or possessive — `We found that 40% …` is a first-party statement,
 *    not an attribution to an outside body. An ARTICLE head is different: it is
 *    dropped and the name after it is tried, because "The Gartner panel found
 *    that 73% …" attributes to Gartner exactly as "Gartner found that 73% …"
 *    does. Discarding the whole match on an article head is what let the first
 *    of those two pass while the second was blocked.
 * 2. The name must not be preceded by a POSSESSIVE. That is what keeps "our
 *    Search Console export indicates clicks fell 34%" out: the capitalized span
 *    there is a common-noun phrase the customer owns, not the name of an
 *    outside authority.
 * 3. A statistic must follow within the same sentence. An assertion with a
 *    number in it is the shape that needs a source; "Teams find the milestone
 *    that matters faster" is prose.
 */
/**
 * Two bounds here are load-bearing, and each replaced a defect.
 *
 * 1. **The name run is capped at eight tokens** (`cleanNameCandidate` already
 *    truncates there, so nothing real is lost). Unbounded, the run is a greedy
 *    star that backtracks one token at a time from every start position, which
 *    is O(n²) in the length of a run of capitalized words. A single 396,000-
 *    character line — inside the 400,000-character contract — took 36 seconds
 *    of pure backtracking; the same text split across lines took 184ms. A cap
 *    makes the work per start position constant.
 * 2. **The gap between the name and the verb admits numbers and bracketed
 *    decorations.** It used to be lowercase words only, so `Forrester's 2024
 *    data puts churn at 42%` broke at `2024` and was no assertion at all while
 *    `Forrester's data puts churn at 42%` was blocked — one token of difference
 *    between a fabrication and a clean pass. The same held for a bracket a
 *    reader sees in the rendered name (`[Forrester [Inc]](url) reports that
 *    73% …`). Emphasis is stripped upstream in `flattenLine`, so the `**2024**`
 *    spelling reaches here as `2024`.
 */
const ENTITY_ASSERTION = new RegExp(
  `(?<![\\w'’-])((?:[A-Z][A-Za-z0-9&.'’-]*)(?:[ ](?:[A-Z][A-Za-z0-9&.'’-]*|&)){0,7})((?:[ ](?:[a-z][A-Za-z-]*|\\d[\\w.'’-]*|\\[[^\\]\\n]{0,40}\\])){0,3})[ ]${ASSERTION_VERB_FRAME}[^.!?]{0,80}?\\d`,
  "gd",
);

/**
 * `According to <Name>, ...` and `Per <Name>, ...`, with or without a number.
 *
 * The frame is an explicit attribution — the writer is telling the reader where
 * this came from — so it needs no research noun, assertion verb, or statistic.
 * Without this, `According to Forrester Research, 73% …` was blocked purely
 * because the company's last word happens to be a research noun, while
 * `According to Forrester, structured milestones improve activation` and
 * `Per Gartner, onboarding time fell` passed.
 *
 * The name still goes through `trimNameSpan`, so `According to the dashboard,
 * accounts stalled` (no capitalized name) and `According to our own export, …`
 * (possessive) stay out.
 */
// The frame is spelled with an explicit case class rather than carried on the
// `i` flag: `i` would also fold `[A-Z]` in the name group, and the whole point
// of that group is that the name is CAPITALIZED.
const ATTRIBUTION_FRAME_ASSERTION =
  /\b(?:[Aa]ccording\s+[Tt]o|[Pp]er)\s+((?:[A-Z][A-Za-z0-9&.'’-]*)(?:[ ](?:[A-Z][A-Za-z0-9&.'’-]*|&)){0,7})/dg;

/** Heads that are a pronoun or a possessive: never an outside authority. */
const PRONOUN_HEAD =
  /^(?:i|we|us|our|ours|you|your|yours|they|them|their|theirs|he|him|his|she|her|hers|it|its)$/i;

/**
 * Heads that are function words. These are DROPPED and the name after them
 * retried, rather than discarding the assertion.
 */
const ARTICLE_HEAD =
  /^(?:this|that|these|those|the|a|an|there|here|then|now|today|and|but|or|if|so|when|while|after|before|because|however|although|though|since|most|many|some|few|all|both|each|every|no|not|another|other|such)$/i;

/** Possessives that mark the span after them as a common noun the customer owns. */
const POSSESSIVE_BEFORE_NAME =
  /(?:^|[^\w'’-])(?:our|my|your|their|its|his|her)\s+$/i;

interface AssertionMatch {
  readonly index: number;
  readonly excerpt: string;
  /**
   * The span this assertion attributes to, when it names one. `null` means the
   * assertion named nobody, and support may then come from anywhere in its own
   * sentence.
   */
  readonly attributedTo: FlatSpan | null;
}

/** Drop leading article tokens; `null` when nothing citable is left. */
function trimNameSpan(text: string, span: FlatSpan): FlatSpan | null {
  let start = span.start;
  for (;;) {
    const rest = text.slice(start, span.end);
    const token = /^[^\s&]+/.exec(rest)?.[0];
    if (token === undefined || token.length === 0) return null;
    if (PRONOUN_HEAD.test(token)) return null;
    if (!ARTICLE_HEAD.test(token)) break;
    const consumed = /^[^\s&]+[\s&]+/.exec(rest)?.[0]?.length;
    if (consumed === undefined) return null;
    start += consumed;
    if (start >= span.end) return null;
  }
  return /^[A-Z]/.test(text.slice(start, span.end))
    ? { start, end: span.end }
    : null;
}

function entityAssertions(text: string): readonly AssertionMatch[] {
  const found: AssertionMatch[] = [];
  for (const pattern of [ENTITY_ASSERTION, ATTRIBUTION_FRAME_ASSERTION]) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const nameSpan = groupSpan(match, 1);
      if (nameSpan === null) continue;
      const trimmed = trimNameSpan(text, nameSpan);
      if (trimmed === null) continue;
      if (POSSESSIVE_BEFORE_NAME.test(text.slice(0, nameSpan.start))) continue;
      found.push({
        index: match.index,
        excerpt: match[0],
        attributedTo: trimmed,
      });
    }
  }
  return found;
}

/** Every external-research assertion shape on one line, in document order. */
function researchAssertions(text: string): readonly AssertionMatch[] {
  const found: AssertionMatch[] = [];
  for (const [position, pattern] of RESEARCH_ASSERTION_PATTERNS.entries()) {
    const group = ATTRIBUTED_GROUP[position] ?? null;
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      found.push({
        index: match.index,
        excerpt: match[0],
        attributedTo: group === null ? null : groupSpan(match, group),
      });
    }
  }
  found.push(...entityAssertions(text));
  return found.sort((left, right) => left.index - right.index);
}

/**
 * The attributions that may support ONE assertion.
 *
 * When the assertion names who it attributes to, only that name and the link it
 * is written as can support it. When it names nobody, its own sentence is the
 * widest region a reader would read as belonging to it. Neither is "anything
 * that appears on this line", which is how a call-to-action link three
 * sentences away came to vouch for an invented study.
 */
function supportCandidates(
  flat: FlatLine,
  attributions: readonly LocatedAttribution[],
  assertion: AssertionMatch,
): readonly Attribution[] {
  const span = assertion.attributedTo;
  if (span === null) {
    const sentence = sentenceSpanAt(flat.text, assertion.index);
    return attributions.filter((attribution) =>
      spansOverlap(attribution, sentence),
    );
  }
  const located = attributions.filter(
    (attribution) =>
      spansOverlap(attribution, span) || spanWithin(attribution, span),
  );
  const name = cleanNameCandidate(flat.text.slice(span.start, span.end));
  return name.length > 0
    ? [...located, { kind: "name", value: name }]
    : located;
}

/** The textual extent of one assertion match on the flattened line. */
function assertionSpan(assertion: AssertionMatch): FlatSpan {
  return {
    start: assertion.index,
    end: assertion.index + assertion.excerpt.length,
  };
}

/**
 * Is this the WEAKER reading of an assertion another pattern already named?
 *
 * The shapes overlap on purpose: `The Analyst Insights report found that
 * activation improves 30%` is seen both as "research noun beside an assertion
 * verb" (which names nobody, so its whole sentence may support it) and as
 * "capitalized name beside an assertion verb" (which names Analyst Insights and
 * may be supported by that alone). Those are one defect, not two, and only the
 * second reading knows who the sentence attributes to — so the unnamed reading
 * yields to a named one it overlaps.
 *
 * The subsumption is one-directional. Two NAMED readings that overlap are kept
 * apart, because they can name different sources: `According to Analyst
 * Insights, Forrester found that 73% of teams churn` is a supported attribution
 * and an invented one sharing a sentence, and collapsing them is exactly the
 * "one resolution licenses the whole line" mistake the role split removed.
 */
function subsumedByNamedAssertion(
  assertion: AssertionMatch,
  named: readonly AssertionMatch[],
): boolean {
  if (assertion.attributedTo !== null) return false;
  const span = assertionSpan(assertion);
  return named.some((other) => spansOverlap(span, assertionSpan(other)));
}

/**
 * Find every external-research assertion and resolve its attribution.
 *
 * EVERY assertion on a line is extracted and resolved on its own evidence. It
 * used to be the first one per line, which made a line's verdict depend on the
 * order its sentences were written in: `According to Analyst Insights,
 * activation rose 30%. According to Forrester, 73% of teams abandon activation
 * tracking.` reported one claim — the resolvable one — and RL8 wrote down that
 * all of its assertions resolved, so the invented Forrester citation beside it
 * was invisible to both blocking rules. Moving that same fabrication onto its
 * own line blocked the draft. One sentence of distance is not a fact about
 * whether a citation is real.
 *
 * Two claims are the SAME claim when they sit in one sentence and resolve to
 * one source (including "to nothing"): that is several patterns recognising one
 * assertion, and reporting it three times would make one defect read as three.
 * Two that resolve differently are two claims even inside one sentence, which
 * is what keeps a resolvable neighbour from licensing an invented one.
 */
export function findUnsupportedClaims(
  index: SourceIndex,
  lines: readonly { readonly line: number; readonly text: string }[],
): readonly ClaimHit[] {
  const hits: ClaimHit[] = [];
  for (const entry of lines) {
    const flat = flattenLine(entry.text);
    if (flat.text.trim().length === 0) continue;
    const attributions = locatedAttributions(flat);
    // An honest disclaimer ("no study shows that ...") is not an assertion.
    // Only a negator that directly governs the noun exempts it.
    const matches = researchAssertions(flat.text).filter(
      (match) => !hasDirectNegation(clauseBefore(flat.text, match.index)),
    );
    const named = matches.filter((match) => match.attributedTo !== null);
    const seen = new Set<string>();
    for (const match of matches) {
      if (subsumedByNamedAssertion(match, named)) continue;
      const support = resolveAssertionSupport(
        index,
        supportCandidates(flat, attributions, match),
      );
      const sentence = sentenceSpanAt(flat.text, match.index);
      const key = `${sentence.start}|${support === null ? "" : support.source.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        line: entry.line,
        excerpt: match.excerpt,
        statement: flat.text.slice(sentence.start, sentence.end).trim(),
        resolution: { support, authority: support?.authority ?? "D" },
      });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}
