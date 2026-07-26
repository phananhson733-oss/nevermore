import { describe, expect, it } from "vitest";
import {
  ADVISORY_ONLY_DRAFT,
  ALL_FENCED_DRAFT,
  ATTRIBUTED_LINK_DRAFT,
  BODY_RESIDENT_REFERENCE_DRAFT,
  CLEAN_DRAFT,
  EMPHASIS_FORGED_HOST_DRAFT,
  ESCAPED_ATTRIBUTION_DRAFTS,
  FABRICATED_UNDERSCORE_SOURCE_DRAFT,
  FIRST_PARTY_EMPHASIS_CHAR_DRAFT,
  FIRST_PARTY_LINK_DRAFT,
  NAVIGATION_SECTION_DRAFTS,
  NEAR_MISS_HONEST_DRAFTS,
  PARENTHETICAL_CITATION_DRAFTS,
  PSEUDO_HEADING_PROSE_DRAFT,
  SAME_LINE_MIXED_CITATION_DRAFT,
  SAME_LINE_MIXED_CLAIM_DRAFT,
  SAME_LINE_SUPPORTED_CLAIMS_DRAFT,
  QUERY_STRING_HARVEST_DRAFT,
  REFERENCE_ENTRY_SHAPE_DRAFTS,
  REFERENCE_FORMAT_DRAFTS,
  REFERENCE_HEADING_DRAFTS,
  THEMATIC_BREAK_FRONTMATTER_DRAFT,
  UNCLOSED_FRONTMATTER_DRAFT,
  UNRECOGNISED_REFERENCE_DRAFTS,
  FENCED_CLAIM_DRAFT,
  NEGATED_CLAIM_DRAFT,
  PHANTOM_CITATION_DRAFT,
  PHANTOM_SOURCE_DRAFT,
  PHANTOM_SOURCE_LIST_DRAFT,
  PRODUCT_LINK_DRAFT,
  STRUCTURE_WEAK_DRAFT,
  UNSUPPORTED_CLAIM_DRAFT,
} from "./__fixtures__/drafts.ts";
import {
  FIXTURE_STATS,
  fixturePack,
  packWithCitableSources,
  qaInput,
} from "./__fixtures__/pack.ts";
import {
  BLOCKING_RULE_IDS,
  QA_BRIEF_OUTLINE_CLAIM_ID,
  QA_RULE_SEVERITY,
  claimIdForRule,
  clampVerdictToFailedClaims,
  evaluateDraftQa,
  evaluateQaRules,
  qaClaimsToJson,
} from "./index.ts";
import type { QaRuleId } from "./rule-types.ts";

function claim(markdown: string, ruleId: QaRuleId, pack = fixturePack()) {
  return evaluateDraftQa(qaInput(markdown, pack)).claims.find(
    (candidate) => candidate.claimId === claimIdForRule(ruleId),
  );
}

