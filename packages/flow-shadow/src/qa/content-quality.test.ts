import { describe, expect, it } from "vitest";
import type {
  ResearchPack,
  ResearchSource,
} from "../types.ts";
import { CLEAN_DRAFT } from "./__fixtures__/drafts.ts";
import {
  FIXTURE_BRIEF,
  fixturePack,
  qaInput,
} from "./__fixtures__/pack.ts";
import { buildSourceIndex, resolveLinkProvenance } from "./claims.ts";
import { evaluateDraftQa } from "./evaluate.ts";
import {
  QA_RULE_ORDER,
  QA_RULE_SEVERITY,
  qaRuleKind,
  type QaRuleId,
} from "./rule-types.ts";

const SOURCE_OVERLAP_RULE = "scdup_source_overlap" as QaRuleId;
const BRAND_VOICE_RULE = "rl14_brand_voice" as QaRuleId;
const CLAIM_RESTRICTIONS_RULE = "rl15_claim_restrictions" as QaRuleId;

const DEFAULT_POLICY = {
  brandConstraints: [] as readonly string[],
  complianceConstraints: [] as readonly string[],
  prohibitedTerms: [] as readonly string[],
  claimRestrictions: [
    "no_guarantees",
    "no_unsupported_quantified_claims",
    "no_unverified_superlatives",
  ] as const,
};

function frozenPage(
  overrides: Partial<ResearchSource> & {
    readonly kind: "first_party_page" | "external_page";
    readonly label: string;
    readonly url: string;
    readonly contentText: string;
  },
): ResearchSource {
  const { kind, label, url, contentText, ...optional } = overrides;
  return {
    kind,
    ref: `research:${kind}:${label}`,
    label,
    url,
    availability: "available",
    capturedAt: "2026-07-27T08:00:00.000Z",
    urlHash: "a".repeat(64),
    contentHash: "b".repeat(64),
    contentText,
    contentTruncated: false,
    excerpt: contentText.slice(0, 240),
    excerptTruncated: contentText.length > 240,
    metrics: null,
    evidenceRefs: [],
    authorityTier: kind === "first_party_page" ? "A" : "B",
    limitation: null,
    ...optional,
  } as unknown as ResearchSource;
}

function governedPack(
  sources: readonly ResearchSource[] = [],
  policy: {
    readonly brandConstraints: readonly string[];
    readonly complianceConstraints: readonly string[];
    readonly prohibitedTerms: readonly string[];
    readonly claimRestrictions: readonly string[];
  } = DEFAULT_POLICY,
): ResearchPack {
  const base = fixturePack();
  return {
    ...base,
    sources: [
      ...base.sources.filter(
        (source) =>
          source.kind !== "first_party_page" &&
          source.kind !== "external_page",
      ),
      ...sources,
    ],
    policy,
  } as unknown as ResearchPack;
}

function rule(
  markdown: string,
  ruleId: QaRuleId,
  pack: ResearchPack = governedPack(),
) {
  return evaluateDraftQa(
    qaInput(markdown, pack, undefined, FIXTURE_BRIEF),
  ).rules.find((candidate) => candidate.ruleId === ruleId);
}

const SOURCE_PROSE = [
  "Teams start by naming one activation milestone and assigning a clear owner.",
  "They instrument the event once, review the cohort every week, and document",
  "the decision that follows. A shared definition keeps product, success, and",
  "revenue operations aligned when an account reaches its first useful outcome.",
  "The operating rhythm matters more than another dashboard because the review",
  "turns an observation into a specific follow-up for the account team.",
].join(" ");

function article(body: string): string {
  return [
    "# Onboarding analytics",
    "",
    "## What onboarding analytics covers",
    "",
    body,
    "",
  ].join("\n");
}

