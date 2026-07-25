import type { AuthorityTier, ResearchPack } from "../types.ts";
import { QA_THRESHOLDS } from "./thresholds.ts";
import {
  canonicalUrl,
  clauseBefore,
  extractMarkdownLinks,
  extractUrls,
  hasNegationCue,
  normalizeName,
  stripInlineCode,
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
 * source the frozen research pack actually carries?" The pack is assembled only
 * from database rows the customer already confirmed, so a fabricated source has
 * nowhere to resolve to. Shape is used to FIND the attribution; only identity
 * decides whether it holds.
 *
 * Slice 2 consequence, stated plainly: the deterministic pack retrieves nothing
 * external, so every `ref` it emits is an opaque SignalFrame uuid and NO
 * external attribution can resolve. That is not a gap in this chain — it is the
 * true statement that a Slice 2 draft has no external research behind it, so
 * any external citation in one is invented.
 */

export interface SourceIdentity {
  readonly ref: string;
  readonly authority: AuthorityTier;
  readonly url: string | null;
  readonly domain: string | null;
  readonly name: string | null;
  /** Longest alphabetic token of `name`, for partial name matching. */
  readonly nameToken: string | null;
}

export interface SourceIndex {
  readonly identities: readonly SourceIdentity[];
  /**
   * How many sources carry an identity a draft could plausibly cite (a URL, a
   * domain, or a human-readable name). Zero in Slice 2 — the rules that expect
   * citations use this to say "not applicable" instead of inventing a verdict.
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

function identityFor(ref: string, authority: AuthorityTier): SourceIdentity {
  if (UUID.test(ref.trim())) {
    return {
      ref,
      authority,
      url: null,
      domain: null,
      name: null,
      nameToken: null,
    };
  }
  const url = canonicalUrl(ref);
  if (url) {
    return {
      ref,
      authority,
      url: url.url,
      domain: url.domain,
      name: null,
      nameToken: null,
    };
  }
  const name = normalizeName(ref);
  return {
    ref,
    authority,
    url: null,
    domain: null,
    name: name.length > 0 ? name : null,
    nameToken: longestAlphaToken(name),
  };
}

export function buildSourceIndex(pack: ResearchPack): SourceIndex {
  const identities = pack.sources.map((source) =>
    identityFor(source.ref, source.authorityTier),
  );
  const citableCount = identities.filter(
    (identity) => identity.url !== null || identity.nameToken !== null,
  ).length;
  return { identities, citableCount };
}

export type AttributionKind = "url" | "name";

export interface Attribution {
  readonly kind: AttributionKind;
  readonly value: string;
}

export interface Resolution {
  /** `null` when nothing in the pack matched. */
  readonly source: SourceIdentity | null;
  /** `A`/`B`/`C` copied from the resolved source; `D` when nothing resolved. */
  readonly authority: AuthorityTier;
}

const UNRESOLVED: Resolution = { source: null, authority: "D" };

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
    if (!url) return UNRESOLVED;
    for (const identity of index.identities) {
      if (identity.url === url.url)
        return { source: identity, authority: identity.authority };
    }
    for (const identity of index.identities) {
      if (identity.domain === url.domain) {
        return { source: identity, authority: identity.authority };
      }
    }
    return UNRESOLVED;
  }

  const name = normalizeName(attribution.value);
  if (name.length === 0) return UNRESOLVED;
  for (const identity of index.identities) {
    if (identity.name !== null && identity.name === name) {
      return { source: identity, authority: identity.authority };
    }
  }
  // Partial match, but only on a token long enough to be an identity: "the",
  // "data" and "2024" must never be able to resolve an attribution.
  for (const identity of index.identities) {
    if (identity.nameToken === null) continue;
    if (name.split(" ").includes(identity.nameToken)) {
      return { source: identity, authority: identity.authority };
    }
  }
  return UNRESOLVED;
}

/** First resolution that holds, or `D` when none does. */
export function resolveAny(
  index: SourceIndex,
  attributions: readonly Attribution[],
): Resolution {
  for (const attribution of attributions) {
    const resolution = resolveAttribution(index, attribution);
    if (resolution.source !== null) return resolution;
  }
  return UNRESOLVED;
}

const LEADING_NOISE = /^(?:a|an|the|its|their|our|this|that|recent|new)\s+/i;
const LEADING_YEAR = /^(?:19|20)\d{2}\s+/;
// `report`/`survey`/`index` are deliberately NOT stop words: they are part of a
// title ("Forrester Digital Experience Report"), and cutting there would leave a
// truncated name that resolves against the wrong source or none at all.
const NAME_STOP =
  /[,.;:!?)]|\s+(?:which|that|who|whose|and|but|found|shows?|showed|suggests?|reported|says?|said|estimates?|indicates?)\b/i;