describe("P1 — an unsupported or fabricated claim is blocked", () => {
  it("blocks a research assertion carrying no attribution at all", () => {
    const evaluation = evaluateDraftQa(qaInput(UNSUPPORTED_CLAIM_DRAFT));

    expect(evaluation.verdict).toBe("blocked");
    expect(
      claim(UNSUPPORTED_CLAIM_DRAFT, "rl8_unsupported_claim"),
    ).toMatchObject({ status: "failed" });
  });

  /**
   * The sibling repository's ALLOW list accepted any four-digit year and any
   * capitalized `by <Name>`; "According to the 2024 Forrester Digital
   * Experience Report" satisfies BOTH and would have passed there. It must be
   * blocked here, because "Forrester" resolves to nothing in the frozen pack.
   */
  it("blocks a formally attributed claim whose source is not in the pack", () => {
    const evaluation = evaluateDraftQa(qaInput(PHANTOM_SOURCE_DRAFT));

    expect(evaluation.verdict).toBe("blocked");
    const rl8 = claim(PHANTOM_SOURCE_DRAFT, "rl8_unsupported_claim");
    expect(rl8?.status).toBe("failed");
    expect(rl8?.detail).toContain("authority D");
    expect(rl8?.detail).toContain("line 5");
  });

  it("blocks a Sources entry that resolves to nothing in the pack", () => {
    const evaluation = evaluateDraftQa(qaInput(PHANTOM_SOURCE_LIST_DRAFT));

    expect(evaluation.verdict).toBe("blocked");
    expect(
      claim(PHANTOM_SOURCE_LIST_DRAFT, "sc9b_sources_resolve_to_pack")?.status,
    ).toBe("failed");
  });

  it("blocks a citation-shaped external URL", () => {
    const evaluation = evaluateDraftQa(qaInput(PHANTOM_CITATION_DRAFT));

    expect(evaluation.verdict).toBe("blocked");
    expect(
      claim(PHANTOM_CITATION_DRAFT, "rl12_citation_integrity")?.status,
    ).toBe("failed");
  });

  it("resolves the same attribution when the pack really carries the source", () => {
    const pack = packWithCitableSources(["forrester.example"]);
    const evaluation = evaluateDraftQa(qaInput(PHANTOM_SOURCE_DRAFT, pack));

    // The attribution still names Forrester, but nothing in the pack matches
    // "Forrester", so the phantom stays blocked: the chain resolves identities,
    // not vibes.
    expect(evaluation.verdict).toBe("blocked");

    const resolved = evaluateDraftQa(
      qaInput(
        PHANTOM_SOURCE_DRAFT,
        packWithCitableSources(["Forrester Digital Experience Report"]),
      ),
    );
    expect(
      resolved.claims.find(
        (candidate) =>
          candidate.claimId === claimIdForRule("rl8_unsupported_claim"),
      )?.status,
    ).toBe("passed");
  });
});

describe("honest exemptions", () => {
  it("does not treat a negated sentence as an assertion", () => {
    expect(claim(NEGATED_CLAIM_DRAFT, "rl8_unsupported_claim")?.status).toBe(
      "passed",
    );
  });

  it("does not read claims out of fenced code", () => {
    expect(claim(FENCED_CLAIM_DRAFT, "rl8_unsupported_claim")?.status).toBe(
      "passed",
    );
  });

  it("does not block a plain product link that is not a citation", () => {
    const evaluation = evaluateDraftQa(qaInput(PRODUCT_LINK_DRAFT));

    expect(evaluation.verdict).not.toBe("blocked");
    expect(claim(PRODUCT_LINK_DRAFT, "rl12_citation_integrity")?.status).toBe(
      "passed",
    );
  });
});

describe("P2 — strict determinism", () => {
  it("returns a deeply equal evaluation for the same input", () => {
    const first = evaluateDraftQa(qaInput(PHANTOM_SOURCE_DRAFT));
    const second = evaluateDraftQa(qaInput(PHANTOM_SOURCE_DRAFT));

    expect(second).toStrictEqual(first);
    expect(JSON.stringify(qaClaimsToJson(second.claims))).toBe(
      JSON.stringify(qaClaimsToJson(first.claims)),
    );
  });

  it("emits claims in a stable rule order", () => {
    const ids = evaluateDraftQa(qaInput(CLEAN_DRAFT)).claims.map(
      (candidate) => candidate.claimId,
    );

    expect(ids).toStrictEqual(
      [...ids].filter((id, index, all) => all.indexOf(id) === index),
    );
    expect(ids[ids.length - 1]).toBe(QA_BRIEF_OUTLINE_CLAIM_ID);
  });
});

describe("P4 — advisory rules never gate", () => {
  it("keeps an advisory-only draft off `blocked`", () => {
    const evaluation = evaluateDraftQa(qaInput(ADVISORY_ONLY_DRAFT));

    expect(evaluation.verdict).not.toBe("blocked");
  });

  it("never reports a failed claim for an advisory rule", () => {
    const evaluation = evaluateDraftQa(qaInput(ADVISORY_ONLY_DRAFT));
    const advisoryFailures = evaluation.rules.filter(
      (rule) => QA_RULE_SEVERITY[rule.ruleId] === "advisory" && !rule.pass,
    );

    expect(advisoryFailures.length).toBeGreaterThan(0);
    for (const rule of advisoryFailures) {
      const persisted = evaluation.claims.find(
        (candidate) => candidate.claimId === claimIdForRule(rule.ruleId),
      );
      expect(persisted?.status).not.toBe("failed");
    }
  });
});