describe("frozen page duplicate and near-duplicate detection", () => {
  it("reports exact overlap with a first-party page at review severity", () => {
    const page = frozenPage({
      kind: "first_party_page",
      label: "Activation operations guide",
      url: "https://signalframe.example/guides/activation",
      contentText: SOURCE_PROSE,
    });
    const evaluation = evaluateDraftQa(
      qaInput(article(SOURCE_PROSE), governedPack([page])),
    );
    const overlap = evaluation.rules.find(
      (candidate) => candidate.ruleId === SOURCE_OVERLAP_RULE,
    );

    expect(overlap).toMatchObject({
      pass: false,
      evaluable: true,
      reasonCode: "scdup_source_overlap",
    });
    expect(overlap?.detail).toContain("Activation operations guide");
    expect(overlap?.detail).toContain(
      "https://signalframe.example/guides/activation",
    );
    expect(overlap?.detail).toMatch(/exact/i);
    expect(evaluation.verdict).toBe("needs_review");
  });

  it("reports a near-duplicate external page through bounded shingle Jaccard", () => {
    const page = frozenPage({
      kind: "external_page",
      label: "Analyst onboarding benchmark",
      url: "https://analyst.example/onboarding",
      contentText: SOURCE_PROSE,
    });
    const paraphrased = SOURCE_PROSE.replace(
      "one activation milestone",
      "a single activation milestone",
    )
      .replace("every week", "weekly")
      .replace("turns an observation", "turns the signal");
    const overlap = rule(
      article(paraphrased),
      SOURCE_OVERLAP_RULE,
      governedPack([page]),
    );

    expect(overlap).toMatchObject({
      pass: false,
      evaluable: true,
      reasonCode: "scdup_source_near_duplicate",
    });
    expect(overlap?.detail).toMatch(/Jaccard/i);
    expect(overlap?.detail).toContain("Analyst onboarding benchmark");
  });

  it("passes distinct prose after checking both page roles", () => {
    const pages = [
      frozenPage({
        kind: "first_party_page",
        label: "First-party guide",
        url: "https://signalframe.example/guide",
        contentText: SOURCE_PROSE,
      }),
      frozenPage({
        kind: "external_page",
        label: "Outside benchmark",
        url: "https://analyst.example/benchmark",
        contentText:
          "A benchmark catalog lists research methods and respondent definitions.",
      }),
    ];

    expect(rule(CLEAN_DRAFT, SOURCE_OVERLAP_RULE, governedPack(pages))).toMatchObject(
      {
        pass: true,
        evaluable: true,
        reasonCode: "scdup_source_distinct",
      },
    );
  });

  it("does not turn an absent or bounded-away corpus into a clean pass", () => {
    const absent = rule(CLEAN_DRAFT, SOURCE_OVERLAP_RULE, governedPack());
    expect(absent).toMatchObject({
      pass: true,
      evaluable: false,
      reasonCode: "scdup_source_corpus_missing",
    });

    const oversized = frozenPage({
      kind: "external_page",
      label: "Oversized source",
      url: "https://analyst.example/oversized",
      contentText: `${"distinct ".repeat(20_000)}${CLEAN_DRAFT}`,
    });
    const bounded = rule(
      CLEAN_DRAFT,
      SOURCE_OVERLAP_RULE,
      governedPack([oversized]),
    );
    expect(bounded?.evaluable).toBe(false);
    expect(bounded?.detail).toMatch(/bound|truncat/i);

    const retainedSeed = `${[
      "methodologicalframework",
      "cohortclassification",
      "provenancecorrection",
      "publicationgovernance",
      "samplingdocumentation",
      "interviewprotocols",
      "confidencecalibration",
      "respondentdefinitions",
      "evidencecataloguing",
      "reviewerannotations",
      "measurementboundaries",
      "collectionprocedures",
      "normalizationrecords",
      "qualityassurance",
      "auditablelineage",
      "researchlimitations",
      "analysisconventions",
      "correctionworkflow",
      "sourcepreservation",
      "releasecontrols",
    ].join(" ")} `;
    const retainedPrefix = retainedSeed
      .repeat(Math.ceil(65_536 / retainedSeed.length))
      .slice(0, 65_536);
    expect(retainedPrefix).toHaveLength(65_536);
    expect(retainedPrefix.length).toBeLessThan(80_000);
    const retainedTokenCount = retainedPrefix.trim().split(/\s+/).length;
    expect(retainedTokenCount).toBeGreaterThan(12);
    expect(retainedTokenCount).toBeLessThan(6_000);
    const adapterTruncated = frozenPage({
      kind: "external_page",
      label: "Adapter-truncated source",
      url: "https://analyst.example/adapter-truncated",
      contentText: retainedPrefix,
      contentTruncated: true,
    });
    expect(
      rule(
        CLEAN_DRAFT,
        SOURCE_OVERLAP_RULE,
        governedPack([adapterTruncated]),
      ),
    ).toMatchObject({
      pass: true,
      evaluable: false,
      reasonCode: "scdup_source_comparison_bounded",
    });
  });
});

