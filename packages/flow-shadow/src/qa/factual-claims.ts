import type { QaContext } from "./context.ts";
import {
  evidenceSourceDescription,
  findEvidenceTextMatch,
  type EvidenceTextMatch,
} from "./evidence.ts";
import { flattenLine, paragraphBlocks, truncateExcerpt } from "./text.ts";

export type BroadFactualClaimKind =
  | "quantified"
  | "guarantee"
  | "superlative";

export type BroadFactualClaimStatus =
  | "supported"
  | "unsupported"
  | "uncertain";

export interface BroadFactualClaim {
  readonly line: number;
  readonly excerpt: string;
  readonly kind: BroadFactualClaimKind;
  readonly status: BroadFactualClaimStatus;
  readonly evidence: EvidenceTextMatch | null;
}

export interface BroadFactualClaimScan {
  readonly claims: readonly BroadFactualClaim[];
  readonly truncated: boolean;
}

const MAX_FACTUAL_CLAIMS = 256;

const FIRST_PARTY_CUE =
  /\b(?:I|we|us|our|ours|my|mine|the company|our (?:product|platform|workflow|data|analysis|dashboard|export|customers?))\b/i;
const NAMED_EXTERNAL_ATTRIBUTION_CUE =
  /\b(?:[Aa]ccording\s+[Tt]o|[Pp]er\s+[A-Z])/;
const EXTERNAL_RESEARCH_NOUN_CUE =
  /\b(?:industry\s+(?:research|data|analysis)|(?:research|study|studies|survey|report|benchmark|whitepaper|poll)\s+(?:shows?|showed|suggests?|suggested|finds?|found|indicates?|indicated|reports?|reported|says?|said))\b/i;
const QUANTIFIED =
  /(?:[$€£]\s*\d[\d,.]*|\b\d+(?:[.,]\d+)?\s*(?:%|percent(?:age points?)?|x|times?|million|billion)\b|\b(?:(?:about|around|over|nearly|approximately)\s+|(?:more|fewer|less)\s+than\s+|at\s+least\s+)?\d[\d,.]*\s+(?:customers?|teams?|companies|users?|accounts?|respondents?|organizations?|businesses?|leaders?|buyers?|marketers?|employees?|people|projects?|workflows?|events?|records?)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:hours?|days?|weeks?|months?|years?)\s+(?:faster|slower|sooner|earlier|later|less|more)\b|\b(?:twice|(?:three|four|five|six|seven|eight|nine|ten)\s+times)\s+as\s+(?:fast|slow|effective|likely|large|small)\b|\b(?:cuts?|reduces?|improves?|increases?|decreases?|saves?|costs?)\b[^.!?]{0,48}\b(?:by|from)\s+(?:[$€£]\s*)?\d)/i;
const GUARANTEE =
  /\b(?:guarantee(?:d|s|ing)?|risk[- ]free|zero[- ]risk|will always|never fails?|100%\s+(?:certain|successful|effective))\b/i;
const SUPERLATIVE =
  /\b(?:best(?:-in-class)?|fastest|easiest|strongest|highest|lowest|(?:industry|market)[- ]leading|leading\s+(?:provider|platform|product|solution|vendor|company|tool|service|system)|unmatched|unrivaled|unparalleled|number\s+one|#\s*1|only\s+\w+(?:\s+\w+){0,4}\s+(?:available|on the market|in the industry))\b/i;

interface SentencePiece {
  readonly text: string;
}

function sentencePieces(text: string): readonly SentencePiece[] {
  const pieces: SentencePiece[] = [];
  for (const match of text.matchAll(/[^.!?]+(?:[.!?]+|$)/g)) {
    const value = match[0].trim();
    if (value.length > 0) pieces.push({ text: value });
  }
  return pieces;
}

export function classifyBroadFactualClaim(
  sentence: string,
): BroadFactualClaimKind | null {
  if (GUARANTEE.test(sentence)) return "guarantee";
  if (SUPERLATIVE.test(sentence)) return "superlative";
  if (QUANTIFIED.test(sentence)) return "quantified";
  return null;
}

export function isFirstPartyStatement(sentence: string): boolean {
  return FIRST_PARTY_CUE.test(sentence);
}

export function isExplicitExternalResearchStatement(sentence: string): boolean {
  return (
    NAMED_EXTERNAL_ATTRIBUTION_CUE.test(sentence) ||
    EXTERNAL_RESEARCH_NOUN_CUE.test(sentence)
  );
}

/**
 * Scan only high-signal external factual shapes. This is not a parser for every
 * proposition in English and does not claim to be one: attribution/research
 * statements are handled by `findUnsupportedClaims`; this companion adds
 * quantified, guarantee, and superlative shapes that previously escaped.
 */
export function findBroadExternalFactualClaims(
  context: QaContext,
): BroadFactualClaimScan {
  const claims: BroadFactualClaim[] = [];
  let truncated = false;
  for (const block of paragraphBlocks(context.body)) {
    const flattened = flattenLine(block.text).text;
    for (const sentence of sentencePieces(flattened)) {
      const kind = classifyBroadFactualClaim(sentence.text);
      if (kind === null || isFirstPartyStatement(sentence.text)) continue;
      // A product/customer statement need not use "we" in every sentence. A
      // precise lexical match in a captured first-party page is enough to
      // classify a quantified statement as customer-owned, but never when the
      // sentence explicitly attributes the fact to outside research.
      if (
        kind === "quantified" &&
        !isExplicitExternalResearchStatement(sentence.text) &&
        findEvidenceTextMatch(
          context.index,
          sentence.text,
          "first_party",
        ).match !== null
      ) {
        continue;
      }
      if (claims.length >= MAX_FACTUAL_CLAIMS) {
        truncated = true;
        continue;
      }
      if (kind === "guarantee") {
        claims.push({
          line: block.line,
          excerpt: truncateExcerpt(sentence.text, 180),
          kind,
          status: "unsupported",
          evidence: null,
        });
        continue;
      }
      const evidence = findEvidenceTextMatch(
        context.index,
        sentence.text,
        "external",
      );
      if (kind === "superlative") {
        claims.push({
          line: block.line,
          excerpt: truncateExcerpt(sentence.text, 180),
          kind,
          // Lexical repetition of a ranking is not independent verification.
          status: evidence.match === null && !evidence.bounded
            ? "unsupported"
            : "uncertain",
          evidence: evidence.match,
        });
        continue;
      }
      claims.push({
        line: block.line,
        excerpt: truncateExcerpt(sentence.text, 180),
        kind,
        status:
          evidence.bounded
            ? "uncertain"
            : evidence.match !== null
              ? "supported"
              : "unsupported",
        evidence: evidence.match,
      });
    }
  }
  return { claims, truncated };
}

export function factualClaimDescription(claim: BroadFactualClaim): string {
  const source =
    claim.evidence === null
      ? ""
      : `; lexical evidence ${evidenceSourceDescription(claim.evidence.source)}`;
  return `line ${claim.line} ${claim.kind}: "${truncateExcerpt(claim.excerpt, 120)}"${source}`;
}