describe("P3 — citability never gates", () => {
  it("computes the verdict from rules alone", () => {
    const evaluation = evaluateDraftQa(qaInput(CLEAN_DRAFT));

    expect(evaluation.citability.score).toBeGreaterThanOrEqual(0);
    expect(evaluateQaRules(evaluation.rules)).toBe(
      clampVerdictToFailedClaims(evaluation.verdict, []),
    );
  });
});

describe("P6 — fail to human, never fail open", () => {
  it("reviews an empty draft instead of passing it", () => {
    const evaluation = evaluateDraftQa(qaInput(""));

    expect(evaluation.verdict).toBe("needs_review");
    expect(evaluation.claims.some((c) => c.status === "unevaluated")).toBe(
      true,
    );
  });

  it("reviews a non-English draft with an explicit reason", () => {
    const evaluation = evaluateDraftQa(
      qaInput(CLEAN_DRAFT, fixturePack({ outputLocale: "zh-CN" })),
    );

    expect(evaluation.verdict).toBe("needs_review");
    expect(
      evaluation.rules.some(
        (rule) =>
          !rule.evaluable &&
          rule.detail.includes("locale not supported by deterministic"),
      ),
    ).toBe(true);
  });

  it("keeps a structurally weak but factually empty draft at needs_review", () => {
    expect(evaluateDraftQa(qaInput(STRUCTURE_WEAK_DRAFT)).verdict).toBe(
      "needs_review",
    );
  });
});

describe("verdict floor", () => {
  it("passes a clean draft", () => {
    expect(evaluateDraftQa(qaInput(CLEAN_DRAFT)).verdict).toBe("passed");
  });

  it("keeps the blocking set at exactly three rules", () => {
    expect([...BLOCKING_RULE_IDS].sort()).toStrictEqual([
      "rl12_citation_integrity",
      "rl8_unsupported_claim",
      "sc9b_sources_resolve_to_pack",
    ]);
  });

  /**
   * `clampVerdictToFailedClaims` was a no-op while the verdict was hard-coded to
   * `needs_review`. Now that a real judgement can return `passed`, it has to
   * still bite: a broken brief -> draft chain (decision O-4) may never read as a
   * clean pass even when every ported rule is green.
   */
  it("still clamps a would-be pass off a broken brief -> draft chain", () => {
    const evaluation = evaluateDraftQa(
      qaInput(
        CLEAN_DRAFT,
        fixturePack({
          outline: {
            briefSections: [],
            targetKeywords: [],
            pageAssignment: "unassigned",
          },
        }),
        { ...FIXTURE_STATS, briefSectionCount: 0, projectedSectionCount: 0 },
      ),
    );

    expect(
      evaluation.claims.find((c) => c.claimId === QA_BRIEF_OUTLINE_CLAIM_ID)
        ?.status,
    ).toBe("failed");
    expect(evaluation.verdict).toBe("needs_review");
    expect(clampVerdictToFailedClaims("passed", evaluation.claims)).toBe(
      "needs_review",
    );
  });
});

