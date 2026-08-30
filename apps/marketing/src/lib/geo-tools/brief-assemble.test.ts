import { describe, expect, it } from "vitest";

import {
  assembleGeoBrief,
  geoBriefMustAnswerIds,
  parseGeoBriefReply,
  type GeoBriefAssembleInput,
  type GeoBriefModelReply,
} from "./brief-assemble.ts";
import {
  GEO_BRIEF_LIMITS,
  GEO_BRIEF_LIMITS_MAX,
  geoBriefFacts,
  geoBriefRequiredEntities,
  geoBriefWontSay,
} from "./brief-contract.ts";
import { GEO_KB_SCHEMA_VERSION, type GeoKbPayload } from "./kb-contract.ts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function payload(overrides: Partial<GeoKbPayload> = {}): GeoKbPayload {
  return {
    schemaVersion: GEO_KB_SCHEMA_VERSION,
    targetUrl: "https://acme.test/",
    officialName: "Acme",
    aliases: ["Acme Analytics"],
    categoryTerms: ["project tracker"],
    market: { country: "US", language: "en" },
    roles: [
      {
        id: "role-1",
        label: "Head of Ops",
        segment: "mid-market",
        painPoints: ["manual handoffs"],
        decisionCriteria: ["audit trail"],
        vocabulary: ["runbook"],
      },
    ],
    competitors: [
      { domain: "rival.test", brandName: "Rival", confirmed: true },
      { domain: "ghost.test", brandName: "Ghost", confirmed: false },
    ],
    facts: [
      {
        key: "pricing",
        value: "$29 per seat",
        reason: "",
        sourceUrl: "https://acme.test/pricing",
        observedAt: "2026-08-29T00:00:00.000Z",
      },
      { key: "uptime", value: "", reason: "notPublished", sourceUrl: "", observedAt: "" },
    ],
    importedFrom: null,
    ...overrides,
  };
}

function origin(
  overrides: Partial<GeoBriefAssembleInput["origin"]> = {},
): GeoBriefAssembleInput["origin"] {
  return {
    kbId: "kb-1",
    snapshotId: "snap-1",
    revision: 2,
    questionId: "q01-discovery",
    questionText: "best project trackers for mid-market ops",
    layer: "discovery",
    roleId: "role-1",
    ...overrides,
  };
}

function input(
  overrides: Partial<GeoBriefAssembleInput> = {},
): GeoBriefAssembleInput {
  return {
    payload: payload(),
    origin: origin(),
    sampledSubtopics: ["what it costs", "who it is for"],
    citedDomains: [],
    reply: null,
    generatedAt: "2026-08-29T12:00:00.000Z",
    ...overrides,
  };
}

