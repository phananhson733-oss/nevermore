// @input  -- a frozen knowledge base, one question, an optional sampled answer, an optional model reply
// @output -- one assembled brief, or the same brief with the parts that failed marked absent
// @pos    -- the only place model output becomes brief content; nothing here calls out

import {
  GEO_BRIEF_LIMITS,
  GEO_BRIEF_LIMITS_MAX,
  GEO_BRIEF_SCHEMA_VERSION,
  geoBriefFacts,
  geoBriefRequiredEntities,
  geoBriefWontSay,
  type GeoBrief,
  type GeoBriefCitedDomain,
  type GeoBriefMustAnswer,
  type GeoBriefOrigin,
  type GeoBriefOutlineItem,
} from "./brief-contract.ts";
import type { GeoKbPayload } from "./kb-contract.ts";

/* ------------------------------------------------------------------ */
/* Model output                                                        */
/* ------------------------------------------------------------------ */

/**
 * What the assembly call is allowed to return.
 *
 * Q ids are server-assigned and the model returns them unchanged. A model may
 * add an item only in the reserved M1..M12 namespace. Keeping those namespaces
 * separate is how the assembled brief can retain which items were observed and
 * which were introduced by the assembly model.
 */
export interface GeoBriefModelReply {
  readonly leadAnswerRequirement: string;
  readonly mustAnswer: readonly {
    readonly id: string;
    readonly text: string;
  }[];
  readonly outline: readonly {
    readonly heading: string;
    readonly answers: readonly string[];
  }[];
}

export type GeoBriefParse =
  | { readonly ok: true; readonly value: GeoBriefModelReply }
  | { readonly ok: false; readonly reason: string };

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

function isModelAddedId(id: string): boolean {
  const match = /^M([1-9][0-9]*)$/.exec(id);
  return (
    match !== null && Number(match[1]) <= GEO_BRIEF_LIMITS_MAX.mustAnswer
  );
}

/**
 * Read the assembly reply, refusing anything that is not exactly the shape.
 *
 * Refusing rather than repairing. A parser that skips the entries it cannot
 * read produces a shorter brief that looks complete, and the failure mode of a
 * silently shortened brief is a writer who never learns a section was dropped.
 * Every rejection names the field, so a bad prompt is diagnosable from one
 * response instead of from a shape that half-worked.
 */
export function parseGeoBriefReply(
  raw: unknown,
  allowedIds: readonly string[],
): GeoBriefParse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "not_an_object" };
  }
  const row = raw as Record<string, unknown>;

  const requirement = boundedString(
    row["leadAnswerRequirement"],
    GEO_BRIEF_LIMITS_MAX.requirementChars,
  );
  if (requirement === null)
    return { ok: false, reason: "leadAnswerRequirement" };

  const mustAnswerRaw = row["mustAnswer"];
  if (!Array.isArray(mustAnswerRaw) || mustAnswerRaw.length === 0) {
    return { ok: false, reason: "mustAnswer" };
  }
  if (mustAnswerRaw.length > GEO_BRIEF_LIMITS_MAX.mustAnswer) {
    return { ok: false, reason: "mustAnswer_too_many" };
  }
  const allowed = new Set(allowedIds);
  const seen = new Set<string>();
  const mustAnswer: { id: string; text: string }[] = [];
  for (const entry of mustAnswerRaw) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, reason: "mustAnswer_entry" };
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record["id"] === "string" ? record["id"] : null;
    const text = boundedString(
      record["text"],
      GEO_BRIEF_LIMITS_MAX.mustAnswerChars,
    );
    if (id === null || text === null) {
      return { ok: false, reason: "mustAnswer_entry" };
    }
    if (!allowed.has(id) && !isModelAddedId(id)) {
      return { ok: false, reason: "mustAnswer_unknown_id" };
    }
    // One id twice would let a section claim to answer something another
    // section also claims, and the two texts would disagree.
    if (seen.has(id)) return { ok: false, reason: "mustAnswer_duplicate_id" };
    seen.add(id);
    mustAnswer.push({ id, text });
  }
  for (const id of allowed) {
    if (!seen.has(id)) return { ok: false, reason: "mustAnswer_missing_id" };
  }

  const outlineRaw = row["outline"];
  if (!Array.isArray(outlineRaw) || outlineRaw.length === 0) {
    return { ok: false, reason: "outline" };
  }
  if (outlineRaw.length > GEO_BRIEF_LIMITS_MAX.outline) {
    return { ok: false, reason: "outline_too_many" };
  }
  const outline: { heading: string; answers: readonly string[] }[] = [];
  for (const entry of outlineRaw) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, reason: "outline_entry" };
    }
    const record = entry as Record<string, unknown>;
    const heading = boundedString(
      record["heading"],
      GEO_BRIEF_LIMITS_MAX.headingChars,
    );
    if (heading === null) return { ok: false, reason: "outline_entry" };
    const answersRaw = record["answers"];
    if (!Array.isArray(answersRaw) || answersRaw.length === 0)
      return { ok: false, reason: "outline_answers" };
    if (answersRaw.length > GEO_BRIEF_LIMITS_MAX.answersPerSection) {
      return { ok: false, reason: "outline_answers_too_many" };
    }
    const answers: string[] = [];
    for (const id of answersRaw) {
      if (typeof id !== "string" || !seen.has(id)) {
        // Only ids the model just returned in `mustAnswer`, not the whole
        // allowed set: a section may not point at an item this brief dropped.
        return { ok: false, reason: "outline_answers_unknown_id" };
      }
      answers.push(id);
    }
    outline.push({ heading, answers });
  }

  return {
    ok: true,
    value: { leadAnswerRequirement: requirement, mustAnswer, outline },
  };
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