describe("P1 (regression) — the fabrication paths that returned `passed`", () => {
  it("blocks a fabricated reference list under every reference heading", () => {
    for (const [heading, draft] of REFERENCE_HEADING_DRAFTS) {
      const evaluation = evaluateDraftQa(qaInput(draft));

      expect(evaluation.verdict, heading).toBe("blocked");
      expect(
        claim(draft, "sc9b_sources_resolve_to_pack")?.status,
        heading,
      ).toBe("failed");
    }
  });

  /**
   * The whole anti-fabrication guarantee used to depend on whether the model
   * typed a hyphen: the identical bibliography was blocked as `- Forrester,
   * 2024` and passed as a plain paragraph, a table or a blockquote.
   */
  it("blocks the same reference in every markdown shape", () => {
    for (const [shape, draft] of REFERENCE_FORMAT_DRAFTS) {
      const evaluation = evaluateDraftQa(qaInput(draft));

      expect(evaluation.verdict, shape).toBe("blocked");
    }
  });

  /**
   * Every heading form and markdown shape that carried a fabricated
   * bibliography past the gate. They differ from a heading the recogniser DID
   * see by punctuation, a qualifier, a script or the markdown used — never by
   * meaning — and each returned `passed` with SC9b persisting the sentence that
   * no section of the draft was headed as a reference list.
   */
  it("blocks a fabricated reference list under every heading form", () => {
    for (const [shape, draft] of UNRECOGNISED_REFERENCE_DRAFTS) {
      const evaluation = evaluateDraftQa(qaInput(draft));

      expect(evaluation.verdict, shape).toBe("blocked");
      expect(claim(draft, "sc9b_sources_resolve_to_pack")?.status, shape).toBe(
        "failed",
      );
    }
  });

  /**
   * The backstop that makes the partition's conservative bias safe.
   *
   * `## Related links` deliberately STAYS in the body — under a B2B post it is
   * usually the customer's own pages, and claiming it would report every one of
   * them as an unresolvable reference. That decision is only defensible while
   * the body is genuinely scanned, and it was not: no rule could see a
   * bibliographic entry, so an unrecognised heading meant a silent pass.
   */
  it("blocks a bibliographic entry left in the body by an unclaimed heading", () => {
    const evaluation = evaluateDraftQa(qaInput(BODY_RESIDENT_REFERENCE_DRAFT));

    expect(evaluation.verdict).toBe("blocked");
    expect(
      claim(BODY_RESIDENT_REFERENCE_DRAFT, "rl12_citation_integrity")?.status,
    ).toBe("failed");
    // The reference list stayed in the body, so SC9b correctly has no subject —
    // and must not claim one.
    expect(
      claim(BODY_RESIDENT_REFERENCE_DRAFT, "sc9b_sources_resolve_to_pack")
        ?.status,
    ).toBe("passed");
  });

  /**
   * The attribution shapes that matched no rule at all. Two were downgraded to
   * `needs_review` and the footnote escaped to `passed`.
   */
  it("blocks the attribution shapes that reached no rule", () => {
    for (const [shape, draft] of ESCAPED_ATTRIBUTION_DRAFTS) {
      expect(evaluateDraftQa(qaInput(draft)).verdict, shape).toBe("blocked");
    }
  });

  /** A domain laundered out of another url's query string. */
  it("blocks an assertion whose only resolvable token sits inside another url", () => {
    const evaluation = evaluateDraftQa(qaInput(QUERY_STRING_HARVEST_DRAFT));

    expect(evaluation.verdict).toBe("blocked");
    expect(
      claim(QUERY_STRING_HARVEST_DRAFT, "rl8_unsupported_claim")?.status,
    ).toBe("failed");
  });

  /**
   * The other half of the frontmatter defect: a leading thematic break with a
   * SECOND one further down masked the whole first content block, and the
   * all-lines-empty backstop never fired because the tail survived.
   */
  it("blocks a fabricated citation hidden between two thematic breaks", () => {
    const evaluation = evaluateDraftQa(
      qaInput(THEMATIC_BREAK_FRONTMATTER_DRAFT),
    );

    expect(evaluation.verdict).toBe("blocked");
    expect(
      claim(THEMATIC_BREAK_FRONTMATTER_DRAFT, "rl8_unsupported_claim")?.status,
    ).toBe("failed");
  });

  it("blocks a fabricated citation hidden behind an unclosed `---`", () => {
    const evaluation = evaluateDraftQa(qaInput(UNCLOSED_FRONTMATTER_DRAFT));

    expect(evaluation.verdict).toBe("blocked");
    expect(
      claim(UNCLOSED_FRONTMATTER_DRAFT, "rl8_unsupported_claim")?.status,
    ).toBe("failed");
  });

  /**
   * The backstop for "never fails open": whatever empties the prose, no rule
   * may report a pass over content it never read.
   */
  it("reports a draft with no readable prose as unevaluated, never as a pass", () => {
    const evaluation = evaluateDraftQa(qaInput(ALL_FENCED_DRAFT));

    expect(evaluation.verdict).toBe("needs_review");
    expect(evaluation.rules.every((rule) => !rule.evaluable)).toBe(true);
    expect(evaluation.rules[0]?.detail).toContain("nothing was judged");
  });
});