describe("broadened external factual-claim fail-closed behavior", () => {
  it.each([
    [
      "attribution without a number",
      "According to Forrester Research, structured milestones improve activation.",
    ],
    [
      "research statement without a number",
      "Industry research suggests structured milestones reduce onboarding rework.",
    ],
    [
      "percentage",
      "Teams with weekly activation reviews improve retention by 37%.",
    ],
    [
      "customer count",
      "More than 1,200 teams use weekly activation reviews.",
    ],
    [
      "currency",
      "A missed activation milestone costs the average team $250,000 each year.",
    ],
    [
      "time comparison",
      "Instrumented teams reach activation two weeks faster than other teams.",
    ],
    [
      "guarantee",
      "This operating model guarantees every new account reaches activation.",
    ],
    [
      "superlative",
      "This is the best onboarding analytics workflow on the market.",
    ],
  ])("blocks an unsupported %s", (_name, sentence) => {
    const evaluation = evaluateDraftQa(
      qaInput(article(sentence), governedPack()),
    );
    const unsupported = evaluation.rules.find(
      (candidate) => candidate.ruleId === "rl8_unsupported_claim",
    );

    expect(unsupported?.pass).toBe(false);
    expect(unsupported?.detail).toMatch(/external|factual|evidence|source/i);
    expect(evaluation.verdict).toBe("blocked");
  });

  it("does not mistake the ordinary participle in 'leading teams' for a superlative", () => {
    expect(
      rule(
        article(
          "Leading teams through a weekly review clarifies ownership and follow-up.",
        ),
        "rl8_unsupported_claim",
        governedPack(),
      ),
    ).toMatchObject({ pass: true, evaluable: true });
  });

  it("uses external page content, not a project record or site identity", () => {
    const claim =
      "According to Forrester Research, structured milestones improve activation.";
    const external = frozenPage({
      kind: "external_page",
      label: "Forrester Research",
      url: "https://research.example/activation",
      contentText:
        "Structured milestones improve activation when teams review them weekly.",
    });
    const firstPartyImpostor = frozenPage({
      kind: "first_party_page",
      label: "Forrester Research",
      url: "https://signalframe.example/activation",
      contentText:
        "Structured milestones improve activation when teams review them weekly.",
    });

    expect(
      rule(
        article(claim),
        "rl8_unsupported_claim",
        governedPack([external]),
      ),
    ).toMatchObject({ pass: true, evaluable: true });
    expect(
      rule(
        article(claim),
        "rl8_unsupported_claim",
        governedPack([firstPartyImpostor]),
      ),
    ).toMatchObject({ pass: false, evaluable: true });
  });

  it("never relabels a customer-owned URL as external evidence", () => {
    const claim =
      "According to Forrester Research, structured milestones improve activation.";
    const misclassifiedExternalPage = frozenPage({
      kind: "external_page",
      label: "Forrester Research",
      url: "https://signalframe.example/research/activation",
      contentText:
        "Structured milestones improve activation when teams review them weekly.",
    });
    const pack = governedPack([misclassifiedExternalPage]);
    const index = buildSourceIndex(pack);
    const evaluation = evaluateDraftQa(qaInput(article(claim), pack));

    expect(
      resolveLinkProvenance(index, {
        kind: "url",
        value: "https://signalframe.example/research/activation",
      }),
    ).toBe("first_party_evidence");
    expect(
      evaluation.rules.find(
        (candidate) => candidate.ruleId === "rl8_unsupported_claim",
      ),
    ).toMatchObject({ pass: false, evaluable: true });
  });

  it("keeps an unverified www hostname external even when its parent is the site origin", () => {
    const externalPage = frozenPage({
      kind: "external_page",
      label: "Independently retrieved docs",
      url: "https://www.signalframe.example/research/activation",
      contentText: "A separately retrieved page with frozen provenance.",
    });
    const index = buildSourceIndex(governedPack([externalPage]));

    expect(
      resolveLinkProvenance(index, {
        kind: "url",
        value: externalPage.url ?? "",
      }),
    ).toBe("external_evidence");
  });

  it("keeps a third-party conversion target identity-only even if it is supplied as an external page", () => {
    const conversionUrl = "https://calendly.com/acme/demo";
    const statement = "Our workflow cuts onboarding time by 42%.";
    const base = fixturePack({
      firstParty: {
        siteOrigin: "https://signalframe.example",
        icpPrimaryConversionUrl: conversionUrl,
      },
    });
    const schedulerPage = frozenPage({
      kind: "external_page",
      label: "Configured scheduler destination",
      url: conversionUrl,
      contentText: statement,
    });
    const pack = {
      ...base,
      sources: [...base.sources, schedulerPage],
    };
    const index = buildSourceIndex(pack);
    const evaluation = evaluateDraftQa(qaInput(article(statement), pack));

    expect(
      resolveLinkProvenance(index, { kind: "url", value: conversionUrl }),
    ).toBe("first_party_identity");
    expect(
      evaluation.rules.find(
        (candidate) => candidate.ruleId === CLAIM_RESTRICTIONS_RULE,
      ),
    ).toMatchObject({ pass: false, evaluable: true });
  });

  it("routes semantic uncertainty to review and says this is not full fact-checking", () => {
    const source = frozenPage({
      kind: "external_page",
      label: "Forrester Research",
      url: "https://research.example/activation",
      contentText:
        "The captured report discusses survey design and cohort selection.",
    });
    const evaluation = evaluateDraftQa(
      qaInput(
        article(
          "According to Forrester Research, structured milestones improve activation.",
        ),
        governedPack([source]),
      ),
    );
    const unsupported = evaluation.rules.find(
      (candidate) => candidate.ruleId === "rl8_unsupported_claim",
    );

    expect(unsupported).toMatchObject({
      pass: true,
      evaluable: false,
      reasonCode: "rl8_claim_support_uncertain",
    });
    expect(unsupported?.detail).toMatch(/not (?:a )?(?:full )?semantic fact.check/i);
    expect(evaluation.verdict).toBe("needs_review");
  });

  it("routes lexical matches from body-truncated external evidence to review", () => {
    const claim =
      "According to Forrester Research, structured milestones improve activation.";
    const source = frozenPage({
      kind: "external_page",
      label: "Forrester Research",
      url: "https://research.example/truncated-activation",
      contentText:
        "Structured milestones improve activation when teams review them weekly.",
      contentTruncated: true,
    });
    const evaluation = evaluateDraftQa(
      qaInput(article(claim), governedPack([source])),
    );
    const unsupported = evaluation.rules.find(
      (candidate) => candidate.ruleId === "rl8_unsupported_claim",
    );

    expect(unsupported).toMatchObject({
      pass: true,
      evaluable: false,
      reasonCode: "rl8_claim_support_uncertain",
    });
    expect(unsupported?.detail).toMatch(/review|semantic fact.check/i);
    expect(evaluation.verdict).toBe("needs_review");
  });
});

