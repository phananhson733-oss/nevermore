// @input  -- product seeds, including empty and hostile ones
// @output -- proof the generated set is always confirmable and always payable
// @pos    -- focused tests for the GEO Agent's question generator

import { describe, expect, it } from "vitest";

import {
  buildGeoCoreQuerySet,
  confirmGeoQuerySet,
  editGeoQueryText,
  generateGeoQuestions,
} from "./geo-questions.ts";
import {
  confirmGeoContext,
  promptContainsTargetAlias,
  type GeoContextInputV1,
  type GeoContextSnapshotV1,
} from "./geo-context.ts";
// The gate a real run passes through, so an edit is checked against the thing
// that refuses it rather than against a second copy of the derivation.
import { validateGeoRunInput } from "./geo-run-handler.ts";
import {
  geoPlannedCallCount,
  isGeoQuerySetConfirmed,
  isGeoQuerySetV1,
  GEO_CORE_QUERY_COUNT,
  GEO_CORE_SLOTS,
  GEO_MAX_QUERY_TEXT_LENGTH,
  type GeoQuerySetV1,
} from "./geo-query-contract.ts";
import {
  isGeoTemplateShippable,
  GEO_MEASURED_DEAD_RETRIEVAL_WORDINGS,
} from "./geo-template-registry.ts";

const SEED = {
  category: "AI visibility tracking",
  buyer: "SaaS marketing teams",
  rivals: ["Profound", "Peec AI"],
};