describe("B (regression) — honest drafts are not called fabrications", () => {
  /**
   * `report` / `source` / `research` are among the most common nouns in B2B
   * SaaS prose. Treating any of them as a citation cue blocked the customer's
   * own product link and told the reviewer it was an invented source.
   */
  it("does not block a first-party link on a line containing `report`", () => {
    const evaluation = evaluateDraftQa(qaInput(FIRST_PARTY_LINK_DRAFT));

    expect(evaluation.verdict).not.toBe("blocked");
    expect(
      claim(FIRST_PARTY_LINK_DRAFT, "rl12_citation_integrity")?.status,
    ).toBe("passed");
    expect(claim(FIRST_PARTY_LINK_DRAFT, "rl8_unsupported_claim")?.status).toBe(
      "passed",
    );
  });

  it("still blocks a link a sentence actually attributes a claim to", () => {
    expect(evaluateDraftQa(qaInput(ATTRIBUTED_LINK_DRAFT)).verdict).toBe(
      "blocked",
    );
  });

  /**
   * With an empty pack the gate knows one thing: it cannot confirm the
   * reference from our own records. Calling that "fabricated" is the gate
   * lying about its own evidence, and it is what trains operators to ignore
   * `blocked`.
   */
  it("says `unverifiable here`, not `invented`, while the pack is empty", () => {
    const detail =
      claim(ATTRIBUTED_LINK_DRAFT, "rl12_citation_integrity")?.detail ?? "";

    expect(detail).toContain("cannot be verified");
    expect(detail).toContain("not that they were invented");
  });

  /** A rule that did not look must never write down that there is nothing. */
  it("never states absence where it only states a scan", () => {
    const evaluation = evaluateDraftQa(qaInput(CLEAN_DRAFT));
    const rl8 = evaluation.claims.find(
      (candidate) =>
        candidate.claimId === claimIdForRule("rl8_unsupported_claim"),
    );
    const sc9b = evaluation.claims.find(
      (candidate) =>
        candidate.claimId === claimIdForRule("sc9b_sources_resolve_to_pack"),
    );

    expect(rl8?.detail).toContain("matched");
    expect(rl8?.detail).not.toContain("The draft makes no external-research");
    expect(sc9b?.detail).toContain("what it scanned");
    expect(sc9b?.detail).not.toContain("The draft lists no source entry");
  });

  /**
   * A pass detail may not describe coverage the rule does not have.
   *
   * RL8's read "the patterns catch research nouns, `according to` frames and
   * named-entity claims carrying a statistic" while `According to Forrester,
   * 73% …` and `According to Gartner, onboarding time fell 40%` both walked
   * through it — the sentence named two shapes it could not see. The patterns
   * were widened to cover them, and the detail now states the constraint that
   * remains (every named-entity shape needs a number) instead of implying
   * there is none.
   */
  it("describes only the coverage RL8 actually has", () => {
    const detail = claim(CLEAN_DRAFT, "rl8_unsupported_claim")?.detail ?? "";

    expect(detail).toContain("EVERY named-entity shape requires that number");
    for (const covered of [
      "According to Forrester, 73% of teams churn.",
      "According to Gartner, onboarding time fell 40%.",
      "Per Forrester, churn is 42%.",
    ]) {
      const draft = `# Onboarding analytics\n\n## Evidence\n\n${covered}\n`;
      expect(claim(draft, "rl8_unsupported_claim")?.status, covered).toBe(
        "failed",
      );
    }
    // And the limitation the detail claims is real: no statistic, not seen.
    expect(
      claim(
        "# Onboarding analytics\n\n## Evidence\n\nAccording to Forrester, teams churn faster.\n",
        "rl8_unsupported_claim",
      )?.status,
    ).toBe("passed");
  });
});