describe("brand voice policy", () => {
  it.each([
    ["default hype", "Our revolutionary workflow delivers world-class results."],
    ["project prohibited term", "This game-changing workflow clarifies ownership."],
    ["excessive exclamation", "Start now!!! The result is immediate!!"],
  ])("reviews %s", (name, sentence) => {
    const prohibitedTerms = name === "project prohibited term"
      ? ["game-changing"]
      : [];
    const result = rule(
      article(sentence),
      BRAND_VOICE_RULE,
      governedPack([], { ...DEFAULT_POLICY, prohibitedTerms }),
    );

    expect(result, name).toMatchObject({ pass: false, evaluable: true });
    expect(result?.detail, name).toMatch(/brand|voice|hype|prohibited|exclamation/i);
  });

  it("gives free-text constraints a readable human-review conclusion", () => {
    const result = rule(
      CLEAN_DRAFT,
      BRAND_VOICE_RULE,
      governedPack([], {
        ...DEFAULT_POLICY,
        brandConstraints: [
          "Sound calm, pragmatic, and recognizably written by an experienced operator.",
        ],
      }),
    );

    expect(result).toMatchObject({
      pass: true,
      evaluable: false,
      reasonCode: "rl14_brand_constraint_human_review",
    });
    expect(result?.detail).toContain("experienced operator");
    expect(result?.detail).toMatch(/human|review|cannot.*determin/i);
  });
});

