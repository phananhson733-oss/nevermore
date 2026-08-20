// @input  -- the categories a visitor actually types, including the useless ones
// @output -- proof a category with nothing but a product noun never reaches a paid run
// @pos    -- focused tests for the leaf the confirm gate and the generator share

import { describe, expect, it } from "vitest";

import { confirmGeoContext } from "./geo-context.ts";
import {
  geoCategoryStem,
  hasGeoCategorySubject,
} from "./geo-category-stem.ts";
import { buildGeoCoreQuerySet } from "./geo-questions.ts";

const CLOCK = (): Date => new Date("2026-08-19T09:00:00.000Z");

async function confirm(category: string) {
  return confirmGeoContext(
    {
      targetUrl: "https://acme.test/",
      productName: "Acme Analytics",
      brandAliases: [
        {
          alias: "Acme Analytics",
          source: "profile_product_name",
          confirmed: true,
        },
      ],
      category,
      categoryConfirmed: true,
      buyer: "head of growth",
      user: "",
      jtbd: "",
      useCases: [],
      outcomes: [],
      barriers: [],
      directCompetitors: [],
      indirectAlternatives: [],
      marketCode: "US",
      targetQueryLanguage: "en",
      sourceProfileVersion: "geo-context.local.v1",
      sourceSummary: [
        { field: "category", source: "user_edit", limitationCode: null },
      ],
    },
    CLOCK,
  );
}

describe("geoCategoryStem", () => {
  it("removes the noun the template supplies itself", () => {
    expect(geoCategoryStem("SEO tools")).toBe("SEO");
    expect(geoCategoryStem("seo reporting software")).toBe("seo reporting");
    // Repeatedly: "SEO tools software" carries two.
    expect(geoCategoryStem("SEO tools software")).toBe("SEO");
  });

  it("leaves nothing when the visitor typed only a kind of product", () => {
    for (const noun of ["tools", "tool", "software", "platform", "apps"]) {
      expect(geoCategoryStem(noun), noun).toBe("");
      expect(hasGeoCategorySubject(noun), noun).toBe(false);
    }
  });

  it("keeps a category that only ends in a product noun by coincidence", () => {
    // The noun is stripped from the end, not from anywhere it appears.
    expect(geoCategoryStem("tools for warehouses")).toBe("tools for warehouses");
    expect(hasGeoCategorySubject("tools for warehouses")).toBe(true);
  });
});

describe("the confirm gate", () => {
  it("refuses a category that is nothing but a product noun", async () => {
    // Eighteen paid calls used to go out on "What are the top tools right
    // now?" — a question with no subject, and one no seed in the registry ever
    // measured. Found on 2026-08-19 while investigating a degraded run.
    //
    // Measured against the live provider the same day, same endpoint, model,
    // token ceiling and market the product sends, eight calls in total:
    //
    //   What are the top seo tools right now?          searched, 10 citations
    //   What are the top tools right now?              NOT searched, 0   (x3)
    //   Which tools are worth paying for right now?    NOT searched, 0
    //   Which tool has the best free plan right now?   NOT searched, 0
    //   What are the leading tools right now, ...      NOT searched, 0
    //
    // Five of five subject-less probes answered from memory. Every retrieval
    // sample then falls out of the citation denominator, the report shows a
    // degraded run, and the bill is still real — a call that does not search
    // costs about a fifth of one that does, not nothing.
    //
    // The same round refuted a second hypothesis: "Best alternatives to
    // Zyntherio for seo" — an unknown name in the one retrieval probe with no
    // currency cue — searched, and returned seven citations. An unfamiliar name
    // makes the model search more, not less.
    for (const noun of ["tools", "software", "platform"]) {
      const result = await confirm(noun);
      expect(result.ok, noun).toBe(false);
      if (result.ok) continue;
      expect(result.rejections, noun).toContain("category_has_no_subject");
    }
  });

  it("accepts a category that names a field", async () => {
    for (const category of ["seo reporting", "AI visibility tracking", "SEO tools"]) {
      const result = await confirm(category);
      expect(result.ok, category).toBe(true);
    }
  });

  it("never lets a subject-less question reach the query set", async () => {
    // The generator's fallback still exists as a backstop. Nothing that clears
    // the gate can reach it, which is the property worth holding.
    const confirmed = await confirm("seo reporting");
    if (!confirmed.ok) throw new Error("fixture");
    const built = await buildGeoCoreQuerySet(confirmed.snapshot, CLOCK);
    if (!built.ok) throw new Error("fixture query set");

    for (const query of built.querySet.queries) {
      expect(query.text, query.queryId).not.toContain("the top tools right now");
      expect(query.text, query.queryId).toContain("seo reporting");
    }
  });
});