describe("P1 (regression) — the entry SHAPE, not the entry form", () => {
  /**
   * The rework this suite is the record of.
   *
   * The reference detector was a list of bibliographic forms, and the identical
   * fabricated entry escaped by dropping the year, moving it in front, changing
   * the punctuation, writing it as `'24`, or moving into a table cell or an
   * HTML list — nine spellings of one reference, one of them caught. Fixing
   * them one row at a time is what the previous three reworks did, and the row
   * next to the one that was fixed escaped every time.
   *
   * The assertion is `not passed` rather than `blocked` on purpose. Half of
   * these carry a name and NOTHING else, and "this reads like an outside
   * reference, confirm it" is everything the frozen inputs support for those.
   * Asserting `blocked` would be pinning down an overclaim.
   */
  it("never lets one reference reach `passed` by changing its spelling", () => {
    for (const [shape, draft] of REFERENCE_ENTRY_SHAPE_DRAFTS) {
      expect(evaluateDraftQa(qaInput(draft)).verdict, shape).not.toBe("passed");
    }
  });

  /**
   * The calibration, asserted rather than described: an entry that names
   * something and corroborates it is blocked; an entry that only names
   * something is reported as UNJUDGED. A gate that cannot tell those apart
   * either misses the first or slanders the second.
   */
  it("blocks a corroborated entry and only reviews a bare name", () => {
    const [, corroborated] =
      REFERENCE_ENTRY_SHAPE_DRAFTS.find(([shape]) =>
        shape.startsWith("comma and year with no heading"),
      ) ?? [];
    const [, bare] =
      REFERENCE_ENTRY_SHAPE_DRAFTS.find(([shape]) =>
        shape.startsWith("no year with no heading"),
      ) ?? [];

    expect(evaluateDraftQa(qaInput(corroborated ?? "")).verdict).toBe(
      "blocked",
    );
    expect(claim(corroborated ?? "", "rl12_citation_integrity")?.status).toBe(
      "failed",
    );

    const tentative = evaluateDraftQa(qaInput(bare ?? ""));
    expect(tentative.verdict).toBe("needs_review");
    // Never `failed`: the claim shape carries no confidence, so a reader would
    // take a `failed` blocking claim as "this draft contains a fabrication".
    expect(claim(bare ?? "", "rl12_citation_integrity")?.status).toBe(
      "unevaluated",
    );
    expect(claim(bare ?? "", "rl12_citation_integrity")?.detail).toContain(
      "could not judge",
    );
  });

  it("blocks an inline `(Author, Year)` citation", () => {
    for (const [sentence, draft] of PARENTHETICAL_CITATION_DRAFTS) {
      expect(evaluateDraftQa(qaInput(draft)).verdict, sentence).toBe("blocked");
    }
  });
});