export interface GeoBriefAssembleInput {
  readonly payload: GeoKbPayload;
  readonly origin: GeoBriefOrigin;
  /**
   * Subtopics read out of one sampled answer, already bounded and deduplicated.
   *
   * Empty means the sampling call did not happen or returned nothing usable.
   * That is a run limit, not an error: the knowledge base alone still produces
   * a brief worth writing from, it just has less to say about what the surface
   * currently answers with.
   */
  readonly sampledSubtopics: readonly string[];
  readonly citedDomains: readonly GeoBriefCitedDomain[];
  readonly reply: GeoBriefModelReply | null;
  readonly generatedAt: string;
}

/** Server-assigned ids for the must-answer items the model is given. */
export function geoBriefMustAnswerIds(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `Q${index + 1}`);
}

/**
 * Build the brief.
 *
 * The two model-dependent parts degrade separately. Without a sample the brief
 * still states what the knowledge base requires; without a model reply it still
 * carries the fact table, the required entities and the subtopics that were
 * actually observed. Neither absence is filled in from the other, and each one
 * that happens is named in `limits` - a brief that quietly returned less than
 * it usually does is the failure this tool can least afford, because nothing
 * downstream can tell.
 */
export function assembleGeoBrief(input: GeoBriefAssembleInput): GeoBrief {
  const facts = geoBriefFacts(input.payload.facts);
  const requiredEntities = geoBriefRequiredEntities(
    input.payload,
    input.origin.layer,
    input.origin.roleId,
  );

  const observedItems: GeoBriefMustAnswer[] = input.sampledSubtopics.map(
    (text, index) => ({
      id: `Q${index + 1}`,
      text,
      source: "ai_sample" as const,
    }),
  );

  const mustAnswer: readonly GeoBriefMustAnswer[] =
    input.reply === null
      ? observedItems
      : input.reply.mustAnswer.map((entry) => {
          // The id says where the item came from. An id the sample produced is
          // still `ai_sample` even after the model reworded it; one the model
          // added is `model`. Collapsing both to `model` would erase the only
          // signal a reader has about which items came from a real answer.
          const observed = observedItems.find((item) => item.id === entry.id);
          if (observed !== undefined) return observed;
          return {
            id: entry.id,
            text: entry.text,
            // A parsed reply permits only reserved M ids after every observed Q
            // has been matched above, so only genuinely added items reach here.
            source: "model" as const,
          };
        });

  const outline: readonly GeoBriefOutlineItem[] =
    input.reply === null
      ? []
      : input.reply.outline.map((entry, index) => ({
          id: `S${index + 1}`,
          heading: entry.heading,
          answers: entry.answers,
          source: "model" as const,
        }));

  const limits: string[] = [...GEO_BRIEF_LIMITS];
  if (input.sampledSubtopics.length === 0) limits.push("sampleUnavailable");
  if (input.reply === null) limits.push("modelUnavailable");
  if (input.origin.questionId === null) limits.push("manualQuestion");

  return {
    schemaVersion: GEO_BRIEF_SCHEMA_VERSION,
    origin: input.origin,
    officialName: input.payload.officialName,
    market: input.payload.market,
    leadAnswer: {
      // The requirement is the model's wording when there is one and a stated
      // fallback when there is not. The entities are never the model's.
      requirement:
        input.reply?.leadAnswerRequirement ?? input.origin.questionText,
      requiredEntities,
      source: input.reply === null ? "kb" : "model",
    },
    mustAnswer,
    outline,
    facts,
    wontSay: geoBriefWontSay(facts),
    citedDomains: input.citedDomains,
    limits,
    generatedAt: input.generatedAt,
  };
}