function cleanNameCandidate(raw: string): string {
  let value = raw.trim();
  const stop = NAME_STOP.exec(value);
  if (stop?.index !== undefined && stop.index > 0)
    value = value.slice(0, stop.index);
  let previous = "";
  while (previous !== value) {
    previous = value;
    value = value.replace(LEADING_NOISE, "").replace(LEADING_YEAR, "");
  }
  return value.trim().split(/\s+/).slice(0, 8).join(" ");
}

/**
 * Attribution tokens on one line, in priority order (URLs first, then named
 * attributions). Shape only — none of these is an ALLOW by itself.
 */
export function extractAttributions(line: string): readonly Attribution[] {
  const text = stripInlineCode(line);
  const found: Attribution[] = [];
  const seen = new Set<string>();
  const push = (kind: AttributionKind, value: string): void => {
    const cleaned = kind === "name" ? cleanNameCandidate(value) : value.trim();
    if (cleaned.length === 0) return;
    const key = `${kind}|${cleaned.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ kind, value: cleaned });
  };

  for (const link of extractMarkdownLinks(text)) push("url", link.target);
  for (const url of extractUrls(text)) push("url", url);

  const named = [
    /\baccording to\s+([^\n]{2,120})/gi,
    /\bper\s+(?:a|an|the)\s+([^\n]{2,120})/gi,
    /\bsource\s*:\s*([^\n]{2,120})/gi,
    /\b(?:study|studies|report|survey|research|analysis|benchmark|index|data)\s+(?:by|from)\s+([^\n]{2,120})/gi,
    /\b(?:by|from)\s+((?:[A-Z][A-Za-z&.'-]+)(?:\s+[A-Z][A-Za-z&.'-]+){0,5})/g,
  ];
  for (const pattern of named) {
    for (const match of text.matchAll(pattern)) push("name", match[1] ?? "");
  }

  // A bare domain literal used as an attribution ("per Forrester.com").
  for (const match of text.matchAll(
    /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi,
  )) {
    push("url", match[0]);
  }
  return found;
}

export interface ClaimHit {
  readonly line: number;
  readonly excerpt: string;
  readonly resolution: Resolution;
}

/**
 * Research-assertion patterns.
 *
 * These target EXTERNAL research specifically. "our data shows" / "the export
 * indicates" are deliberately absent: SignalFrame drafts are written over
 * first-party evidence that the prompt really did supply, and treating every
 * mention of the customer's own numbers as an unsupported claim would block
 * honest drafts while teaching reviewers to ignore the block.
 */
export const RESEARCH_ASSERTION_PATTERNS: readonly RegExp[] = [
  /\b(?:research|researchers|studies|study|surveys?|reports?|analysts?|scientists?|experts?|evidence)\b[^.!?]{0,60}?\b(?:shows?|showed|suggests?|indicates?|finds?|found|proves?|proven|confirms?|reveals?|says?|reports?|estimates?|recommends?|warns?)\b/gi,
  /\baccording to\s+(?:a|an|the)?\s*(?:(?:19|20)\d{2}\s+)?[^.,;:!?]{0,80}?\b(?:study|studies|report|survey|research|analysis|benchmark|index|whitepaper)\b/gi,
  /\b(?:19|20)\d{2}\s+[A-Z][^.,;:!?]{0,60}?\b(?:study|report|survey|benchmark)\b/g,
];

/** Find every external-research assertion and resolve its attribution. */
export function findUnsupportedClaims(
  index: SourceIndex,
  lines: readonly { readonly line: number; readonly text: string }[],
): readonly ClaimHit[] {
  const hits: ClaimHit[] = [];
  const seen = new Set<number>();
  for (const entry of lines) {
    const text = stripInlineCode(entry.text);
    if (text.trim().length === 0) continue;
    for (const pattern of RESEARCH_ASSERTION_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        if (match.index === undefined) continue;
        // An honest disclaimer ("no study shows that ...") is not an assertion.
        if (hasNegationCue(clauseBefore(text, match.index))) continue;
        if (seen.has(entry.line)) continue;
        seen.add(entry.line);
        hits.push({
          line: entry.line,
          excerpt: match[0],
          resolution: resolveAny(index, extractAttributions(text)),
        });
      }
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}