describe("B (regression) — navigation is not evidence", () => {
  /**
   * `## Further reading`, `## See Also` and `## Related links` are one section
   * to a reader, and they came back blocked / blocked / passed. Two of them
   * carried the gate's strongest verdict over a B2B post's own internal links,
   * with a detail calling them unresolvable sources at authority D.
   *
   * A navigation heading offers DESTINATIONS. The customer's own address is a
   * complete answer to one — which is exactly the locator/evidence split RL12
   * already made for a bare URL in prose, applied where SC9b was missing it.
   */
  it("passes a navigation section listing the customer's own pages", () => {
    for (const [title, draft] of NAVIGATION_SECTION_DRAFTS) {
      const evaluation = evaluateDraftQa(qaInput(draft));

      expect(evaluation.verdict, title).toBe("passed");
      expect(claim(draft, "sc9b_sources_resolve_to_pack")?.status, title).toBe(
        "passed",
      );
    }
  });

  /**
   * The upward override, which is what keeps the split from being a hole: a
   * bibliography does not stop being a bibliography because the heading over it
   * says "Further reading".
   */
  it("still blocks a citation written under a navigation heading", () => {
    for (const [heading, draft] of REFERENCE_HEADING_DRAFTS) {
      expect(evaluateDraftQa(qaInput(draft)).verdict, heading).toBe("blocked");
    }
  });

  /**
   * The heading text had a guard; what followed it had none. `**Further
   * reading**` over two ordinary sentences reported both of them as reference
   * entries resolving to nothing at authority D.
   */
  it("does not let a heading turn prose into a reference list", () => {
    const evaluation = evaluateDraftQa(qaInput(PSEUDO_HEADING_PROSE_DRAFT));

    expect(evaluation.verdict).toBe("passed");
    expect(
      claim(PSEUDO_HEADING_PROSE_DRAFT, "sc9b_sources_resolve_to_pack")?.status,
    ).toBe("passed");
  });

  /**
   * The acceptance criterion Task 6b exists for, re-asserted against the shapes
   * that sit closest to the new predicates. A dated parenthetical is the same
   * shape as a citation and a metric table is the same shape as a bibliography
   * table; `passed` has to stay reachable by correct work.
   */
  it("keeps `passed` reachable for the honest near misses", () => {
    for (const [shape, draft] of NEAR_MISS_HONEST_DRAFTS) {
      expect(evaluateDraftQa(qaInput(draft)).verdict, shape).toBe("passed");
    }
  });
});

describe("D1 — a claim detail is always storable as jsonb", () => {
  /**
   * `truncateExcerpt` sliced UTF-16 code units, so an emoji straddling the
   * excerpt bound left a lone surrogate. `JSON.stringify` emits it as `\ud83d`
   * and Postgres `jsonb` REJECTS the value, so the gate insert threw on a run
   * whose verdict was perfectly good.
   */
  it("emits no unpaired surrogate when an emoji straddles the cut", () => {
    const draft = [
      "# Onboarding analytics",
      "",
      "## Sources",
      "",
      `- ${"Forrester Digital Experience Report on onboarding activation ".padEnd(118, "x")}🚀 trailing text after the cut`,
      "",
    ].join("\n");
    const serialized = JSON.stringify(
      qaClaimsToJson(evaluateDraftQa(qaInput(draft)).claims),
    );

    expect(serialized).not.toMatch(/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i);
    for (const unit of serialized) {
      const code = unit.codePointAt(0) ?? 0;
      expect(code < 0xd800 || code > 0xdfff).toBe(true);
    }
  });
});

/**
 * F1 (regression) — a fabrication sharing a line with a resolvable attribution.
 *
 * `findUnsupportedClaims` recorded ONE assertion per line, so RL8 saw only the
 * claim that resolved and reported that all of this draft's assertions resolve.
 * The identical fabricated sentence on its own line was blocked, which is the
 * proof that the line break, not the content, was doing the work.
 */
describe("P1 (regression) — a line carries more than one claim", () => {
  const packWithSource = () => packWithCitableSources(["Analyst Insights"]);

  it("blocks an invented attribution beside a resolvable one on the same line", () => {
    const pack = packWithSource();
    const evaluation = evaluateDraftQa(qaInput(SAME_LINE_MIXED_CLAIM_DRAFT, pack));

    expect(evaluation.verdict).toBe("blocked");
    expect(
      claim(SAME_LINE_MIXED_CLAIM_DRAFT, "rl8_unsupported_claim", pack)?.status,
    ).toBe("failed");
  });

  /** The control: the same shape, both attributions held by the pack. */
  it("does not block a line whose claims all resolve", () => {
    const pack = packWithSource();
    const evaluation = evaluateDraftQa(
      qaInput(SAME_LINE_SUPPORTED_CLAIMS_DRAFT, pack),
    );

    expect(evaluation.verdict).not.toBe("blocked");
    expect(
      claim(
        SAME_LINE_SUPPORTED_CLAIMS_DRAFT,
        "rl8_unsupported_claim",
        pack,
      )?.status,
    ).toBe("passed");
  });

  /**
   * RL12's half. A named attribution's SPAN was the raw 120-character capture,
   * so one resolvable name covered every later sentence on its line and a
   * citation two sentences downstream read as attributed to it.
   */
  it("blocks a citation two sentences away from the name that resolved", () => {
    const pack = packWithSource();
    const evaluation = evaluateDraftQa(
      qaInput(SAME_LINE_MIXED_CITATION_DRAFT, pack),
    );

    expect(evaluation.verdict).toBe("blocked");
    expect(
      claim(
        SAME_LINE_MIXED_CITATION_DRAFT,
        "rl12_citation_integrity",
        pack,
      )?.status,
    ).toBe("failed");
  });
});

