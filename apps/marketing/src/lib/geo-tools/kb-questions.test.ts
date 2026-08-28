import { describe, expect, it } from "vitest";

import { GEO_TEMPLATES } from "../agents/geo-template-registry.ts";
import { emptyGeoKbPayload, type GeoKbPayload } from "./kb-contract.ts";
import {
  buildGeoQuestionSet,
  geoQuestionSetCallCount,
  geoQuestionSetDigest,
} from "./kb-questions.ts";

function payload(overrides: Partial<GeoKbPayload> = {}): GeoKbPayload {
  return {
    ...emptyGeoKbPayload("https://acme-kb.test/"),
    officialName: "Acme",
    aliases: ["Acme Analytics"],
    categoryTerms: ["project management"],
    roles: [
      {
        id: "r1",
        label: "agency owners",
        segment: "5 to 20 person agencies",
        painPoints: ["missed deadlines"],
        decisionCriteria: ["price"],
        vocabulary: ["client work"],
      },
    ],
    competitors: [
      { domain: "linear.app", brandName: "Linear", confirmed: true },
    ],
    ...overrides,
  };
}

describe("determinism", () => {
  it("produces the same set twice, ids and order included", () => {
    const first = buildGeoQuestionSet(payload());
    const second = buildGeoQuestionSet(payload());
    expect(second).toEqual(first);
    expect(geoQuestionSetDigest(second)).toBe(geoQuestionSetDigest(first));
  });

  it("changes the digest when the knowledge base changes", () => {
    const base = geoQuestionSetDigest(buildGeoQuestionSet(payload()));
    const renamed = geoQuestionSetDigest(
      buildGeoQuestionSet(payload({ officialName: "Acme Two" })),
    );
    expect(renamed).not.toBe(base);
  });
});

describe("what the set is made of", () => {
  it("takes every calibrated question verbatim from the registry", () => {
    const set = buildGeoQuestionSet(payload());
    const templateIds = new Set(GEO_TEMPLATES.map((entry) => entry.templateId));
    for (const question of set.questions) {
      if (!question.calibrated) continue;
      expect(question.templateId).not.toBeNull();
      expect(templateIds.has(question.templateId!)).toBe(true);
    }
  });

  it("marks the two assembled branded questions as unmeasured", () => {
    const branded = buildGeoQuestionSet(payload()).questions.filter(
      (question) => question.layer === "branded",
    );
    expect(branded).toHaveLength(2);
    for (const question of branded) {
      // Nobody measured whether this wording searches, so it must never carry
      // a citation denominator.
      expect(question.calibrated).toBe(false);
      expect(question.mode).toBe("demand");
      expect(question.text).toContain("Acme");
    }
  });

  it("keeps retrieval and demand aligned with the registry's own modes", () => {
    for (const question of buildGeoQuestionSet(payload()).questions) {
      if (question.templateId === null) continue;
      const entry = GEO_TEMPLATES.find(
        (candidate) => candidate.templateId === question.templateId,
      );
      expect(entry).toBeDefined();
      expect(question.mode).toBe(
        entry!.mode === "retrieval_probe" ? "retrieval" : "demand",
      );
    }
  });
});

describe("what the knowledge base decides", () => {
  it("asks the buyer-shaped questions once per role", () => {
    const one = buildGeoQuestionSet(payload()).questions.length;
    const two = buildGeoQuestionSet(
      payload({
        roles: [
          payload().roles[0]!,
          { ...payload().roles[0]!, id: "r2", label: "in-house teams" },
        ],
      }),
    ).questions.length;
    // Picking one role and reporting its answer as everyone's is the failure
    // this avoids, so a second role has to add questions.
    expect(two).toBeGreaterThan(one);
  });

  it("never puts an unconfirmed competitor into a question", () => {
    const set = buildGeoQuestionSet(
      payload({
        competitors: [
          { domain: "linear.app", brandName: "Linear", confirmed: true },
          { domain: "notion.so", brandName: "Notion", confirmed: false },
        ],
      }),
    );
    const text = set.questions.map((question) => question.text).join(" ");
    expect(text).toContain("Linear");
    expect(text).not.toContain("Notion");
  });

  it("drops the comparison questions that need a rival when none is confirmed", () => {
    const withRival = buildGeoQuestionSet(payload()).questions.length;
    const withoutRival = buildGeoQuestionSet(
      payload({
        competitors: [
          { domain: "linear.app", brandName: "Linear", confirmed: false },
        ],
      }),
    ).questions.length;
    expect(withoutRival).toBeLessThan(withRival);
  });

  it("skips a template it cannot render rather than trimming a value to fit", () => {
    // A category long enough to break the placeholder ceiling drops those
    // templates. Trimming to fit is how a run pays for wording nobody measured.
    const long = buildGeoQuestionSet(
      payload({ categoryTerms: ["a".repeat(70)] }),
    );
    expect(long.questions.length).toBeLessThan(
      buildGeoQuestionSet(payload()).questions.length,
    );
    for (const question of long.questions) {
      expect(question.text).not.toContain("{");
    }
  });
});

describe("required entities", () => {
  it("asks for what a correct answer to that layer would name", () => {
    const set = buildGeoQuestionSet(payload());
    const branded = set.questions.find(
      (question) => question.layer === "branded",
    );
    expect(branded?.requiredEntities).toContain("Acme");

    const comparison = set.questions.find(
      (question) => question.layer === "comparison",
    );
    expect(comparison?.requiredEntities).toContain("project management");

    for (const question of set.questions) {
      expect(question.requiredEntities.length).toBeLessThanOrEqual(8);
    }
  });
});

describe("cost", () => {
  it("multiplies the set's own size, not a number from a design document", () => {
    const set = buildGeoQuestionSet(payload());
    expect(geoQuestionSetCallCount(set, 5)).toBe(set.questions.length * 5);
    expect(geoQuestionSetCallCount(set, 0)).toBe(0);
  });
});

describe("category words", () => {
  it("renders a subject into every question", () => {
    for (const question of buildGeoQuestionSet(payload()).questions) {
      // A category that stems to nothing produced "What are the top tools
      // right now?", which the calibration measured as never reaching the web.
      expect(question.text).not.toMatch(/\btop tools\b/);
      expect(question.text.length).toBeGreaterThan(10);
    }
  });

  it("uses the first category word, so the clearest one leads", () => {
    const set = buildGeoQuestionSet(
      payload({ categoryTerms: ["invoicing", "project management"] }),
    );
    expect(set.questions.some((question) => question.text.includes("invoicing"))).toBe(
      true,
    );
  });
});
