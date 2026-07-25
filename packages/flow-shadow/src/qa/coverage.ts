import type { QaClaim, QaClaimStatus } from "../types.ts";
import type { QaContext } from "./context.ts";
import { tokenize } from "./text.ts";

/**
 * The brief -> draft coverage claim (decisions O-4 and O-6).
 *
 * O-6 draws the line this file sits on: `briefSections` is a COVERAGE
 * CHECKLIST, not a document structure. So the question asked here is "is each
 * committed topic discussed somewhere in the body?" — never "is the body
 * organised into these sections?". The structure checks own the fixed scaffold
 * and never read `briefSections`; this check reads `briefSections` and never
 * asserts anything about headings. Crossing those two would make the design
 * contradict itself, and every draft would fail one of them.
 *
 * O-4 fixes the failure treatment: an extraction that produced no outline means
 * the causal chain from brief to draft is broken for this run, and that is
 * reported as a FAILED claim rather than a quiet limitation, so the verdict can
 * never read as a clean pass over it.
 */
export const QA_BRIEF_OUTLINE_CLAIM_ID = "content-shadow.qa.brief-outline";

/** Words too common to prove a topic was covered. */
const STOPWORDS: ReadonlySet<string> = new Set([
  "the",
  "and",
  "for",
  "with",
  "what",
  "when",
  "how",
  "why",
  "that",
  "this",
  "from",
  "your",
  "our",
  "are",
  "was",
  "will",
  "into",
  "over",
  "about",
  "their",
  "them",
  "you",
  "its",
]);

const MIN_TOPIC_TOKEN_LEN = 4;
const TOPIC_RECALL_FLOOR = 0.5;

function topicTokens(section: string): readonly string[] {
  return tokenize(section).filter(
    (token) => token.length >= MIN_TOPIC_TOKEN_LEN && !STOPWORDS.has(token),
  );
}

function shortfallSentence(context: QaContext): string {
  const { briefSectionCount, projectedSectionCount } = context.input.briefOutlineStats;
  const dropped = briefSectionCount - projectedSectionCount;
  // Kept verbatim from Task 4b: "the brief contributed N topics" over a brief
  // that committed to more is a true sentence that reads as a complete one.
  return dropped > 0
    ? ` The pinned brief carried ${briefSectionCount} distinct section heading(s); ${dropped} were dropped by the outline cap and never reached the prompt.`
    : "";
}

export function briefCoverageClaim(context: QaContext): QaClaim {
  const sections = context.input.pack.briefOutline.briefSections;
  if (sections.length === 0) {
    return {
      claimId: QA_BRIEF_OUTLINE_CLAIM_ID,
      kind: "coverage",
      status: "failed",
      detail:
        "The pinned content brief revision carried no machine-readable outline, so this draft was not guided by the brief. Review it against the brief by hand.",
    };
  }
  if (!context.english) {
    return {
      claimId: QA_BRIEF_OUTLINE_CLAIM_ID,
      kind: "coverage",
      status: "unevaluated",
      detail: `The brief contributed ${sections.length} coverage topic(s) to the draft prompt. Coverage was NOT judged: this draft is "${context.input.pack.outputLocale}" and topic matching is an English-language heuristic — locale not supported by deterministic segmentation.${shortfallSentence(context)}`,
    };
  }

  const draftTokens = new Set(context.draftTokens);
  const missing: string[] = [];
  for (const section of sections) {
    const tokens = topicTokens(section);
    if (tokens.length === 0) continue;
    const hit = tokens.filter((token) => draftTokens.has(token)).length;
    if (hit / tokens.length < TOPIC_RECALL_FLOOR) missing.push(section);
  }

  const status: QaClaimStatus = missing.length > 0 ? "failed" : "passed";
  const detail =
    missing.length > 0
      ? `The draft does not visibly cover ${missing.length} of the ${sections.length} topic(s) the confirmed brief committed to: ${missing.map((section) => `"${section}"`).join(", ")}.${shortfallSentence(context)}`
      : `The draft covers all ${sections.length} coverage topic(s) the confirmed brief committed to.${shortfallSentence(context)}`;
  return {
    claimId: QA_BRIEF_OUTLINE_CLAIM_ID,
    kind: "coverage",
    status,
    detail,
  };
}