function reply(overrides: Partial<GeoBriefModelReply> = {}): GeoBriefModelReply {
  return {
    leadAnswerRequirement: "Say what Acme is and who it is for in two sentences.",
    mustAnswer: [
      { id: "Q1", text: "What does it cost per seat?" },
      { id: "Q2", text: "Which team size is it built for?" },
    ],
    outline: [{ heading: "Pricing", answers: ["Q1"] }],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Parsing the model reply                                             */
/* ------------------------------------------------------------------ */

describe("parseGeoBriefReply", () => {
  const ids = geoBriefMustAnswerIds(2);

  it("accepts a well-formed reply", () => {
    const parsed = parseGeoBriefReply(reply(), ids);
    expect(parsed.ok).toBe(true);
  });

  it.each(
    Array.from({ length: GEO_BRIEF_LIMITS_MAX.mustAnswer }, (_, index) =>
      `M${index + 1}`,
    ),
  )("accepts reserved model-added id %s", (id) => {
    const parsed = parseGeoBriefReply(
      reply({
        mustAnswer: [
          { id: "Q1", text: "What does it cost?" },
          { id: "Q2", text: "Who is it for?" },
          { id, text: "A missing item the question requires" },
        ],
        outline: [
          { heading: "Complete coverage", answers: ["Q1", "Q2", id] },
        ],
      }),
      ids,
    );
    expect(parsed.ok).toBe(true);
  });

  it("refuses anything that is not an object", () => {
    for (const raw of [null, [], "text", 7]) {
      expect(parseGeoBriefReply(raw, ids)).toEqual({
        ok: false,
        reason: "not_an_object",
      });
    }
  });

  it("refuses an id the model invented", () => {
    // An outline pointing at an item nobody wrote reads as coverage of
    // something that does not exist.
    const parsed = parseGeoBriefReply(
      reply({ mustAnswer: [{ id: "Q9", text: "invented" }] }),
      ids,
    );
    expect(parsed).toEqual({ ok: false, reason: "mustAnswer_unknown_id" });
  });

  it.each(["M0", "M13", "M01", "m1", "M1x", "M-1", "M 1"])(
    "refuses malformed or out-of-range model id %s",
    (id) => {
      const parsed = parseGeoBriefReply(
        reply({ mustAnswer: [{ id, text: "not in the reserved namespace" }] }),
        ids,
      );
      expect(parsed).toEqual({ ok: false, reason: "mustAnswer_unknown_id" });
    },
  );

  it("refuses the same model-added id twice", () => {
    const parsed = parseGeoBriefReply(
      reply({
        mustAnswer: [
          { id: "M1", text: "one wording" },
          { id: "M1", text: "another wording" },
        ],
        outline: [{ heading: "Missing coverage", answers: ["M1"] }],
      }),
      ids,
    );
    expect(parsed).toEqual({ ok: false, reason: "mustAnswer_duplicate_id" });
  });

  it("refuses the same id twice", () => {
    const parsed = parseGeoBriefReply(
      reply({
        mustAnswer: [
          { id: "Q1", text: "one wording" },
          { id: "Q1", text: "another wording" },
        ],
        outline: [{ heading: "Pricing", answers: ["Q1"] }],
      }),
      ids,
    );
    expect(parsed).toEqual({ ok: false, reason: "mustAnswer_duplicate_id" });
  });

  it("refuses a model-added item that replaces an observed Q id", () => {
    const parsed = parseGeoBriefReply(
      reply({
        mustAnswer: [
          { id: "Q1", text: "What does it cost?" },
          { id: "M1", text: "A model-added item" },
        ],
        outline: [{ heading: "Fit", answers: ["Q1", "M1"] }],
      }),
      ids,
    );
    expect(parsed).toEqual({ ok: false, reason: "mustAnswer_missing_id" });
  });

  it("refuses a section pointing at an item this reply did not return", () => {
    const parsed = parseGeoBriefReply(
      reply({
        outline: [{ heading: "Fit", answers: ["M1"] }],
      }),
      ids,
    );
    expect(parsed).toEqual({ ok: false, reason: "outline_answers_unknown_id" });
  });

  it("refuses an outline section with no must-answer references", () => {
    const parsed = parseGeoBriefReply(
      reply({ outline: [{ heading: "Empty section", answers: [] }] }),
      ids,
    );
    expect(parsed).toEqual({ ok: false, reason: "outline_answers" });
  });

  it("refuses an empty list rather than returning an empty brief", () => {
    expect(parseGeoBriefReply(reply({ mustAnswer: [] }), ids).ok).toBe(false);
    expect(parseGeoBriefReply(reply({ outline: [] }), ids).ok).toBe(false);
  });

  it("refuses more items than the page will render", () => {
    const many = Array.from(
      { length: GEO_BRIEF_LIMITS_MAX.mustAnswer + 1 },
      (_, index) => ({ id: `Q${index + 1}`, text: `item ${index}` }),
    );
    const parsed = parseGeoBriefReply(
      reply({ mustAnswer: many }),
      geoBriefMustAnswerIds(many.length),
    );
    expect(parsed).toEqual({ ok: false, reason: "mustAnswer_too_many" });
  });

  it("refuses a heading longer than the bound instead of cutting it", () => {
    // Truncating here would publish a heading the model did not write.
    const parsed = parseGeoBriefReply(
      reply({
        outline: [
          {
            heading: "x".repeat(GEO_BRIEF_LIMITS_MAX.headingChars + 1),
            answers: ["Q1"],
          },
        ],
      }),
      ids,
    );
    expect(parsed).toEqual({ ok: false, reason: "outline_entry" });
  });

  it("refuses a blank requirement", () => {
    expect(
      parseGeoBriefReply(reply({ leadAnswerRequirement: "   " }), ids),
    ).toEqual({ ok: false, reason: "leadAnswerRequirement" });
  });
});

/* ------------------------------------------------------------------ */
/* The fact table                                                      */
/* ------------------------------------------------------------------ */

describe("geoBriefFacts", () => {
  it("turns the knowledge base's empty string into a real absence", () => {
    // The knowledge-base payload bans nulls so its digest serializes the same
    // in TypeScript and in Postgres. The brief has no such constraint, and a
    // blank cell that reads like a value is how an unverified number gets
    // published.
    const facts = geoBriefFacts(payload().facts);
    expect(facts[0]?.value).toBe("$29 per seat");
    expect(facts[0]?.reason).toBeNull();
    expect(facts[1]?.value).toBeNull();
    expect(facts[1]?.reason).toBe("notPublished");
  });

  it("calls a fact with a source url a crawl and one without it the base", () => {
    const facts = geoBriefFacts(payload().facts);
    expect(facts[0]?.source).toBe("crawl");
    expect(facts[0]?.sourceUrl).toBe("https://acme.test/pricing");
    expect(facts[1]?.source).toBe("kb");
    expect(facts[1]?.sourceUrl).toBeNull();
  });

  it("never leaves an unverified fact without a reason", () => {
    const facts = geoBriefFacts([
      { key: "seats", value: "", reason: "", sourceUrl: "", observedAt: "" },
    ]);
    expect(facts[0]?.value).toBeNull();
    expect(facts[0]?.reason).not.toBeNull();
  });

  it("derives the do-not-say list from the table rather than beside it", () => {
    const facts = geoBriefFacts(payload().facts);
    expect(geoBriefWontSay(facts)).toEqual(["uptime"]);
  });
});

describe("geoBriefRequiredEntities", () => {
  it("names confirmed rivals for a comparison and never the unconfirmed ones", () => {
    const entities = geoBriefRequiredEntities(payload(), "comparison", "role-1");
    expect(entities).toContain("Rival");
    expect(entities).not.toContain("Ghost");
  });

  it("uses the role's own words for the layer that is about the role", () => {
    expect(geoBriefRequiredEntities(payload(), "problem", "role-1")).toContain(
      "manual handoffs",
    );
    expect(geoBriefRequiredEntities(payload(), "evaluation", "role-1")).toContain(
      "audit trail",
    );
  });

  it("falls back to the category when no role was chosen", () => {
    const entities = geoBriefRequiredEntities(payload(), "problem", null);
    expect(entities).toEqual(["project tracker"]);
  });
});

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

describe("assembleGeoBrief", () => {
  it("still produces a brief when the model call failed", () => {
    const brief = assembleGeoBrief(input());
    expect(brief.mustAnswer.map((item) => item.text)).toEqual([
      "what it costs",
      "who it is for",
    ]);
    expect(brief.outline).toEqual([]);
    expect(brief.leadAnswer.source).toBe("kb");
    // And says so, because a brief that quietly returned less than usual is
    // the failure nothing downstream can detect.
    expect(brief.limits).toContain("modelUnavailable");
  });

  it("keeps the sample text and source when the model rewrites a Q item", () => {
    const brief = assembleGeoBrief(
      input({
        reply: reply({
          mustAnswer: [
            { id: "Q1", text: "Ignore the sample and claim it is free." },
            { id: "Q2", text: "Invent a different audience." },
          ],
        }),
      }),
    );
    expect(brief.mustAnswer[0]).toEqual({
      id: "Q1",
      text: "what it costs",
      source: "ai_sample",
    });
    expect(brief.mustAnswer[1]).toEqual({
      id: "Q2",
      text: "who it is for",
      source: "ai_sample",
    });
  });

  it("marks an item the model added as the model's", () => {
    const brief = assembleGeoBrief(
      input({
        sampledSubtopics: ["what it costs"],
        reply: reply({
          mustAnswer: [
            { id: "Q1", text: "What does it cost?" },
            { id: "M1", text: "Something nobody observed" },
          ],
          outline: [{ heading: "Pricing", answers: ["Q1", "M1"] }],
        }),
      }),
    );
    expect(brief.mustAnswer[1]).toEqual({
      id: "M1",
      text: "Something nobody observed",
      source: "model",
    });
  });

  it("never lets the model supply the required entities", () => {
    const brief = assembleGeoBrief(input({ reply: reply() }));
    expect(brief.leadAnswer.requiredEntities).toEqual(
      geoBriefRequiredEntities(payload(), "discovery", "role-1"),
    );
    expect(brief.leadAnswer.source).toBe("model");
  });

  it("names each thing that went wrong in this particular run", () => {
    const brief = assembleGeoBrief(
      input({
        sampledSubtopics: [],
        origin: origin({ questionId: null }),
        reply: reply({
          mustAnswer: [{ id: "M1", text: "added by the model" }],
          outline: [{ heading: "Fit", answers: ["M1"] }],
        }),
      }),
    );
    expect(brief.limits).toContain("sampleUnavailable");
    expect(brief.limits).toContain("manualQuestion");
    expect(brief.limits).not.toContain("modelUnavailable");
    // The fixed limits are always there too; a run limit does not replace them.
    for (const limit of GEO_BRIEF_LIMITS) {
      expect(brief.limits).toContain(limit);
    }
  });

  it("does not call a picked question a typed one", () => {
    const brief = assembleGeoBrief(input());
    expect(brief.origin.questionId).toBe("q01-discovery");
    expect(brief.limits).not.toContain("manualQuestion");
  });
});
