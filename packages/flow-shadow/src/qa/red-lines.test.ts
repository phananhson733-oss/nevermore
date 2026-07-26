import { describe, expect, it } from "vitest";
import type { ResearchPack } from "../types.ts";
import { CLEAN_DRAFT } from "./__fixtures__/drafts.ts";
import { fixturePack, qaInput } from "./__fixtures__/pack.ts";
import { buildQaContext } from "./context.ts";
import { checkRl4, checkRl5, checkRl10, checkRl12 } from "./red-lines.ts";
import { QA_THRESHOLDS } from "./thresholds.ts";

/**
 * Red lines, exercised at the rule boundary rather than through the whole gate.
 *
 * The suite's other files drive `evaluateDraftQa`, which is the right level for
 * a verdict but the wrong one for the decisions this file is about: a tolerance
 * that has to be 4 rather than 2, a marker that has to be reported when its
 * footnote is missing, a link that is a citation only in one of two positions.
 * Each of those is invisible from the verdict, because more than one rule can
 * move it.
 *
 * Everything asserted here is anchored on the porting blueprint
 * (`docs/plans/2026-07-25-slice2-task6-qa-port-blueprint.md`), the decisions
 * that override it (`...-task6-decisions.md`), or the acknowledged capability
 * limits in `...-slice2-stop-gate-residuals.md` section A. Where the two
 * disagree, the citation is named in the test's own comment.
 */

function contextFor(markdown: string, pack: ResearchPack = fixturePack()) {
  return buildQaContext(qaInput(markdown, pack));
}

/**
 * A frozen pack whose cluster contributed no target keyword at all.
 *
 * `resolveTargetKeyword` falls back from `briefOutline.targetKeywords` to the
 * cluster key, so both have to be empty for the rules to see nothing.
 */
function keywordlessPack(): ResearchPack {
  const base = fixturePack();
  return {
    ...base,
    briefOutline: { ...base.briefOutline, targetKeywords: [] },
    searchObservation: { ...base.searchObservation, clusterKey: "" },
  };
}

describe("RL4 — section openers anchor on the keyword", () => {
  /**
   * Blueprint section 3.2: "`targetKeyword` 为空(RL4/RL5 无法判)" is listed as a
   * trigger for `evaluable:false`, and section 6.2 states the consequence in
   * full: "targetKeyword 为空 -> RL4/RL5 evaluable:false -> needs_review,
   * **不是** passed". Decision Q5 adds that the result must carry the reason.
   *
   * `unevaluable` returns `pass: true`, so a rule that answered this case with
   * `pass()` instead would look identical on `.pass` and would report that a
   * clean draft's openers anchor on the empty string. `evaluable` is the only
   * field that separates "we looked and found nothing wrong" from "we could not
   * look" — see `evaluate.ts:43-44`, property 2.
   */
  it("reports an absent target keyword as unjudged, not as anchored", () => {
    const result = checkRl4(contextFor(CLEAN_DRAFT, keywordlessPack()));

    expect(result.evaluable).toBe(false);
    expect(result.reasonCode).toBe("rl4_no_target_keyword");
    expect(result.detail).toContain("no target keyword");
  });

  /**
   * The drift tolerance is 4, and it is 4 on purpose.
   *
   * `thresholds.ts:26` calls it "the B2B value (the oracle profile used 2, which
   * is far too tight for B2B)", and the blueprint's RL4 row records the same
   * number as `GENGROWTH_RL4_DRIFT_FAIL=4`. Reverting to the oracle's 2 — the
   * single most likely regression here, because 2 is what the upstream source
   * file says — would fail correct B2B drafts that carry a couple of sections
   * about adjacent topics. Only a pair of assertions astride the boundary can
   * see that; either one alone passes under both values.
   */
  it("fails at the fourth drifted section, not the second", () => {
    const three = checkRl4(contextFor(driftedDraft(3)));
    const four = checkRl4(contextFor(driftedDraft(4)));

    expect(QA_THRESHOLDS.rl4DriftedSectionsFail).toBe(4);
    expect(three.pass).toBe(true);
    expect(four.pass).toBe(false);
    expect(four.reasonCode).toBe("rl4_sections_drifted");
  });
});

describe("RL5 — keyword density", () => {
  /** Same obligation as RL4's, on the other rule blueprint section 3.2 names. */
  it("reports an absent target keyword as unjudged, not as within density", () => {
    const result = checkRl5(contextFor(CLEAN_DRAFT, keywordlessPack()));

    expect(result.evaluable).toBe(false);
    expect(result.reasonCode).toBe("rl5_no_target_keyword");
    expect(result.detail).toContain("no target keyword");
  });
});

