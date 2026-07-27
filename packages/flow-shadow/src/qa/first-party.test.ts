import { describe, expect, it } from "vitest";
import {
  FIRST_PARTY_BARE_URL_DRAFT,
  FIRST_PARTY_SOURCES_DRAFT,
  FIRST_PARTY_SUBDOMAIN_DRAFT,
  LAUNDERED_CITATION_DRAFT,
  LAUNDERED_CLAIM_CONTROL_DRAFT,
  LAUNDERED_CLAIM_DRAFT,
  LAUNDERED_REFERENCE_LIST_DRAFT,
  LOOKALIKE_HOST_DRAFT,
  OUTSIDE_LINK_DRAFT,
  SCAFFOLD_CTA_DRAFT,
} from "./__fixtures__/drafts.ts";
import {
  FIXTURE_FIRST_PARTY,
  fixturePack,
  qaInput,
} from "./__fixtures__/pack.ts";
import {
  buildSourceIndex,
  resolveAssertionSupport,
  resolveAttribution,
  resolveLinkProvenance,
} from "./claims.ts";
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
          includeFirstPartyPageSnapshots: false,
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

  it("does not infer ownership for an unverified subdomain", () => {
    const evaluation = evaluateDraftQa(qaInput(FIRST_PARTY_SUBDOMAIN_DRAFT));

    expect(evaluation.verdict).toBe("needs_review");
    expect(
      claim(FIRST_PARTY_SUBDOMAIN_DRAFT, "rl12b_unresolved_link")?.status,
    ).toBe("failed");
  });

  it("resolves a link to the frozen ICP conversion target on another host", () => {
    const draft = SCAFFOLD_CTA_DRAFT.replace(
      "https://signalframe.example/demo",
      FIXTURE_FIRST_PARTY.icpPrimaryConversionUrl ?? "",
    );

    expect(evaluateDraftQa(qaInput(draft)).verdict).toBe("passed");
  });

  /** Hostname resemblance never proves ownership. */
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

  /**
   * CORRECTED, and the correction is the point of this rework.
   *
   * This assertion used to read `not.toBe("blocked")`, and the rule it pinned
   * was "a Sources entry resolves if ANYTHING in it resolves". That rule cannot
   * tell this entry from `- Forrester Digital Experience Report, 2024.
   * https://signalframe.example/product`, so accepting the honest one accepted
   * the invented one too — see `LAUNDERED_REFERENCE_LIST_DRAFT`, which was
   * `passed` with SC9b writing down that both of its entries resolved to the
   * frozen pack.
   *
   * A Sources section claims that outside sources stand behind the draft. This
   * run retrieved none, so no entry in one can be confirmed here, and that is
   * true of the honest self-citation as well. What the gate owes the reviewer is
   * not a pass — it is an accurate reason, so the detail still says the entry is
   * unverifiable HERE and never that it was invented.
   */
  it("blocks a Sources entry naming the customer's own site, without calling it invented", () => {
    const evaluation = evaluateDraftQa(qaInput(FIRST_PARTY_SOURCES_DRAFT));
    const sc9b = claim(
      FIRST_PARTY_SOURCES_DRAFT,
      "sc9b_sources_resolve_to_pack",
    );

    expect(evaluation.verdict).toBe("blocked");
    expect(sc9b?.status).toBe("failed");
    expect(sc9b?.detail).toContain("unverifiable here");
    expect(sc9b?.detail).not.toMatch(/\bwere invented\b/);
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

  /**
   * THE ASSERTIONS THIS BLOCK IS NAMED AFTER.
   *
   * The block carried this title while asserting only the citable count and
   * some wording — nothing here said a first-party URL may not SATISFY a claim.
   * That is why three ways of laundering a fabrication behind the customer's own
   * link passed every gate in the suite.
   */
  it("never lets a first-party link support a research assertion (RL8)", () => {
    expect(evaluateDraftQa(qaInput(LAUNDERED_CLAIM_DRAFT)).verdict).toBe(
      "blocked",
    );
    expect(claim(LAUNDERED_CLAIM_DRAFT, "rl8_unsupported_claim")?.status).toBe(
      "failed",
    );
    // The counterfactual: the link was the only difference, so both must agree.
    expect(
      claim(LAUNDERED_CLAIM_CONTROL_DRAFT, "rl8_unsupported_claim")?.status,
    ).toBe("failed");
  });

  it("never lets a first-party URL resolve a reference entry (SC9b)", () => {
    const sc9b = claim(
      LAUNDERED_REFERENCE_LIST_DRAFT,
      "sc9b_sources_resolve_to_pack",
    );

    expect(
      evaluateDraftQa(qaInput(LAUNDERED_REFERENCE_LIST_DRAFT)).verdict,
    ).toBe("blocked");
    expect(sc9b?.status).toBe("failed");
    expect(sc9b?.detail).toContain("2 of 2 reference entry(ies)");
  });

  it("never lets a first-party link release a citation shape (RL12)", () => {
    expect(evaluateDraftQa(qaInput(LAUNDERED_CITATION_DRAFT)).verdict).toBe(
      "blocked",
    );
    expect(
      claim(LAUNDERED_CITATION_DRAFT, "rl12_citation_integrity")?.status,
    ).toBe("failed");
  });

  /**
   * The role split at the resolution layer, asserted directly rather than only
   * through the rules: `resolveAssertionSupport` has no first-party inhabitant,
   * and `resolveLinkProvenance` is the only place one is an answer.
   */
  it("separates `is this ours?` from `does this support a claim?`", () => {
    const index = buildSourceIndex(fixturePack());
    const own = {
      kind: "url",
      value: "https://signalframe.example/demo",
    } as const;

    expect(resolveAttribution(index, own).role).toBe("first_party_identity");
    expect(resolveLinkProvenance(index, own)).toBe("first_party_identity");
    expect(resolveAssertionSupport(index, [own])).toBeNull();
  });

  it("still says `unverifiable here`, never `invented`, for an outside link", () => {
    const detail =
      claim(OUTSIDE_LINK_DRAFT, "rl12b_unresolved_link")?.detail ?? "";

    expect(detail).toContain("cannot be verified");
    expect(detail).toContain("NOT that they are wrong or invented");
    expect(detail).not.toMatch(/fabricat/i);
  });

  /**
   * The role split has to hold at the PACKAGE BOUNDARY too.
   *
   * A purity guard stops the rules from calling `resolveAttribution` — it
   * answers "does the pack hold anything this names?", and one link to the
   * customer's own site answers it yes. But the guard walks this package's
   * import closure only, and `qa/index.ts` re-exported the function, so any
   * future consumer in `apps/` could import it and reintroduce "did ANYTHING
   * resolve?" one line outside the guard's range. There is no such caller yet,
   * which is the only reason removing it was free.
   */
  it("keeps the low-level lookup off the package's public surface", async () => {
    const surface = await import("./index.ts");
    const packageSurface = await import("../index.ts");

    expect("resolveAttribution" in surface).toBe(false);
    expect("resolveAttribution" in packageSurface).toBe(false);
    // The two questions a consumer MAY ask are still exported.
    expect(typeof surface.resolveAssertionSupport).toBe("function");
    expect(typeof surface.resolveLinkProvenance).toBe("function");
  });

  it("grades first-party identities `A` and captured pages `B`, never `D`", () => {
    const firstPartyIdentity = fixturePack().sources.filter((source) =>
      ["first_party_site", "first_party_conversion"].includes(source.kind),
    );

    expect(firstPartyIdentity.map((source) => source.kind)).toEqual([
      "first_party_site",
      "first_party_conversion",
    ]);
    for (const source of firstPartyIdentity) {
      expect(source.authorityTier).toBe("A");
      expect(source.limitation).toContain("First-party identity only");
    }
    const capturedPage = fixturePack().sources.find(
      (source) => source.kind === "first_party_page",
    );
    expect(capturedPage).toMatchObject({
      authorityTier: "B",
      availability: "available",
    });
    expect(capturedPage?.contentText).not.toBeNull();
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