/**
 * F2 (regression) — emphasis stripping rewrote addresses.
 *
 * `_` and `~` are typography in prose and characters in an address, and
 * deleting them from an address both made two extractors disagree about the
 * same url and let a host that is NOT the customer's flatten into one that is.
 */
describe("B (regression) — an address is not typography", () => {
  it("does not report a first-party address carrying `~` and `_`", () => {
    const evaluation = evaluateDraftQa(
      qaInput(FIRST_PARTY_EMPHASIS_CHAR_DRAFT),
    );

    expect(evaluation.verdict).not.toBe("blocked");
    expect(
      claim(FIRST_PARTY_EMPHASIS_CHAR_DRAFT, "rl12b_unresolved_link")?.status,
    ).toBe("passed");
    expect(
      claim(FIRST_PARTY_EMPHASIS_CHAR_DRAFT, "rl12_citation_integrity")?.status,
    ).toBe("passed");
  });

  it("reports a host that only becomes the customer's once `~` is deleted", () => {
    expect(
      claim(EMPHASIS_FORGED_HOST_DRAFT, "rl12b_unresolved_link")?.status,
    ).toBe("failed");
  });

  it("still blocks an invented outside reference whose address carries `_`", () => {
    const evaluation = evaluateDraftQa(
      qaInput(FABRICATED_UNDERSCORE_SOURCE_DRAFT),
    );

    expect(evaluation.verdict).toBe("blocked");
    expect(
      claim(FABRICATED_UNDERSCORE_SOURCE_DRAFT, "sc9b_sources_resolve_to_pack")
        ?.status,
    ).toBe("failed");
  });
});

/**
 * P2, re-proved over the drafts whose claim ARRAY the two fixes changed.
 *
 * `FlowShadowQaGatesRepository.insert` compares a replayed gate row against the
 * stored one, so a claim list that reordered or re-worded itself between two
 * runs of the same frozen input would turn replay into a spurious conflict.
 * Extracting every claim on a line changes what that array contains, so the
 * byte-for-byte guarantee is re-established here rather than assumed.
 */
describe("P2 — the changed claim arrays are byte-stable across replays", () => {
  it("serializes identically on 100 consecutive evaluations", () => {
    const pack = packWithCitableSources(["Analyst Insights"]);
    for (const [name, draft, source] of [
      ["same-line mixed claim", SAME_LINE_MIXED_CLAIM_DRAFT, pack],
      ["same-line supported", SAME_LINE_SUPPORTED_CLAIMS_DRAFT, pack],
      ["same-line mixed citation", SAME_LINE_MIXED_CITATION_DRAFT, pack],
      ["first-party `~`/`_` address", FIRST_PARTY_EMPHASIS_CHAR_DRAFT, undefined],
      ["forged host", EMPHASIS_FORGED_HOST_DRAFT, undefined],
      ["fabricated `_` source", FABRICATED_UNDERSCORE_SOURCE_DRAFT, undefined],
    ] as const) {
      const first = evaluateDraftQa(qaInput(draft, source ?? fixturePack()));
      const baseline = JSON.stringify(qaClaimsToJson(first.claims));
      for (let run = 0; run < 100; run += 1) {
        const replay = evaluateDraftQa(qaInput(draft, source ?? fixturePack()));
        expect(replay.verdict, name).toBe(first.verdict);
        expect(JSON.stringify(qaClaimsToJson(replay.claims)), name).toBe(
          baseline,
        );
      }
    }
  });
});