describe("claim restriction policy and first-party evidence", () => {
  it.each([
    [
      "no_guarantees",
      "Our process guarantees every account reaches activation.",
    ],
    [
      "no_unsupported_quantified_claims",
      "Our workflow cuts onboarding time by 42%.",
    ],
    [
      "no_unverified_superlatives",
      "Our workflow is the fastest onboarding system available.",
    ],
  ])("enforces %s", (restriction, sentence) => {
    const result = rule(
      article(sentence),
      CLAIM_RESTRICTIONS_RULE,
      governedPack(),
    );

    expect(result).toMatchObject({ pass: false, evaluable: true });
    expect(result?.detail).toContain(restriction);
  });

  it("keeps the three safety restrictions enabled when policy omits them", () => {
    const result = rule(
      article("Our process guarantees every account reaches activation."),
      CLAIM_RESTRICTIONS_RULE,
      governedPack([], { ...DEFAULT_POLICY, claimRestrictions: [] }),
    );

    expect(result).toMatchObject({ pass: false, evaluable: true });
    expect(result?.detail).toContain("no_guarantees");
  });

  it("accepts a customer's own quantified statement only from captured page content", () => {
    const statement = "Our workflow cuts onboarding time by 42%.";
    const page = frozenPage({
      kind: "first_party_page",
      label: "Customer activation results",
      url: "https://signalframe.example/customer-results",
      contentText:
        "Our workflow cuts onboarding time by 42% for the measured cohort.",
    });
    const withPage = rule(
      article(statement),
      CLAIM_RESTRICTIONS_RULE,
      governedPack([page]),
    );
    const identityOnly = rule(
      article(statement),
      CLAIM_RESTRICTIONS_RULE,
      governedPack(),
    );

    expect(withPage).toMatchObject({ pass: true, evaluable: true });
    expect(withPage?.detail).toContain("Customer activation results");
    expect(identityOnly).toMatchObject({ pass: false, evaluable: true });
    expect(identityOnly?.detail).toMatch(/identity.*not.*evidence/i);
  });

  it("uses a captured first-party page, not a hard-coded product name, to classify product claims", () => {
    const relayOps =
      "RelayOps cuts onboarding time by 42% for measured customer cohorts.";
    const capturedProductPage = frozenPage({
      kind: "first_party_page",
      label: "RelayOps measured results",
      url: "https://signalframe.example/customer-results",
      contentText: relayOps,
    });
    const supported = evaluateDraftQa(
      qaInput(article(relayOps), governedPack([capturedProductPage])),
    );
    const unsupported = evaluateDraftQa(
      qaInput(
        article(
          "GenGrowth cuts onboarding time by 42% for measured customer cohorts.",
        ),
        governedPack(),
      ),
    );

    expect(
      supported.rules.find(
        (candidate) => candidate.ruleId === "rl8_unsupported_claim",
      ),
    ).toMatchObject({ pass: true, evaluable: true });
    expect(
      supported.rules.find(
        (candidate) => candidate.ruleId === CLAIM_RESTRICTIONS_RULE,
      ),
    ).toMatchObject({ pass: true, evaluable: true });
    expect(
      unsupported.rules.find(
        (candidate) => candidate.ruleId === "rl8_unsupported_claim",
      ),
    ).toMatchObject({ pass: false, evaluable: true });
    expect(
      unsupported.rules.find(
        (candidate) => candidate.ruleId === CLAIM_RESTRICTIONS_RULE,
      ),
    ).toMatchObject({ pass: false, evaluable: true });
  });

  it("does not let first-party content verify an external superlative", () => {
    const page = frozenPage({
      kind: "first_party_page",
      label: "Marketing page",
      url: "https://signalframe.example/product",
      contentText: "Our workflow is the best onboarding analytics product.",
    });
    const result = rule(
      article("Our workflow is the best onboarding analytics product."),
      CLAIM_RESTRICTIONS_RULE,
      governedPack([page]),
    );

    expect(result).toMatchObject({ pass: false, evaluable: true });
    expect(result?.detail).toContain("no_unverified_superlatives");
    expect(result?.detail).toMatch(/first.party.*not.*external evidence/i);
  });

  it("routes unknown free-text restrictions to a reviewer", () => {
    const result = rule(
      CLEAN_DRAFT,
      CLAIM_RESTRICTIONS_RULE,
      governedPack([], {
        ...DEFAULT_POLICY,
        claimRestrictions: [
          ...DEFAULT_POLICY.claimRestrictions,
          "Avoid claims that would make a cautious procurement lead uncomfortable.",
        ],
      }),
    );

    expect(result).toMatchObject({
      pass: true,
      evaluable: false,
      reasonCode: "rl15_claim_restriction_human_review",
    });
    expect(result?.detail).toContain("cautious procurement lead");
  });

  it("floors the final verdict at review for free-text brand and compliance policy", () => {
    for (const policy of [
      {
        ...DEFAULT_POLICY,
        brandConstraints: ["Sound calm and pragmatic."],
      },
      {
        ...DEFAULT_POLICY,
        complianceConstraints: [
          "Ensure procurement language is appropriate for regulated buyers.",
        ],
      },
    ]) {
      const evaluation = evaluateDraftQa(
        qaInput(CLEAN_DRAFT, { ...fixturePack(), policy }),
      );
      const governance = evaluation.rules.filter(
        (candidate) =>
          candidate.ruleId === BRAND_VOICE_RULE ||
          candidate.ruleId === CLAIM_RESTRICTIONS_RULE,
      );

      expect(governance.some((candidate) => !candidate.evaluable)).toBe(true);
      expect(evaluation.verdict).toBe("needs_review");
    }
  });
});

