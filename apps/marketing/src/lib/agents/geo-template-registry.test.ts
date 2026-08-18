// @input  -- the frozen calibration record and hostile substitution values
// @output -- proof the wording authority cannot drift or ship unmeasured strings
// @pos    -- focused tests for the GEO template registry

import { describe, expect, it } from "vitest";

import { geoDomainHash } from "./geo-canonical.ts";
import {
  findGeoTemplate,
  GEO_CALIBRATION_SAMPLES_PER_SEED,
  GEO_CALIBRATION_SEED_COUNT,
  GEO_MEASURED_DEAD_RETRIEVAL_WORDINGS,
  GEO_PLACEHOLDER_MAX_LENGTH,
  GEO_TEMPLATE_TEXT_HASH_DOMAIN,
  GEO_TEMPLATES,
  isGeoTemplateEntryShippable,
  isGeoTemplateShippable,
  renderGeoTemplate,
  validateGeoPlaceholderValue,
  type GeoTemplateEntry,
} from "./geo-template-registry.ts";

const RETRIEVAL = GEO_TEMPLATES.filter(
  (entry) => entry.mode === "retrieval_probe",
);
const NATURAL = GEO_TEMPLATES.filter((entry) => entry.mode === "natural_demand");

describe("the registry as a record", () => {
  it("has a unique identity per entry", () => {
    const keys = GEO_TEMPLATES.map(
      (entry) => `${entry.templateId}@${entry.templateVersion}`,
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * The calibration lock.
   *
   * `textHash` is a literal in the registry and is recomputed here. Editing a
   * word, a comma or the clause order changes the digest and fails this test,
   * which is the whole point: the strings are calibrated values, and a silent
   * edit is a run that measures something nobody paid to measure.
   */
  it("pins every template text by digest", async () => {
    for (const entry of GEO_TEMPLATES) {
      await expect(
        geoDomainHash(GEO_TEMPLATE_TEXT_HASH_DOMAIN, entry.text),
      ).resolves.toBe(entry.textHash);
    }
  });

  it("declares exactly the placeholders its text uses", () => {
    for (const entry of GEO_TEMPLATES) {
      const used = [...entry.text.matchAll(/\{([a-zA-Z]+)\}/gu)].map(
        (match) => match[1],
      );

      expect(new Set(used)).toEqual(new Set(entry.placeholders));
      expect(entry.placeholders.length).toBe(new Set(entry.placeholders).size);
    }
  });

  it("records full calibration scope on every entry", () => {
    for (const entry of GEO_TEMPLATES) {
      // A boolean `measured` flag is not acceptable: measurement has a scope
      // and it goes stale, so every entry carries the model, the endpoint, the
      // search configuration, the market and the seeds it was measured with.
      expect(entry.modelPinned).toBe("gpt-5-2025-08-07");
      expect(entry.providerEndpoint).toContain("dataforseo.com");
      expect(entry.webSearchRequested).toBe(true);
      expect(entry.maxOutputTokensRequested).toBe(4_096);
      expect(entry.queryLanguageTag).toBe("en");
      expect(entry.calibrationMarket).toBe("US");
      expect(entry.calibratedOn).toBe("2026-08-17");
      expect(entry.seeds.length).toBeGreaterThan(0);
      for (const seed of entry.seeds) {
        expect(seed.samples).toBeGreaterThan(0);
        expect(seed.searchedSamples).toBeLessThanOrEqual(seed.samples);
        expect(seed.renderedQuestion.length).toBeGreaterThan(0);
      }
    }
  });

  it("records the registered trigger clause inside the sentence it describes", () => {
    for (const entry of GEO_TEMPLATES) {
      if (entry.retrievalTriggerClause === null) continue;

      expect(entry.mode).toBe("retrieval_probe");
      expect(entry.text).toContain(entry.retrievalTriggerClause);
    }
  });

  it("keeps every grandfathered claim backed by an all-searched seed", () => {
    for (const entry of RETRIEVAL) {
      expect(entry.grandfathered).toBe(true);
      expect(
        entry.seeds.some(
          (seed) => seed.samples >= 3 && seed.searchedSamples === seed.samples,
        ),
      ).toBe(true);
    }
  });

  it("keeps every natural-demand claim backed by an all-unsearched seed", () => {
    for (const entry of NATURAL) {
      expect(entry.expectation).toBe("no_web_search_expected");
      expect(
        entry.seeds.some((seed) => seed.samples >= 3 && seed.searchedSamples === 0),
      ).toBe(true);
    }
  });

  it("names the cross-category limitation it actually has", () => {
    // The same eight questions regenerated for "pet insurance" stopped
    // searching on three of them, and which three was never recorded. That is a
    // real limit on what the word "measured" buys here, so every entry says so.
    for (const entry of GEO_TEMPLATES) {
      expect(entry.limitations).toContain("software_category_only");
    }
  });
});

describe("isGeoTemplateShippable", () => {
  it("admits every registered retrieval template for retrieval use", () => {
    for (const entry of RETRIEVAL) {
      expect(
        isGeoTemplateShippable(
          entry.templateId,
          entry.templateVersion,
          "retrieval_probe",
        ),
      ).toBe(true);
    }
  });

  it("refuses a template used in the wrong mode", () => {
    const retrieval = RETRIEVAL[0]!;
    const natural = NATURAL[0]!;

    expect(
      isGeoTemplateShippable(
        retrieval.templateId,
        retrieval.templateVersion,
        "natural_demand",
      ),
    ).toBe(false);
    expect(
      isGeoTemplateShippable(
        natural.templateId,
        natural.templateVersion,
        "retrieval_probe",
      ),
    ).toBe(false);
  });

  it("refuses an unknown id or an unknown version", () => {
    expect(isGeoTemplateShippable("nope", "1", "retrieval_probe")).toBe(false);
    expect(
      isGeoTemplateShippable(
        RETRIEVAL[0]!.templateId,
        "99",
        "retrieval_probe",
      ),
    ).toBe(false);
  });

  it.each(["failed", "stale", "unmeasured"] as const)(
    "refuses a %s calibration however good its seeds look",
    (status) => {
      const broken: GeoTemplateEntry = { ...RETRIEVAL[0]!, status };

      expect(isGeoTemplateEntryShippable(broken, "retrieval_probe")).toBe(false);
    },
  );

  it("refuses new retrieval wording that has not cleared the four-seed bar", () => {
    const fresh: GeoTemplateEntry = {
      ...RETRIEVAL[0]!,
      templateId: "geo.retrieval.brand_new",
      grandfathered: false,
      seeds: [RETRIEVAL[0]!.seeds[0]!],
    };

    expect(isGeoTemplateEntryShippable(fresh, "retrieval_probe")).toBe(false);
  });

  it("admits new retrieval wording that cleared four seeds at 3/3", () => {
    const seed = (label: string) => ({
      seedLabel: label,
      renderedQuestion: `rendered for ${label}`,
      samples: GEO_CALIBRATION_SAMPLES_PER_SEED,
      searchedSamples: GEO_CALIBRATION_SAMPLES_PER_SEED,
    });
    const measured: GeoTemplateEntry = {
      ...RETRIEVAL[0]!,
      templateId: "geo.retrieval.brand_new",
      grandfathered: false,
      seeds: [
        seed("short generic"),
        seed("multiword"),
        seed("acronym and hyphen"),
        seed("near the length bound"),
      ],
    };

    expect(measured.seeds.length).toBe(GEO_CALIBRATION_SEED_COUNT);
    expect(isGeoTemplateEntryShippable(measured, "retrieval_probe")).toBe(true);
  });

  it("refuses a four-seed candidate with one mixed seed", () => {
    // Any mixed seed fails the template for P0: a question whose samples
    // sometimes search and sometimes do not has no stable denominator.
    const seeds = Array.from({ length: 4 }, (_unused, index) => ({
      seedLabel: `seed ${index}`,
      renderedQuestion: `rendered ${index}`,
      samples: 3,
      searchedSamples: index === 2 ? 2 : 3,
    }));
    const mixed: GeoTemplateEntry = {
      ...RETRIEVAL[0]!,
      grandfathered: false,
      seeds,
    };

    expect(isGeoTemplateEntryShippable(mixed, "retrieval_probe")).toBe(false);
  });

  it("refuses a measured-dead wording even if it were registered as passed", () => {
    const dead: GeoTemplateEntry = {
      ...RETRIEVAL[0]!,
      text: GEO_MEASURED_DEAD_RETRIEVAL_WORDINGS[0]!,
    };

    expect(isGeoTemplateEntryShippable(dead, "retrieval_probe")).toBe(false);
  });

  it("keeps no retrieval template whose own text is on the dead list", () => {
    for (const entry of RETRIEVAL) {
      expect(GEO_MEASURED_DEAD_RETRIEVAL_WORDINGS).not.toContain(entry.text);
    }
  });

  it("lets natural demand deliberately use dead phrasings", () => {
    // This is what the mode is for. Three natural-demand seeds below are exact
    // strings from the dead list, and they are shippable precisely because the
    // registry records that they are expected not to search.
    const deliberate = NATURAL.filter((entry) =>
      entry.seeds.some((seed) =>
        GEO_MEASURED_DEAD_RETRIEVAL_WORDINGS.includes(seed.renderedQuestion),
      ),
    );

    expect(deliberate.length).toBeGreaterThanOrEqual(3);
    for (const entry of deliberate) {
      expect(
        isGeoTemplateShippable(
          entry.templateId,
          entry.templateVersion,
          "natural_demand",
        ),
      ).toBe(true);
    }
  });
});

describe("validateGeoPlaceholderValue", () => {
  it("accepts an ordinary bounded noun phrase", () => {
    expect(validateGeoPlaceholderValue("categoryStem", "AI visibility")).toBeNull();
  });

  it("keeps punctuation that belongs to a real name", () => {
    for (const name of ["U.S. tax software", "[24]7.ai", "C++ analytics"]) {
      expect(validateGeoPlaceholderValue("categoryStem", name)).toBeNull();
    }
  });

  it.each([
    ["", "empty"],
    ["  padded  ", "not_normalized"],
    ["line\nbreak", "not_normalized"],
    ["seo tools.", "sentence_punctuation"],
    ["is this seo?", "sentence_punctuation"],
    ["{categoryStem}", "template_syntax"],
    ["<script>", "markup"],
    ["a b c d e f g h i j k l m", "too_many_words"],
  ] as const)("refuses %j as %s", (value, reason) => {
    expect(validateGeoPlaceholderValue("categoryStem", value)).toBe(reason);
  });

  it("refuses a value longer than its own bound", () => {
    const limit = GEO_PLACEHOLDER_MAX_LENGTH.categoryStem;

    expect(
      validateGeoPlaceholderValue("categoryStem", "a".repeat(limit)),
    ).toBeNull();
    expect(
      validateGeoPlaceholderValue("categoryStem", "a".repeat(limit + 1)),
    ).toBe("too_long");
  });
});

describe("renderGeoTemplate", () => {
  it("renders the exact measured string for the calibration seed", () => {
    const entry = findGeoTemplate("geo.retrieval.category_top", "1")!;

    expect(renderGeoTemplate(entry, { categoryPlural: "seo tools" })).toEqual({
      ok: true,
      text: "What are the top seo tools right now?",
    });
  });

  it("renders the measured two-rival wording", () => {
    const entry = findGeoTemplate("geo.retrieval.alternatives", "1")!;

    expect(
      renderGeoTemplate(entry, {
        rivalList: "semrush and ahrefs",
        categoryStem: "seo",
      }),
    ).toEqual({ ok: true, text: "Best alternatives to semrush and ahrefs for seo" });
  });

  it("refuses to render with a missing value rather than leaving a placeholder", () => {
    const entry = findGeoTemplate("geo.retrieval.alternatives", "1")!;

    expect(renderGeoTemplate(entry, { categoryStem: "seo" })).toEqual({
      ok: false,
      placeholder: "rivalList",
      reason: "missing",
    });
  });

  it("refuses to render an invalid value rather than repairing it", () => {
    const entry = findGeoTemplate("geo.retrieval.category_top", "1")!;

    expect(renderGeoTemplate(entry, { categoryPlural: "seo tools." })).toEqual({
      ok: false,
      placeholder: "categoryPlural",
      reason: "sentence_punctuation",
    });
  });

  it("never leaves an unsubstituted placeholder in a successful render", () => {
    for (const entry of GEO_TEMPLATES) {
      const values = Object.fromEntries(
        entry.placeholders.map((placeholder) => [placeholder, "acme"]),
      );
      const result = renderGeoTemplate(entry, values);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.text).not.toMatch(/\{[a-zA-Z]+\}/u);
    }
  });
});