describe("generateGeoQuestions", () => {
  it("produces exactly the run's question count with unique ids", () => {
    const questions = generateGeoQuestions(SEED);

    expect(questions).toHaveLength(GEO_CORE_QUERY_COUNT);
    expect(new Set(questions.map((q) => q.questionId)).size).toBe(
      GEO_CORE_QUERY_COUNT,
    );
    expect(new Set(questions.map((q) => q.question)).size).toBe(
      GEO_CORE_QUERY_COUNT,
    );
  });

  it("spans the whole buyer journey, not just discovery", () => {
    const stages = new Set(generateGeoQuestions(SEED).map((q) => q.stage));

    expect(stages).toEqual(
      new Set(["discovery", "comparison", "evaluation", "decision"]),
    );
  });

  it("names the rivals the buyer would recognise", () => {
    const questions = generateGeoQuestions(SEED);

    expect(questions.some((q) => q.question.includes("Profound"))).toBe(true);
  });

  it("still produces a usable set with no rivals", () => {
    const questions = generateGeoQuestions({ ...SEED, rivals: [] });

    expect(questions).toHaveLength(GEO_CORE_QUERY_COUNT);
    expect(questions.some((q) => q.question.includes("undefined"))).toBe(false);
    // A placeholder like "the established options" names nothing, so the model
    // has nothing to look up. The rival-free set uses its own measured wording.
    expect(questions.some((q) => q.question.includes("established"))).toBe(
      false,
    );
    expect(
      questions.filter((q) => q.stage === "comparison").length,
    ).toBeGreaterThan(0);
  });

  it("falls back to neutral wording rather than emitting a blank", () => {
    const questions = generateGeoQuestions({
      category: "   ",
      buyer: "",
      rivals: [],
    });

    for (const question of questions) {
      expect(question.question.length).toBeGreaterThan(10);
      expect(question.question).not.toContain("  ");
    }
  });

  it.each([
    ["a very long category", { ...SEED, category: "a".repeat(600) }],
    ["a very long buyer", { ...SEED, buyer: "b".repeat(600) }],
    ["a very long rival", { ...SEED, rivals: ["c".repeat(600)] }],
  ] as const)("keeps every question payable with %s", (_label, seed) => {
    for (const question of generateGeoQuestions(seed)) {
      // Over this bound the provider refuses the call after billing for it.
      expect(question.question.length).toBeLessThanOrEqual(
        GEO_MAX_QUERY_TEXT_LENGTH,
      );
      expect(question.question.trim()).toBe(question.question);
      expect(question.question.length).toBeGreaterThan(0);
    }
  });

  it("collapses newlines and padding a pasted value brings with it", () => {
    const questions = generateGeoQuestions({
      ...SEED,
      category: "  AI\n\nvisibility\ttracking  ",
    });

    expect(questions[0]!.question).toContain("AI visibility tracking");
    expect(questions[0]!.question).not.toContain("\n");
  });

  it("is deterministic", () => {
    expect(generateGeoQuestions(SEED)).toEqual(generateGeoQuestions(SEED));
  });

  /**
   * The wording is a calibrated value, so it is pinned rather than described.
   *
   * The first version of this generator shipped and returned nothing usable:
   * 21 of 24 samples came back with no web search, because the provider's
   * `web_search: true` permits a search rather than forcing one. Ninety-five
   * paid calls then separated the phrasings that reach the live web from the
   * ones that do not, and these strings are the survivors.
   *
   * A property test would not protect them. "What are the best seo tools for
   * ceo right now?" asks for something current, does not end on the buyer, and
   * measured 0/3; every loose rule that admits the winners admits it too. So
   * the assertion is the exact set, and changing a word here is meant to fail
   * until somebody re-measures and updates both sides.
   */
  describe("pins the exact phrasings the calibration calls measured", () => {
    // The visitor's own failing inputs: two words carrying no specificity at
    // all, which is where a generic phrasing fails first.
    const FAILING_SEED = { category: "seo", buyer: "ceo", rivals: ["semrush"] };

    it("emits the measured rival-anchored set", () => {
      expect(generateGeoQuestions(FAILING_SEED).map((q) => q.question)).toEqual(
        [
          "What are the top seo tools right now?",
          "Which seo tools are getting the best reviews right now?",
          "Best alternatives to semrush for seo",
          "Which seo tools do people recommend instead of semrush right now?",
          "What should ceo look for when choosing seo software, and which tools currently do it best?",
          "Which seo tools are worth paying for right now?",
          "Which seo tool should ceo pick, and what do current reviews say?",
          "Which seo tool has the best free plan right now?",
        ],
      );
    });

    it("emits the measured rival-free set", () => {
      expect(
        generateGeoQuestions({ ...FAILING_SEED, rivals: [] }).map(
          (q) => q.question,
        ),
      ).toEqual([
        "What are the top seo tools right now?",
        "Which seo tools are getting the best reviews right now?",
        "What are the leading seo tools right now, and how do they differ?",
        "Which seo tools are people switching to right now?",
        "What should ceo look for when choosing seo software, and which tools currently do it best?",
        "Which seo tools are worth paying for right now?",
        "Which seo tool should ceo pick, and what do current reviews say?",
        "Which seo tool has the best free plan right now?",
      ]);
    });

    /** Every one of these was measured and searched 0/3 or worse. */
    const MEASURED_DEAD = [
      "What are the best seo tools for ceo?",
      "What are the best seo tools for ceo right now?",
      "What are the best seo tools for ceo in 2026?",
      "How does semrush compare to other seo tools?",
      "Is paid seo software worth it right now, or are the free tools enough?",
      "Which seo tool is easiest for ceo to start with?",
      "Which seo tool are people recommending right now for ceo?",
      "How do ceo currently handle seo, and which tools do they use?",
    ];

    it.each([
      FAILING_SEED,
      { ...FAILING_SEED, rivals: [] },
      SEED,
      { ...SEED, rivals: [] },
    ])("emits none of the measured dead phrasings (%#)", (seed) => {
      const questions = generateGeoQuestions(seed).map((q) => q.question);
      for (const dead of MEASURED_DEAD) {
        expect(questions).not.toContain(dead);
      }
    });
  });

  describe("degenerate inputs still produce eight payable, distinct questions", () => {
    it.each([
      ["600-char category", { ...SEED, category: "seo ".repeat(200) }],
      ["600-char buyer", { ...SEED, buyer: "growth lead ".repeat(60) }],
      ["600-char rival", { ...SEED, rivals: ["c".repeat(600)] }],
      ["bare product noun", { ...SEED, category: "tools" }],
      ["software category", { ...SEED, category: "software" }],
      ["doubled product noun", { ...SEED, category: "SEO tools software" }],
      ["blank everything", { category: "  ", buyer: "", rivals: [] }],
      ["duplicate rivals", { ...SEED, rivals: ["Semrush", " semrush "] }],
    ] as const)("%s", (_label, seed) => {
      const questions = generateGeoQuestions(seed).map((q) => q.question);

      // A long category used to eat the trailing clause of five templates and
      // collapse them into one string: 24 billed calls on 4 distinct prompts,
      // none of them a phrasing that was ever measured.
      expect(new Set(questions).size).toBe(GEO_CORE_QUERY_COUNT);
      for (const question of questions) {
        expect(question.length).toBeLessThanOrEqual(GEO_MAX_QUERY_TEXT_LENGTH);
        // Every template ends on the clause that makes it work, so a question
        // that lost its ending lost the calibration with it.
        expect(question).toMatch(
          /\b(right now\?|do they differ\?|do it best\?|reviews say\?|for [^?]+)$/iu,
        );
        expect(question).not.toMatch(
          /\b(tools tools|tool tool|software software|tools software)\b/iu,
        );
      }
    });

    it("names each deduped rival once in both comparison questions", () => {
      const questions = generateGeoQuestions({
        ...SEED,
        rivals: ["Semrush", " semrush ", "SEMRUSH"],
      });
      const comparison = questions
        .filter((q) => q.stage === "comparison")
        .map((q) => q.question);

      expect(comparison).toEqual([
        "Best alternatives to Semrush for AI visibility tracking",
        "Which AI visibility tracking tools do people recommend instead of Semrush right now?",
      ]);
    });

    it("uses the measured two-rival wording and says so honestly", () => {
      // Both of these were measured 3/3 with two names, so the run's claim to
      // be asking measured questions holds when the visitor lists rivals.
      const comparison = generateGeoQuestions({
        category: "seo",
        buyer: "ceo",
        rivals: ["semrush", "ahrefs", "moz", "spyfu"],
      })
        .filter((q) => q.stage === "comparison")
        .map((q) => q.question);

      expect(comparison).toEqual([
        "Best alternatives to semrush and ahrefs for seo",
        "Which seo tools do people recommend instead of semrush and ahrefs right now?",
      ]);
    });

    it("drops a trailing full stop that would otherwise double the noun", () => {
      expect(
        generateGeoQuestions({ ...SEED, category: "SEO tools." })[0]!.question,
      ).toBe("What are the top SEO tools right now?");
    });

    /**
     * Punctuation inside a name is not a sentence break.
     *
     * An earlier normalizer split on any full stop, question mark or
     * exclamation mark before a space, which quietly renamed every one of
     * these — asking about "U.S" tools and naming "Yahoo" as the competitor.
     */
    it.each([
      [
        "Node.js monitoring",
        "What are the top Node.js monitoring tools right now?",
      ],
      ["U.S. tax software", "What are the top U.S. tax tools right now?"],
      [
        "Yahoo! Japan analytics",
        "What are the top Yahoo! Japan analytics tools right now?",
      ],
    ] as const)(
      "keeps punctuation that belongs to %s",
      (category, expected) => {
        expect(generateGeoQuestions({ ...SEED, category })[0]!.question).toBe(
          expected,
        );
      },
    );

    it.each(["[24]7.ai", "C++ analytics", "Semrush"])(
      "names the competitor %s exactly as typed",
      (rival) => {
        expect(
          generateGeoQuestions({
            category: "seo",
            buyer: "ceo",
            rivals: [rival],
          })[2]!.question,
        ).toBe(`Best alternatives to ${rival} for seo`);
      },
    );
  });
});