describe("RL10 — conversational residue", () => {
  /**
   * Blueprint RL10: five chat-residue phrases, ported at `review` severity.
   * The rule has no other way into the verdict, so a draft that still talks to
   * the operator has to reach a human through this failure or not at all.
   */
  it("fails a draft that still addresses the operator", () => {
    const draft = [
      "# Onboarding analytics",
      "",
      "## What onboarding analytics covers",
      "",
      "As you mentioned, activation is the milestone that matters here.",
      "",
    ].join("\n");
    const result = checkRl10(contextFor(draft));

    expect(result.pass).toBe(false);
    expect(result.reasonCode).toBe("rl10_residue_present");
  });

  /**
   * Blueprint RL10, verbatim: "刻意**不**禁裸 `you`(FAQ 语气合法)" — the bare
   * second person is deliberately NOT banned, because FAQ and how-to voice is
   * written in it. Widening `CHAT_RESIDUE` to `\byou\b` is the cheap-looking
   * change this test exists to stop: it would fail nearly every honest B2B
   * draft in the corpus, at `review` severity, forever.
   */
  it("leaves the bare second person alone, which FAQ voice needs", () => {
    const draft = [
      "# Onboarding analytics",
      "",
      "## What onboarding analytics covers",
      "",
      "You instrument the milestone once, and your team reviews it weekly.",
      "Your activation rate then answers the question you actually care about.",
      "",
    ].join("\n");

    expect(checkRl10(contextFor(draft)).pass).toBe(true);
  });

  /**
   * `maxReportedFindings` (thresholds.ts:67) is "a bound on how many violation
   * excerpts one claim's detail may enumerate", and the detail is what a
   * reviewer reads. Without the "and N more" tail the bound would silently drop
   * the remainder: the reviewer would fix six lines and believe the draft was
   * clean. The count itself is load-bearing, so it is asserted, not just the
   * presence of the phrase.
   *
   * `evaluate.ts` then bounds the detail again at 2,000 code points, so an
   * unbounded enumeration would eventually be cut mid-excerpt with no count at
   * all — the same information loss, harder to notice.
   */
  it("enumerates at most the reported-findings bound and counts the rest", () => {
    const draft = [
      "# Onboarding analytics",
      "",
      "## What onboarding analytics covers",
      "",
      "Your prompt asked for the activation number, so here it is.",
      "Your question about churn is answered further down.",
      "Your instructions said to keep the summary short.",
      "Your logic for weighting trial accounts still holds.",
      "Your prompt asked for a second cut by segment.",
      "Your question about seat counts needs the billing export.",
      "Your instructions said to close on the demo link.",
      "",
    ].join("\n");
    const result = checkRl10(contextFor(draft));

    expect(result.pass).toBe(false);
    expect(result.detail.match(/line \d+:/g)).toHaveLength(
      QA_THRESHOLDS.maxReportedFindings,
    );
    expect(result.detail).toContain("and 1 more");
  });
});