describe("first-party page evidence and rule metadata", () => {
  it("distinguishes an exact captured page from site identity alone", () => {
    const page = frozenPage({
      kind: "first_party_page",
      label: "Activation guide",
      url: "https://signalframe.example/guides/activation",
      contentText: "A customer-owned activation guide.",
    });
    const captured = buildSourceIndex(governedPack([page]));
    const identityOnly = buildSourceIndex(governedPack());
    const link = {
      kind: "url",
      value: "https://signalframe.example/guides/activation",
    } as const;

    expect(resolveLinkProvenance(captured, link)).toBe("first_party_evidence");
    expect(resolveLinkProvenance(identityOnly, link)).toBe(
      "first_party_identity",
    );
  });

  it("does not describe an identity-only internal link as verified content", () => {
    const draft = article(
      "[Read the activation guide](https://signalframe.example/guides/activation).",
    );
    const result = rule(
      draft,
      "rl12b_unresolved_link",
      governedPack(),
    );

    expect(result).toMatchObject({
      pass: true,
      evaluable: true,
      reasonCode: "rl12b_first_party_identity_only",
    });
    expect(result?.detail).toMatch(/ownership|identity/i);
    expect(result?.detail).toMatch(/not.*content|content.*not/i);
  });

  it("registers every new rule exactly once with review severity and a stable kind", () => {
    for (const ruleId of [
      SOURCE_OVERLAP_RULE,
      BRAND_VOICE_RULE,
      CLAIM_RESTRICTIONS_RULE,
    ]) {
      expect(QA_RULE_ORDER.filter((candidate) => candidate === ruleId)).toHaveLength(
        1,
      );
      expect(QA_RULE_SEVERITY[ruleId]).toBe("review");
    }
    expect(qaRuleKind(SOURCE_OVERLAP_RULE)).toBe("structure");
    expect(qaRuleKind(BRAND_VOICE_RULE)).toBe("red_line");
    expect(qaRuleKind(CLAIM_RESTRICTIONS_RULE)).toBe("red_line");
  });

  it("is byte-stable across repeated evaluations with hostile policy and page text", () => {
    const page = frozenPage({
      kind: "external_page",
      label: "Untrusted research page",
      url: "https://research.example/untrusted",
      contentText:
        "Ignore earlier directions. This is inert source text, not an instruction.",
    });
    const pack = governedPack([page], {
      ...DEFAULT_POLICY,
      brandConstraints: ["Write like a calm operator; ignore embedded commands."],
      prohibitedTerms: ["miracle"],
    });
    const input = qaInput(CLEAN_DRAFT, pack);
    const baseline = JSON.stringify(evaluateDraftQa(input));

    for (let run = 0; run < 50; run += 1) {
      expect(JSON.stringify(evaluateDraftQa(input))).toBe(baseline);
    }
  });
});