describe("buildGeoCoreQuerySet", () => {
  const CLOCK = (): Date => new Date("2026-08-18T09:00:00.000Z");
  const LATER = (): Date => new Date("2026-08-18T10:00:00.000Z");

  const CONTEXT_INPUT: GeoContextInputV1 = {
    targetUrl: "https://acme.test/",
    productName: "Acme Analytics",
    brandAliases: [
      {
        alias: "Acme Analytics",
        source: "profile_product_name",
        confirmed: true,
      },
    ],
    category: "AI visibility tracking",
    categoryConfirmed: true,
    buyer: "SaaS marketing teams",
    user: "Growth leads",
    jtbd: "Know whether assistants cite the site.",
    useCases: ["Track assistant citations"],
    outcomes: ["Appear in assistant answers"],
    barriers: [],
    directCompetitors: ["Profound", "Peec AI"],
    indirectAlternatives: [],
    marketCode: "US",
    targetQueryLanguage: "en",
    sourceProfileVersion: "agent-profile.v3",
    sourceSummary: [
      { field: "category", source: "user_edit", limitationCode: null },
    ],
  };

  async function context(
    overrides: Partial<GeoContextInputV1> = {},
  ): Promise<GeoContextSnapshotV1> {
    const result = await confirmGeoContext(
      { ...CONTEXT_INPUT, ...overrides },
      CLOCK,
    );
    if (!result.ok) throw new Error(result.rejections.join(","));
    return result.snapshot;
  }

  async function build(
    overrides: Partial<GeoContextInputV1> = {},
    clock: () => Date = CLOCK,
  ): Promise<GeoQuerySetV1> {
    const result = await buildGeoCoreQuerySet(await context(overrides), clock);
    if (!result.ok) throw new Error(JSON.stringify(result.rejections));
    return result.querySet;
  }

  it("produces a contract-valid set of exactly eight core slots", async () => {
    const set = await build();

    expect(isGeoQuerySetV1(set)).toBe(true);
    expect(set.queries.map((query) => query.slot)).toEqual([...GEO_CORE_SLOTS]);
    expect(new Set(set.queries.map((query) => query.queryId)).size).toBe(8);
  });

  it("assigns the §2.2 modes and sampling, totalling eighteen calls", async () => {
    const set = await build();

    expect(
      set.queries.map((query) => [
        query.slot,
        query.mode,
        query.samplesPlanned,
      ]),
    ).toEqual([
      ["category_discovery", "retrieval_probe", 3],
      ["jtbd_outcome", "natural_demand", 1],
      ["pain_how_to", "natural_demand", 1],
      ["constraint_fit", "retrieval_probe", 3],
      ["alternative_status_quo", "retrieval_probe", 3],
      ["brand_comparison", "natural_demand", 1],
      ["due_diligence", "retrieval_probe", 3],
      ["negative_fit_objection", "retrieval_probe", 3],
    ]);
    expect(geoPlannedCallCount(set)).toBe(18);
  });

  /**
   * The retrieval wording is a calibrated value, so it is pinned rather than
   * described. Changing a word here is meant to fail until somebody re-measures
   * and updates both the registry digest and this assertion.
   */
  it("renders exactly the grandfathered measured retrieval strings", async () => {
    const set = await build({
      category: "seo",
      buyer: "ceo",
      directCompetitors: ["semrush"],
      productName: "Acme Analytics",
    });

    expect(
      set.queries
        .filter((query) => query.mode === "retrieval_probe")
        .map((query) => query.text),
    ).toEqual([
      "What are the top seo tools right now?",
      "Which seo tool has the best free plan right now?",
      "Best alternatives to semrush for seo",
      "Which seo tools are getting the best reviews right now?",
      "Which seo tools are worth paying for right now?",
    ]);
  });

  it("falls back to the measured rival-free phrasing when no rival is confirmed", async () => {
    const set = await build({
      category: "seo",
      buyer: "ceo",
      directCompetitors: [],
    });
    const alternative = set.queries.find(
      (query) => query.slot === "alternative_status_quo",
    )!;

    expect(alternative.text).toBe(
      "What are the leading seo tools right now, and how do they differ?",
    );
    expect(alternative.mode).toBe("retrieval_probe");
    expect(alternative.templateId).toBe("geo.retrieval.leading_differ");
  });

  it("uses the measured two-rival wording when two rivals are confirmed", async () => {
    const set = await build({
      category: "seo",
      buyer: "ceo",
      directCompetitors: ["semrush", "ahrefs", "moz"],
    });

    expect(
      set.queries.find((query) => query.slot === "alternative_status_quo")!
        .text,
    ).toBe("Best alternatives to semrush and ahrefs for seo");
  });

  it("never renders a measured-dead phrasing as a retrieval probe", async () => {
    const set = await build({
      category: "seo",
      buyer: "ceo",
      directCompetitors: ["semrush"],
    });

    for (const query of set.queries) {
      if (query.mode !== "retrieval_probe") continue;
      expect(GEO_MEASURED_DEAD_RETRIEVAL_WORDINGS).not.toContain(query.text);
    }
  });

  it("does use measured-dead phrasings deliberately as natural demand", async () => {
    // That is what the mode exists for: these are the questions a buyer types,
    // and the calibration says they will answer from memory rather than search.
    const set = await build({
      category: "seo",
      buyer: "ceo",
      directCompetitors: ["semrush"],
    });
    const natural = set.queries
      .filter((query) => query.mode === "natural_demand")
      .map((query) => query.text);

    expect(natural).toContain("What are the best seo tools for ceo?");
    expect(natural).toContain(
      "How do ceo currently handle seo, and which tools do they use?",
    );
  });

  it("links every retrieval probe to a shippable registry entry", async () => {
    const set = await build();

    for (const query of set.queries) {
      if (query.mode !== "retrieval_probe") continue;
      expect(query.templateId).not.toBeNull();
      expect(
        isGeoTemplateShippable(
          query.templateId!,
          query.templateVersion!,
          "retrieval_probe",
        ),
      ).toBe(true);
    }
  });

  it("anchors every time-sensitive question and only those", async () => {
    const set = await build();

    for (const query of set.queries) {
      if (query.timeSensitive) {
        expect(query.asOf).toBe("2026-08-18T09:00:00.000Z");
      } else {
        expect(query.asOf).toBeNull();
      }
    }
    expect(set.queries.some((query) => query.timeSensitive)).toBe(true);
    expect(set.queries.some((query) => !query.timeSensitive)).toBe(true);
  });

  /**
   * The plan's revision-2 slot table and its "five unbranded, three brand or
   * mixed" line do not agree; the table is the newer statement and it is what
   * the generator implements. Asserted here as the honest count so the
   * difference is a recorded decision rather than a silent drift.
   */
  it("puts the customer's own name in exactly one prompt", async () => {
    const snapshot = await context();
    const set = await buildGeoCoreQuerySet(snapshot, CLOCK);
    if (!set.ok) throw new Error("expected a set");

    const prompted = set.querySet.queries.filter((query) =>
      promptContainsTargetAlias(query.text, snapshot.brandAliases),
    );

    expect(prompted).toHaveLength(1);
    expect(prompted[0]!.slot).toBe("brand_comparison");
    expect(prompted[0]!.brandStance).toBe("brand");
  });

  it("derives brand stance from the text, agreeing with the alias matcher", async () => {
    const snapshot = await context();
    const built = await buildGeoCoreQuerySet(snapshot, CLOCK);
    if (!built.ok) throw new Error("expected a set");

    for (const query of built.querySet.queries) {
      const namesTarget = promptContainsTargetAlias(
        query.text,
        snapshot.brandAliases,
      );
      if (query.brandStance === "brand") expect(namesTarget).toBe(true);
      if (query.brandStance === "unbranded") expect(namesTarget).toBe(false);
    }
    expect(
      built.querySet.queries.filter((query) => query.brandStance === "mixed"),
    ).toHaveLength(1);
    expect(
      built.querySet.queries.filter(
        (query) => query.brandStance === "unbranded",
      ),
    ).toHaveLength(6);
  });

  it("records the registered trigger clause only where the registry has one", async () => {
    const set = await build();

    for (const query of set.queries) {
      const clause = query.retrievalTriggerClause;
      if (clause === null) continue;
      expect(query.mode).toBe("retrieval_probe");
      expect(query.text).toContain(clause);
    }
  });

  it("is deterministic for the same context and clock", async () => {
    const first = await build();
    const second = await build();

    expect(first).toEqual(second);
  });

  it("changes the fingerprint when the confirmed context changes", async () => {
    const first = await build();
    const second = await build({ category: "AI visibility monitoring" });

    expect(second.querySetContentHash).not.toBe(first.querySetContentHash);
  });

  it("refuses to generate for a non-English target query language", async () => {
    const snapshot = await context();
    const result = await buildGeoCoreQuerySet(
      { ...snapshot, targetQueryLanguage: "zh" as "en" },
      CLOCK,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejections).toEqual([
        { code: "query_language_unsupported" },
      ]);
    }
  });

  it("refuses rather than trimming a category that will not fit a template", async () => {
    const result = await buildGeoCoreQuerySet(
      await context({ category: "a b c d e f g h i j k l" }),
      CLOCK,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejections[0]!.code).toBe("placeholder_rejected");
    }
  });

  it("starts unconfirmed and therefore not runnable", async () => {
    const set = await build();

    expect(set.confirmedAt).toBeNull();
    expect(set.queries.every((query) => !query.userConfirmed)).toBe(true);
    expect(isGeoQuerySetConfirmed(set)).toBe(false);
  });

  it("becomes runnable only after explicit confirmation", async () => {
    const confirmed = await confirmGeoQuerySet(await build(), LATER);

    expect(isGeoQuerySetConfirmed(confirmed)).toBe(true);
    expect(confirmed.confirmedAt).toBe("2026-08-18T10:00:00.000Z");
  });
});

