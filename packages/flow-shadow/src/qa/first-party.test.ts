import { describe, expect, it } from "vitest";
import {
  FIRST_PARTY_BARE_URL_DRAFT,
  FIRST_PARTY_SOURCES_DRAFT,
  FIRST_PARTY_SUBDOMAIN_DRAFT,
  LOOKALIKE_HOST_DRAFT,
  OUTSIDE_LINK_DRAFT,
  SCAFFOLD_CTA_DRAFT,
} from "./__fixtures__/drafts.ts";
import {
  FIXTURE_FIRST_PARTY,
  fixturePack,
  qaInput,
} from "./__fixtures__/pack.ts";
import { buildSourceIndex } from "./claims.ts";
import { evaluateDraftQa } from "./evaluate.ts";
import { claimIdForRule, type QaRuleId } from "./rule-types.ts";

/**
 * Task 6b — the customer's own web identity is part of the frozen tuple.
 *
 * The defect this file pins down: with no first-party identity in the pack,
 * EVERY link in a draft resolved to nothing, RL12b failed at review severity,
 * and `passed` became reachable only by a draft that linked nowhere — including
 * a draft that correctly wrote the scaffold's own call to action. A gate whose
 * top verdict is unreachable by correct work has two usable values, not three.
 */

function claim(markdown: string, ruleId: QaRuleId, pack = fixturePack()) {
  return evaluateDraftQa(qaInput(markdown, pack)).claims.find(
    (candidate) => candidate.claimId === claimIdForRule(ruleId),
  );
}

describe("the reason this Task exists", () => {
  /** The acceptance criterion, stated as one assertion. */
  it("passes a clean draft that carries the scaffold's call-to-action link", () => {
    const evaluation = evaluateDraftQa(qaInput(SCAFFOLD_CTA_DRAFT));

    expect(evaluation.verdict).toBe("passed");
    // No claim may be `failed` under a `passed` verdict, and the only claims
    // left unevaluated are the two advisory link-density rules that are
    // explicitly deferred to Slice 3.
    expect(
      evaluation.claims.filter((candidate) => candidate.status === "failed"),
    ).toEqual([]);
    expect(
      evaluation.claims
        .filter((candidate) => candidate.status === "unevaluated")
        .map((candidate) => candidate.claimId),
    ).toEqual([
      "content-shadow.qa.sc2_internal_link_density",
      "content-shadow.qa.sc4_link_distribution",
    ]);
  });

  /**
   * The counterfactual. Without the frozen identity the identical draft cannot
   * do better than `needs_review`, which is the whole failure being repaired —
   * so it is asserted rather than described.
   */
  it("cannot reach `passed` when the project has no frozen first-party identity", () => {
    const evaluation = evaluateDraftQa(
      qaInput(
        SCAFFOLD_CTA_DRAFT,
        fixturePack({
          firstParty: {
            siteOrigin: "https://elsewhere.example",
            icpPrimaryConversionUrl: null,
          },
        }),
      ),
    );

    expect(evaluation.verdict).toBe("needs_review");
    expect(claim(SCAFFOLD_CTA_DRAFT, "rl12b_unresolved_link")).toBeDefined();
  });
});

describe("what counts as first-party", () => {
  it("resolves a link to the frozen site origin", () => {
    expect(claim(SCAFFOLD_CTA_DRAFT, "rl12b_unresolved_link")?.status).toBe(
      "passed",
    );
  });

  it("resolves a link to a subdomain of the frozen site origin", () => {
    const evaluation = evaluateDraftQa(qaInput(FIRST_PARTY_SUBDOMAIN_DRAFT));

    expect(evaluation.verdict).toBe("passed");
  });

  it("resolves a link to the frozen ICP conversion target on another host", () => {
    const draft = SCAFFOLD_CTA_DRAFT.replace(
      "https://signalframe.example/demo",
      FIXTURE_FIRST_PARTY.icpPrimaryConversionUrl ?? "",
    );

    expect(evaluateDraftQa(qaInput(draft)).verdict).toBe("passed");
  });

  /**
   * The suffix test is anchored on a leading dot on purpose. A host that merely
   * ends with the origin's text belongs to someone else.
   */
  it("does NOT resolve a look-alike host that only ends with the origin text", () => {
    expect(claim(LOOKALIKE_HOST_DRAFT, "rl12b_unresolved_link")?.status).toBe(
      "failed",
    );
    expect(evaluateDraftQa(qaInput(LOOKALIKE_HOST_DRAFT)).verdict).toBe(
      "needs_review",
    );
  });

  it("does NOT resolve a link that points outside the customer's property", () => {
    expect(claim(OUTSIDE_LINK_DRAFT, "rl12b_unresolved_link")?.status).toBe(
      "failed",
    );
  });
});

describe("the blocking rules see first-party links too", () => {
  /**
   * RL12 treats any bare URL in prose as a citation — nothing else drops a raw
   * address into a sentence. A bare FIRST-PARTY URL is still not a fabrication,
   * so it must resolve rather than block.
   */
  it("does not block a bare first-party URL in prose", () => {
    const evaluation = evaluateDraftQa(qaInput(FIRST_PARTY_BARE_URL_DRAFT));

    expect(evaluation.verdict).not.toBe("blocked");
    expect(
      claim(FIRST_PARTY_BARE_URL_DRAFT, "rl12_citation_integrity")?.status,
    ).toBe("passed");
  });

  it("does not block a Sources entry that names the customer's own site", () => {
    const evaluation = evaluateDraftQa(qaInput(FIRST_PARTY_SOURCES_DRAFT));

    expect(evaluation.verdict).not.toBe("blocked");
    expect(
      claim(FIRST_PARTY_SOURCES_DRAFT, "sc9b_sources_resolve_to_pack")?.status,
    ).toBe("passed");
  });
});

describe("first-party identity is not evidence", () => {
  /**
   * The trap this guards: the pack now carries URLs, so a naive "does the pack
   * hold anything citable?" test flips to true and every honest message about
   * this run — "no external research was retrieved, so these references cannot
   * be verified here" — silently becomes "an attribution that does not resolve
   * names a source we do not hold". That is an accusation the gate cannot
   * support, and it is exactly the wording the Task 6 rework removed.
   */
  it("keeps the external citable count at zero", () => {
    expect(buildSourceIndex(fixturePack()).citableCount).toBe(0);
  });

  it("still says `unverifiable here`, never `invented`, for an outside link", () => {
    const detail =
      claim(OUTSIDE_LINK_DRAFT, "rl12b_unresolved_link")?.detail ?? "";

    expect(detail).toContain("cannot be verified");
    expect(detail).toContain("NOT that they are wrong or invented");
    expect(detail).not.toMatch(/fabricat/i);
  });

  it("grades the first-party sources `A`, never `D`", () => {
    const firstParty = fixturePack().sources.filter((source) =>
      source.kind.startsWith("first_party"),
    );

    expect(firstParty.map((source) => source.kind)).toEqual([
      "first_party_site",
      "first_party_conversion",
    ]);
    for (const source of firstParty) {
      expect(source.authorityTier).toBe("A");
      expect(source.limitation).toContain("First-party identity only");
    }
  });

  it("omits the conversion source entirely when the ICP carries none", () => {
    const pack = fixturePack({
      firstParty: {
        siteOrigin: "https://signalframe.example",
        icpPrimaryConversionUrl: null,
      },
    });

    expect(
      pack.sources.some((source) => source.kind === "first_party_conversion"),
    ).toBe(false);
  });
});
