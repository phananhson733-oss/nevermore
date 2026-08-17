// @input  -- a confirmed product category, buyer description, and optional rivals
// @output -- eight editable buyer questions spanning the states a buyer moves through
// @pos    -- the deterministic question generator the visitor confirms before paying

import {
  GEO_MAX_QUESTION_LENGTH,
  GEO_QUESTIONS_PER_RUN,
} from "./geo-report-contract.ts";

/**
 * Why these are templates rather than a model call.
 *
 * The visitor confirms and edits every question before a single paid call is
 * made, so the generator's job is to produce a defensible starting set, not a
 * clever one. A model call here would add a second provider, a second failure
 * mode and a second bill to a step whose output a human immediately rewrites.
 * The templates are also auditable: a question that reads badly can be traced
 * to a line in this file instead of to a prompt.
 */
export interface GeoQuestionSeed {
  /** What the site sells, in the visitor's words: "AI visibility tracking". */
  readonly category: string;
  /** Who buys it: "SaaS marketing teams". */
  readonly buyer: string;
  /** Competitor names the buyer would recognise. */
  readonly rivals: readonly string[];
}

export interface GeneratedGeoQuestion {
  readonly questionId: string;
  readonly question: string;
  /** Where in the buyer's journey this question sits, for the confirm UI. */
  readonly stage: "discovery" | "comparison" | "evaluation" | "decision";
}

function clean(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/**
 * Trim to the provider's ceiling without cutting a word in half.
 *
 * A question over the limit is refused by the provider after being billed, so
 * the bound is enforced at generation time rather than discovered at run time.
 */
function bounded(value: string): string {
  const text = clean(value);
  if (text.length <= GEO_MAX_QUESTION_LENGTH) return text;
  const cut = text.slice(0, GEO_MAX_QUESTION_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * The eight questions.
 *
 * Spread across the journey on purpose: a set drawn only from discovery would
 * measure visibility for people who do not yet know what they want, which is
 * the easiest place to appear and the least useful place to be measured.
 */
export function generateGeoQuestions(
  seed: GeoQuestionSeed,
): readonly GeneratedGeoQuestion[] {
  const category = clean(seed.category) || "tools";
  const buyer = clean(seed.buyer) || "small teams";
  const rivals = seed.rivals.map((rival) => clean(rival)).filter(Boolean);
  const rivalList =
    rivals.length >= 2
      ? `${rivals[0]} and ${rivals[1]}`
      : (rivals[0] ?? "the established options");

  const drafts: ReadonlyArray<Omit<GeneratedGeoQuestion, "questionId">> = [
    {
      stage: "discovery",
      question: `What are the best ${category} tools for ${buyer}?`,
    },
    {
      stage: "discovery",
      question: `How do ${buyer} usually handle ${category}?`,
    },
    {
      stage: "comparison",
      question: `Best alternatives to ${rivalList} for ${category}`,
    },
    {
      stage: "comparison",
      question: `Which ${category} tool is easiest for ${buyer} to start with?`,
    },
    {
      stage: "evaluation",
      question: `Is ${category} software worth paying for as ${buyer}?`,
    },
    {
      stage: "evaluation",
      question: `What should ${buyer} look for when choosing ${category} software?`,
    },
    {
      stage: "decision",
      question: `Which ${category} tool do people recommend most for ${buyer}?`,
    },
    {
      stage: "decision",
      question: `What is the most affordable ${category} tool for ${buyer}?`,
    },
  ];

  return drafts.slice(0, GEO_QUESTIONS_PER_RUN).map((draft, index) => ({
    questionId: `q-${index + 1}`,
    question: bounded(draft.question),
    stage: draft.stage,
  }));
}