describe("editGeoQueryText", () => {
  const CLOCK = (): Date => new Date("2026-08-18T09:00:00.000Z");

  async function context(): Promise<GeoContextSnapshotV1> {
    const snapshot = await confirmGeoContext(
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
        category: "seo",
        categoryConfirmed: true,
        buyer: "ceo",
        user: "",
        jtbd: "",
        useCases: [],
        outcomes: [],
        barriers: [],
        directCompetitors: ["semrush"],
        indirectAlternatives: [],
        marketCode: "US",
        targetQueryLanguage: "en",
        sourceProfileVersion: "agent-profile.v3",
        sourceSummary: [
          { field: "category", source: "user_edit", limitationCode: null },
        ],
      },
      CLOCK,
    );
    if (!snapshot.ok) throw new Error(snapshot.rejections.join(","));
    return snapshot.snapshot;
  }

  async function set(): Promise<GeoQuerySetV1> {
    const built = await buildGeoCoreQuerySet(await context(), CLOCK);
    if (!built.ok) throw new Error("expected a set");
    return built.querySet;
  }

  it("demotes an edited retrieval probe out of measured status", async () => {
    const original = await set();
    const probe = original.queries.find(
      (query) => query.mode === "retrieval_probe",
    )!;
    const result = await editGeoQueryText(
      original,
      probe.queryId,
      "Which seo tools do enterprise teams trust?",
      await context(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const edited = result.querySet.queries.find(
      (query) => query.queryId === probe.queryId,
    )!;

    expect(edited.source).toBe("user_edit");
    expect(edited.mode).toBe("natural_demand");
    expect(edited.samplesPlanned).toBe(1);
    expect(edited.templateId).toBeNull();
    expect(edited.retrievalTriggerClause).toBeNull();
    expect(isGeoQuerySetV1(result.querySet)).toBe(true);
  });

  it("gives the edited set a new fingerprint and clears confirmation", async () => {
    const original = await confirmGeoQuerySet(await set(), CLOCK);
    const result = await editGeoQueryText(
      original,
      original.queries[0]!.queryId,
      "Which seo tools do enterprise teams trust?",
      await context(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.querySet.querySetContentHash).not.toBe(
      original.querySetContentHash,
    );
    expect(result.querySet.confirmedAt).toBeNull();
    expect(isGeoQuerySetConfirmed(result.querySet)).toBe(false);
  });

  it("refuses an unpayable edit rather than truncating it", async () => {
    const original = await set();
    const result = await editGeoQueryText(
      original,
      original.queries[0]!.queryId,
      "a".repeat(600),
      await context(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejections[0]!.code).toBe("question_not_payable");
    }
  });

  it("refuses an unknown query id", async () => {
    const result = await editGeoQueryText(
      await set(),
      "nope",
      "Anything?",
      await context(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejections).toEqual([
        { code: "unknown_query", queryId: "nope" },
      ]);
    }
  });

  /*
   * The stance travels with the text, because the server derives it again.
   *
   * `geo-run-handler` re-derives every question's brand stance from the text it
   * was sent and refuses the whole run when the client's label disagrees. An
   * edit that carried the old label forward therefore did not produce a
   * mislabelled run — it produced an unrunnable one, refused before billing with
   * an error the visitor could do nothing about.
   */
  it("re-derives the stance when an edit introduces the customer's own name", async () => {
    const snapshot = await context();
    const original = await set();
    const unbranded = original.queries.find(
      (query) => query.brandStance === "unbranded",
    )!;

    const result = await editGeoQueryText(
      original,
      unbranded.queryId,
      "Is Acme Analytics any good for seo?",
      snapshot,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const edited = result.querySet.queries.find(
      (query) => query.queryId === unbranded.queryId,
    )!;
    expect(edited.brandStance).toBe("brand");
  });

  it("re-derives the stance when an edit removes the customer's own name", async () => {
    const snapshot = await context();
    const original = await set();
    const branded = original.queries.find(
      (query) => query.brandStance === "brand",
    )!;

    const result = await editGeoQueryText(
      original,
      branded.queryId,
      "Which seo tools do enterprise teams trust?",
      snapshot,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const edited = result.querySet.queries.find(
      (query) => query.queryId === branded.queryId,
    )!;
    expect(edited.brandStance).toBe("unbranded");
  });

  it("re-derives the stance when an edit names a confirmed competitor", async () => {
    const snapshot = await context();
    const original = await set();
    const unbranded = original.queries.find(
      (query) => query.brandStance === "unbranded",
    )!;

    const result = await editGeoQueryText(
      original,
      unbranded.queryId,
      "Which seo tools are cheaper than semrush?",
      snapshot,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const edited = result.querySet.queries.find(
      (query) => query.queryId === unbranded.queryId,
    )!;
    expect(edited.brandStance).toBe("mixed");
  });

  /*
   * The real gate, not a second copy of the derivation.
   *
   * Comparing the edited stance against `deriveGeoBrandStance` here would only
   * prove that two callers of one function agree — it would pass even if the
   * server refused every one of these sets. `validateGeoRunInput` is what
   * actually stands between an edit and eighteen billed calls, so the edited
   * set is put in front of it. A stance the edit failed to re-derive comes back
   * as `geo_brand_stance_mismatch`, which is exactly what visitors hit.
   */
  it("produces a set the run handler accepts, whatever the edit did to the names", async () => {
    const snapshot = await context();
    const original = await set();

    for (const text of [
      "Is Acme Analytics any good for seo?",
      "Which seo tools are cheaper than semrush?",
      "How do teams pick between Acme Analytics and semrush?",
      "Which seo tools do enterprise teams trust?",
    ]) {
      const result = await editGeoQueryText(
        original,
        original.queries[0]!.queryId,
        text,
        snapshot,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const confirmed = await confirmGeoQuerySet(result.querySet, CLOCK);
      const validated = await validateGeoRunInput({
        context: snapshot,
        querySet: confirmed,
      });

      expect(
        validated.ok ? null : validated.code,
        `the handler refused an edit to "${text}"`,
      ).toBeNull();
    }
  });
});