describe("RL12 — what a sentence offers as evidence", () => {
  /**
   * `red-lines.ts:137-147` records the defect and the rule that replaced it:
   * the cue used to be tested against the whole line, so "According to a 2024
   * Forrester study, 73% … [Book a demo](our-site)" made the call to action the
   * citation for the study — and once the customer's own site was in the pack,
   * that link RESOLVED and released the block. A link is a citation "only when
   * it FOLLOWS the cue inside the cue's own sentence".
   *
   * The two drafts below carry the same words, the same link and the same cue;
   * only the order differs. Asserting one of them alone proves nothing, because
   * a rule that attributed every link on the line would agree with either.
   *
   * That the FOLLOWING case blocks is itself the acknowledged behaviour, not an
   * accident: stop-gate residual A2 states that an explicitly attributed
   * first-party link is blocked, because the pack freezes the site origin and
   * not the page's contents, so we genuinely cannot confirm that the page says
   * this.
   */
  it("counts a link as a citation only when it follows the attribution cue", () => {
    const following = [
      "# Onboarding analytics",
      "",
      "## What onboarding analytics covers",
      "",
      "According to a 2024 Forrester study, activation improves once teams [book a demo](https://signalframe.example/demo).",
      "",
    ].join("\n");
    const preceding = [
      "# Onboarding analytics",
      "",
      "## What onboarding analytics covers",
      "",
      "Teams that [book a demo](https://signalframe.example/demo) activate sooner, according to a 2024 Forrester study.",
      "",
    ].join("\n");

    expect(checkRl12(contextFor(following)).pass).toBe(false);
    expect(checkRl12(contextFor(preceding)).pass).toBe(true);
  });

  /**
   * `red-lines.ts:719-721`: "A footnote marker cites its definition. With no
   * definition it cites nothing at all, which is exactly what the gate has to
   * say about it."
   *
   * A dangling `[^1]` is the cheapest fabrication a model can emit — the
   * sentence reads as sourced and there is no source anywhere in the file. The
   * failure mode this guards is the one `evaluate.ts:43-44` names: skipping the
   * marker when its definition is missing would convert "we found no
   * definition" into "this draft cites nothing", a silent pass.
   *
   * The control draft is the same sentence with the marker removed, so the
   * assertion is about the marker rather than about the prose around it.
   */
  it("reports a footnote marker whose definition is missing", () => {
    const dangling = [
      "# Onboarding analytics",
      "",
      "## What onboarding analytics covers",
      "",
      "Activation improved by 34% after the milestone was instrumented.[^1]",
      "",
    ].join("\n");
    const control = dangling.replace(".[^1]", ".");
    const result = checkRl12(contextFor(dangling));

    expect(result.pass).toBe(false);
    expect(result.evaluable).toBe(true);
    expect(result.reasonCode).toBe("rl12_citation_unresolved");
    expect(result.detail).toContain("[^1]");
    expect(checkRl12(contextFor(control)).pass).toBe(true);
  });

  /**
   * Stop-gate residual A3 fixes both halves of this.
   *
   * A Title Case bullet with no year, quotation or address cannot be told from
   * a real reference entry without a dictionary, so the rule refuses to call it
   * unsupported: its cost boundary is "该 claim 只会是 `unevaluated`、**永远到
   * 不了 `blocked`**". That is the control below.
   *
   * But it still has to reach the reviewer. When a confident reference fails on
   * the same draft the rule returns one failure, and the tentative entries have
   * no other way out — dropping them there would hide exactly the lines A3
   * promises a human will decide on, and the draft's own claim detail would be
   * the thing hiding them.
   *
   * Only the COUNT is asserted, because only the count is emitted: the failure
   * branch reports how many tentative entries there are without enumerating
   * them. That is a gap, not a rule, so it is reported rather than frozen here.
   */
  it("keeps the unjudged entries in the report when a confident one also fails", () => {
    const both = [
      "# Onboarding analytics",
      "",
      "## What onboarding analytics covers",
      "",
      "Forrester (2024) puts median activation at 34% of new accounts.",
      "",
      "- Track Activation Milestones Weekly",
      "",
    ].join("\n");
    const tentativeOnly = both.replace(
      "Forrester (2024) puts median activation at 34% of new accounts.\n\n",
      "",
    );
    const result = checkRl12(contextFor(both));
    const control = checkRl12(contextFor(tentativeOnly));

    expect(result.pass).toBe(false);
    expect(result.reasonCode).toBe("rl12_citation_unresolved");
    expect(result.detail).toContain("Forrester (2024)");
    expect(result.detail).toContain("A further 1 entry(ies)");

    // A3's cost boundary: alone, the same bullet is never a block.
    expect(control.evaluable).toBe(false);
    expect(control.reasonCode).toBe("rl12_citation_unjudged");
  });
});

/**
 * A draft whose lead anchors on the target keyword, followed by `count`
 * sections whose opening paragraph carries neither keyword token.
 *
 * The sections are about real adjacent B2B topics rather than nonsense, because
 * that is the draft the tolerance exists for: a post that spends four sections
 * away from its keyword is drifting, and a post that spends three is writing.
 */
const RL4_DRIFTED_SECTIONS: readonly (readonly string[])[] = [
  [
    "## Pricing pages",
    "",
    "Buyers compare list prices before they talk to sales.",
    "",
  ],
  [
    "## Support tickets",
    "",
    "Deflection moves once the help centre is searchable.",
    "",
  ],
  [
    "## Hiring plans",
    "",
    "Headcount follows the pipeline, not the other way round.",
    "",
  ],
  [
    "## Board reporting",
    "",
    "The quarterly deck needs one number per initiative.",
    "",
  ],
];

function driftedDraft(count: number): string {
  return [
    "# Onboarding analytics for RevOps teams",
    "",
    "Onboarding analytics tells a RevOps team where activation stalls.",
    "",
    ...RL4_DRIFTED_SECTIONS.slice(0, count).flat(),
  ].join("\n");
}
