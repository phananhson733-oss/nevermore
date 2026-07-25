import type { QaClaim, QaClaimStatus } from "../types.ts";
import type { QaContext } from "./context.ts";
import { tokenize } from "./text.ts";

/**
 * The brief -> draft coverage claim (decisions O-4 and O-6, corrected).
 *
 * WHAT THIS CHECK JUDGES, AND WHY IT CHANGED.
 *
 * O-6 defined `briefSections` as a COVERAGE CHECKLIST rather than a document
 * structure, and this file used to read it as the list of topics the draft had
 * to discuss. That reading is dead on arrival for a spec-conformant brief, and
 * the reason is worth writing down because two individually correct decisions
 * produced it:
 *
 * - O-6 said `briefSections` is the list of committed TOPICS.
 * - Task 4b's injection hardening replaced every heading that matches the
 *   §10.1 alias table with one of nine English canonical constants, so the
 *   operator's bytes never reach the model.
 *
 * The brief validator REQUIRES all nine standard sections, so for any brief
 * that passes it, `briefSections` is exactly `Objective / Audience / Search
 * Intent / Target Topics & Queries / Outline / Evidence / Conversion Path /
 * Proof & Source Requirements / Acceptance Checklist`. Those are document
 * structure labels. A blog post about onboarding analytics will never contain
 * the words "objective", "outline", "acceptance" or "requirements", so the
 * check reported 8 of 9 topics uncovered on a perfectly good draft and pinned
 * the verdict at `needs_review` forever — which is precisely the disease this
 * file claimed to treat. The canonicalisation that made the value safe is what
 * removed the topic information that made it judgeable.
 *
 * So coverage is judged against `briefOutline.targetKeywords` instead. Those
 * come from the frozen SearchQuery cluster, they are real subject-matter terms,
 * and "did the draft actually talk about what this cluster is about?" is the
 * question the claim was always trying to ask. `briefSections` stays in the
 * manifest and in the pack — it is a frozen input that shapes the prompt and
 * red line C needs it recorded — it is simply no longer the coverage subject.
 *
 * O-4 is unchanged: an extraction that produced no outline at all means the
 * causal chain from brief to draft is broken for this run, and that is reported
 * as a FAILED claim rather than a quiet limitation.
 *
 * The boundary with `structure-checks.ts` still holds in both directions: this
 * file asserts nothing about headings, and the structure checks read neither
 * `briefSections` nor `targetKeywords`.
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

function topicTokens(topic: string): readonly string[] {
  return tokenize(topic).filter(
    (token) => token.length >= MIN_TOPIC_TOKEN_LEN && !STOPWORDS.has(token),
  );
}

function shortfallSentence(context: QaContext): string {
  const { briefSectionCount, projectedSectionCount } =
    context.input.briefOutlineStats;
  const dropped = briefSectionCount - projectedSectionCount;
  // Kept verbatim from Task 4b: "the brief contributed N topics" over a brief
  // that committed to more is a true sentence that reads as a complete one.
  return dropped > 0
    ? ` The pinned brief carried ${briefSectionCount} distinct section heading(s); ${dropped} were dropped by the outline cap and never reached the prompt.`
    : "";
}

function claim(status: QaClaimStatus, detail: string): QaClaim {
  return {
    claimId: QA_BRIEF_OUTLINE_CLAIM_ID,
    kind: "coverage",
    status,
    detail,
  };
}

export function briefCoverageClaim(context: QaContext): QaClaim {
  const outline = context.input.pack.briefOutline;
  if (outline.briefSections.length === 0) {
    return claim(
      "failed",
      "The pinned content brief revision carried no machine-readable outline, so this draft was not guided by the brief. Review it against the brief by hand.",
    );
  }

  const topics = outline.targetKeywords;
  if (topics.length === 0) {
    return claim(
      "unevaluated",
      `Coverage was NOT judged: the frozen search cluster contributed no target keyword, and target keywords are the only subject-matter terms this outline carries. The brief's ${outline.briefSections.length} section label(s) are canonicalised document-structure names (decision O-6 plus Task 4b's injection hardening), so they cannot stand in for topics. Judge coverage against the brief by hand.${shortfallSentence(context)}`,
    );
  }

  if (!context.english) {
    return claim(
      "unevaluated",
      `The frozen cluster contributed ${topics.length} target keyword(s) to the draft prompt. Coverage was NOT judged: this draft is "${context.input.pack.outputLocale}" and topic matching is an English-language heuristic — locale not supported by deterministic segmentation.${shortfallSentence(context)}`,
    );
  }

  const draftTokens = new Set(context.draftTokens);
  const missing: string[] = [];
  let judged = 0;
  for (const topic of topics) {
    const tokens = topicTokens(topic);
    // A keyword made only of short or stopword tokens ("seo", "how to") carries
    // nothing this heuristic can look for. Skipping it silently and then
    // reporting "covers all topics" would be the same "we did not look" -> "we
    // found nothing" substitution the gate exists to prevent, so the skips are
    // counted and a run where EVERY keyword is unjudgeable reports unevaluated.
    if (tokens.length === 0) continue;
    judged += 1;
    const hit = tokens.filter((token) => draftTokens.has(token)).length;
    if (hit / tokens.length < TOPIC_RECALL_FLOOR) missing.push(topic);
  }

  if (judged === 0) {
    return claim(
      "unevaluated",
      `Coverage was NOT judged: none of the ${topics.length} frozen target keyword(s) carries a token long enough to search for (every token is under ${MIN_TOPIC_TOKEN_LEN} characters or is a stopword). Judge coverage against the brief by hand.${shortfallSentence(context)}`,
    );
  }

  const skipped = topics.length - judged;
  const skippedSentence =
    skipped > 0
      ? ` ${skipped} further keyword(s) carried no searchable token and were not judged.`
      : "";
  return missing.length > 0
    ? claim(
        "failed",
        `The draft does not visibly cover ${missing.length} of the ${judged} frozen target keyword(s) this cluster committed to: ${missing.map((topic) => `"${topic}"`).join(", ")}.${skippedSentence}${shortfallSentence(context)}`,
      )
    : claim(
        "passed",
        `The draft covers all ${judged} frozen target keyword(s) this cluster committed to.${skippedSentence}${shortfallSentence(context)}`,
      );
}
