import { describe, expect, it } from "vitest";
import {
  buildSourceIndex,
  extractAttributions,
  findUnsupportedClaims,
  locatedAttributions,
  resolveAttribution,
  resolveLinkProvenance,
} from "./claims.ts";
import { fixturePack, packWithCitableSources } from "./__fixtures__/pack.ts";
import { canonicalUrl, flattenLine } from "./text.ts";
import type { ResearchPack } from "../types.ts";

const line = (text: string, at = 1) => [{ line: at, text }];

describe("source index", () => {
  it("reports zero citable sources for the Slice 2 pack", () => {
    // Every ref the deterministic pack emits is an opaque SignalFrame uuid, so
    // nothing in a draft can cite it. The rules that expect citations read this
    // to say "not applicable" instead of inventing an expectation.
    expect(buildSourceIndex(fixturePack()).citableCount).toBe(0);
  });

  it("indexes a URL ref by canonical url and by domain", () => {
    const index = buildSourceIndex(
      packWithCitableSources(["https://WWW.Analyst.example/report/2024/"]),
    );

    expect(index.citableCount).toBe(1);
    expect(
      resolveAttribution(index, {
        kind: "url",
        value: "https://analyst.example/report/2024",
      }).authority,
    ).toBe("B");
    expect(
      resolveAttribution(index, {
        kind: "url",
        value: "https://analyst.example/other",
      }).authority,
    ).toBe("B");
  });

  it("never resolves a generic token", () => {
    const index = buildSourceIndex(packWithCitableSources(["Gartner"]));

    for (const value of ["the", "data", "2024", "a"]) {
      expect(
        resolveAttribution(index, { kind: "name", value }).source,
      ).toBeNull();
    }
    expect(
      resolveAttribution(index, { kind: "name", value: "Gartner" }).source,
    ).not.toBeNull();
  });

  /**
   * S2. Subdomain widening belongs to the SITE ORIGIN alone.
   *
   * The ICP conversion target's host is routinely a third-party scheduler — the
   * repository's own fixture uses a different registrable domain for the two —
   * and widening it handed every other tenant of that scheduler the customer's
   * own-property status: with `https://calendly.com/acme/demo` frozen, a link
   * to `https://evil.calendly.com/anything` resolved as first-party.
   */
  it("widens the site origin to its subdomains and the conversion target to nothing", () => {
    const index = buildSourceIndex(
      fixturePack({
        firstParty: {
          siteOrigin: "https://signalframe.example",
          icpPrimaryConversionUrl: "https://calendly.com/acme/demo",
        },
      }),
    );
    const provenance = (value: string) =>
      resolveLinkProvenance(index, { kind: "url", value });

    expect(provenance("https://docs.signalframe.example/onboarding")).toBe(
      "first_party",
    );
    expect(provenance("https://calendly.com/acme/demo")).toBe("first_party");
    expect(provenance("https://evil.calendly.com/anything")).toBe("unresolved");
    expect(provenance("https://signalframe.example.attacker.test/x")).toBe(
      "unresolved",
    );
  });
});

describe("canonicalUrl", () => {
  it("folds case, `www.`, trailing slash and fragment", () => {
    expect(canonicalUrl("HTTPS://WWW.Example.com/a/#top")).toStrictEqual({
      url: "example.com/a",
      domain: "example.com",
    });
    expect(canonicalUrl("(https://example.com/a.)")?.url).toBe("example.com/a");
  });

  it("refuses a non-ASCII host rather than guessing its punycode", () => {
    expect(canonicalUrl("https://exämple.com/a")).toBeNull();
  });
});

describe("the two ALLOW holes this chain exists to close", () => {
  const index = buildSourceIndex(fixturePack());

  it("does not accept a bare four-digit year as attribution", () => {
    const hits = findUnsupportedClaims(
      index,
      line("A 2024 Gartner report found that activation improves retention."),
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]?.resolution.authority).toBe("D");
  });

  it("does not accept `by <Capitalized>` as attribution", () => {
    const hits = findUnsupportedClaims(
      index,
      line("Research by Meridian Advisory shows onboarding time fell."),
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]?.resolution.authority).toBe("D");
  });

  it("extracts the attribution shapes it then has to resolve", () => {
    const attributions = extractAttributions(
      "According to the 2024 Forrester Report, teams cut time.",
    );

    expect(attributions).toContainEqual({
      kind: "name",
      value: "Forrester Report",
    });
  });
});

describe("claim extraction boundaries", () => {
  const index = buildSourceIndex(fixturePack());

  it("exempts a negation in the same clause", () => {
    expect(
      findUnsupportedClaims(
        index,
        line("No study shows that CMS choice matters."),
      ),
    ).toHaveLength(0);
  });

  /**
   * The clause boundary is what makes the negation exemption safe: a negation
   * that governs a DIFFERENT clause must not launder the assertion next to it.
   */
  it("does not let a negation in a previous clause launder an assertion", () => {
    expect(
      findUnsupportedClaims(
        index,
        line("Not surprisingly, research shows activation drives retention."),
      ),
    ).toHaveLength(1);
  });

  it("ignores an assertion inside an inline code span", () => {
    expect(
      findUnsupportedClaims(
        index,
        line("We rejected `research shows X` as a prompt."),
      ),
    ).toHaveLength(0);
  });

  it("reports assertions on every line, not just the first", () => {
    const hits = findUnsupportedClaims(index, [
      { line: 3, text: "Research shows activation matters." },
      { line: 9, text: "Studies suggest onboarding time predicts churn." },
    ]);

    expect(hits.map((hit) => hit.line)).toStrictEqual([3, 9]);
  });

  /**
   * The negation exemption used to fire on ANY of
   * no/not/never/without/lacks/absent/neither/nor/n't/little/few anywhere in
   * the preceding clause, which is a false-negative machine: those words open a
   * large share of English sentences and say nothing about whether the
   * assertion that follows needs a source. Both sentences below are
   * fabrications that returned a clean `passed`.
   */
  it("does not let a rhetorical negation launder a fabricated assertion", () => {
    for (const sentence of [
      "There is no doubt that research shows onboarding analytics doubles activation rates by 40%.",
      "Few operators know that a study by Gartner found a 30 percent lift.",
      "Not one team we spoke to disputes that a 2024 Forrester report found a 30% lift.",
    ]) {
      const hits = findUnsupportedClaims(index, line(sentence));
      expect(hits, sentence).toHaveLength(1);
      expect(hits[0]?.resolution.authority).toBe("D");
    }
  });

  /**
   * `<Named entity> <verb> <statistic>` is the shape a hallucinated citation
   * most often takes, and none of the ported patterns reached it: it names no
   * research noun, says nothing "according to", and carries no year. The
   * paraphrase corpus is the point of this test — a word list that is only
   * spot-checked on the two sentences that motivated it grows the same holes
   * again on the next rewrite.
   */
  it("catches the paraphrases of an attributed statistic", () => {
    const sentences = [
      "Forrester found that 73% of B2B onboarding analytics teams abandon activation tracking in week one.",
      "A recent McKinsey analysis found a 30 percent lift.",
      "Nielsen Norman Group usability testing puts the lift at 30%.",
      "Gartner estimates that 62% of trials never reach activation.",
      "Bain reports that activation tracking cuts churn by 12%.",
      "The 2024 Forrester benchmark reports a 30% lift.",
      "A Deloitte survey found onboarding time fell 18%.",
      "Research from Basis Advisory shows a 40% improvement.",
      "According to a 2023 Gartner whitepaper, activation drives 25% of expansion.",
      "An IDC poll found that 55% of RevOps teams lack instrumentation.",
      "Analysts estimate onboarding rework costs 9% of ARR.",
      "SiriusDecisions pegs the median activation window at 21 days.",
      "Studies suggest activation instrumentation returns 3x within a year.",
      "G2 data puts buyer research time at 17 hours.",
      "The Meridian Advisory index ranks onboarding second among 12 priorities.",
      "Experts warn that untracked onboarding costs teams 30% of expansion revenue.",
    ];

    for (const sentence of sentences) {
      const hits = findUnsupportedClaims(index, line(sentence));
      expect(hits, sentence).toHaveLength(1);
      expect(hits[0]?.resolution.authority, sentence).toBe("D");
    }
  });

  /**
   * The same widening must not swallow honest writing. A capitalized common
   * noun after a determiner is not the name of an outside authority, and a
   * sentence with a number in it is not automatically a citation.
   */
  it("leaves first-party and ordinary sentences alone", () => {
    for (const sentence of [
      "Our Search Console export indicates clicks fell 34%.",
      "Teams that treat it as a habit find the milestone faster than teams that treat it as a report.",
      "Read our onboarding analytics report at [the product report page](https://signalframe.example/reports/onboarding).",
      "We found that 40% of our own accounts activate in week one.",
      "The dashboard shows 12 accounts stalled at the second milestone.",
      "RevOps leads own this work.",
    ]) {
      expect(
        findUnsupportedClaims(index, line(sentence)),
        sentence,
      ).toHaveLength(0);
    }
  });

  /**
   * Root cause two, at the extraction layer. The whole line was scanned for
   * bare domain literals, so a domain sitting INSIDE another url's query string
   * became a fourth attribution candidate — and "the first attribution that
   * resolves wins" then let a host the customer does not control support the
   * sentence carrying it.
   */
  it("reads no attribution out of the inside of a url", () => {
    const attributions = extractAttributions(
      "According to a 2024 Forrester study, 73% churn. See https://attacker.test/?u=https://signalframe.example/ for the chart.",
    );

    // The whole address is one attribution; the host buried in its query is not
    // a second one, and it is the only one that would have resolved.
    expect(attributions).toStrictEqual([
      {
        kind: "url",
        value: "https://attacker.test/?u=https://signalframe.example/",
      },
    ]);
    expect(
      findUnsupportedClaims(
        buildSourceIndex(fixturePack()),
        line(
          "According to a 2024 Forrester study, 73% churn. See https://attacker.test/?u=https://signalframe.example/ for the chart.",
        ),
      )[0]?.resolution.authority,
    ).toBe("D");
  });

  /**
   * Root cause two, at the resolution layer. Support has to come from the
   * source the assertion ATTRIBUTES to, not from whatever else shares the line.
   */
  it("does not let a resolvable source elsewhere on the line support an assertion", () => {
    const index = buildSourceIndex(
      packWithCitableSources(["https://analyst.example/benchmark"]),
    );
    const hits = findUnsupportedClaims(
      index,
      line(
        "According to a 2024 Forrester study, 73% of teams churn. Separately, https://analyst.example/benchmark covers pricing.",
      ),
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]?.resolution.authority).toBe("D");
  });

  it("does let the link an assertion is WRITTEN as support it", () => {
    const index = buildSourceIndex(
      packWithCitableSources(["https://analyst.example/x"]),
    );
    const hits = findUnsupportedClaims(
      index,
      line("[Forrester](https://analyst.example/x) reports that 73% churn."),
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]?.resolution.authority).toBe("B");
  });

  /**
   * S3. The entity pattern carried its OWN, shorter verb list, so a paraphrase
   * the research-noun pattern would have caught was no assertion at all; and an
   * article head discarded the whole match instead of retrying at the name
   * after it, so `The Gartner panel found …` passed while `Gartner found …`
   * was blocked.
   */
  it("catches an attributed statistic through the whole shared verb list", () => {
    for (const sentence of [
      "Forrester notes that 73% of teams abandon activation tracking.",
      "Gartner forecasts that 73% of teams will abandon activation tracking.",
      "Forrester revealed that 73% of teams abandon activation tracking.",
      "Forrester observed that 73% of teams abandon activation tracking.",
      "Forrester indicates that 73% of teams abandon activation tracking.",
      "Forrester recorded that 73% of teams abandon activation tracking.",
      "The Gartner panel found that 73% of teams abandon activation tracking.",
      "the Gartner panel found that 73% of teams abandon activation tracking.",
    ]) {
      const hits = findUnsupportedClaims(index, line(sentence));
      expect(hits, sentence).toHaveLength(1);
      expect(hits[0]?.resolution.authority, sentence).toBe("D");
    }
  });

  /**
   * S4. The named-entity assertion was brittle exactly at the boundaries it
   * introduced itself, and every failure below is one token away from a
   * sentence that WAS blocked. They are written as pairs for that reason: a
   * suite that only lists the catches passed in all three previous reworks too.
   */
  it("catches an attributed statistic across the boundaries it used to break at", () => {
    for (const sentence of [
      // A number between the name and the verb broke the match.
      "Forrester's data puts churn at 42%.",
      "Forrester's 2024 data puts churn at 42%.",
      // An explicit attribution frame needs no research noun and no verb. The
      // first of these was caught only because the company's last word happens
      // to be a research noun.
      "According to Forrester Research, 73% of teams churn.",
      "According to Forrester, 73% of teams churn.",
      "According to Gartner, onboarding time fell 40%.",
      "Per Forrester, churn is 42%.",
      // A bracket a reader sees in the rendered link label.
      "Forrester [Inc] reports that 73% of teams churn.",
    ]) {
      const hits = findUnsupportedClaims(index, line(sentence));
      expect(hits, sentence).toHaveLength(1);
      expect(hits[0]?.resolution.authority, sentence).toBe("D");
    }
  });

  it("keeps the attribution frame off first-party and unnamed sources", () => {
    for (const sentence of [
      "According to our own Search Console export, clicks fell 34%.",
      "According to the dashboard, 12 accounts stalled.",
      "According to Our Search Console export, clicks fell 34%.",
      "The report costs 40 per seat.",
    ]) {
      expect(
        findUnsupportedClaims(index, line(sentence)),
        sentence,
      ).toHaveLength(0);
    }
  });

  it("does not treat first-party data language as an external research claim", () => {
    // SignalFrame drafts are written over first-party evidence the prompt really
    // did supply; flagging every mention of the customer's own numbers would
    // block honest drafts and teach reviewers to ignore the block.
    expect(
      findUnsupportedClaims(
        index,
        line("Our Search Console export indicates clicks fell 34%."),
      ),
    ).toHaveLength(0);
  });

  /**
   * The possessive guard, written the way the docstring that motivated it spells
   * it (`claims.ts:519-523`): *"our Search Console export indicates clicks fell
   * 34%"*. The suite above only ever wrote it with a CAPITAL `Our`, which never
   * reaches the possessive test at all — a capitalized possessive is swallowed
   * by the name run and rejected one step earlier as a pronoun head. Written in
   * the ordinary lowercase form the capitalized span is `Search Console`, a
   * common-noun phrase the customer owns, and only the possessive in front of it
   * says so.
   *
   * Without that step the sentence is an unsupported external-research assertion
   * at authority D, i.e. the gate BLOCKS a draft for reporting the customer's
   * own numbers — the false accusation `claims.ts:450-457` says must not happen
   * ("treating every mention of the customer's own numbers as an unsupported
   * claim would block honest drafts while teaching reviewers to ignore the
   * block").
   */
  it("keeps a lowercase possessive first-party sentence out of the assertion set", () => {
    for (const sentence of [
      "our Search Console export indicates clicks fell 34%.",
      // Not anchored to the start of the line, either.
      "Every quarter, our Activation Dashboard shows 12% growth.",
    ]) {
      expect(
        findUnsupportedClaims(index, line(sentence)),
        sentence,
      ).toHaveLength(0);
    }
  });

  /**
   * A2, pinned so it cannot change silently.
   *
   * The stop gate's ACCEPTED limitation A2 says a claim explicitly attributed to
   * the customer's own page is still blocked: the pack freezes `site.origin`,
   * never the page's CONTENTS, so we genuinely cannot confirm that the page says
   * this. This is the sharpest form of it — the attribution is not merely on the
   * line, it IS the assertion's attribution, sitting inside its own span.
   *
   * The two questions therefore disagree about the same address on purpose
   * (`claims.ts:279-290`, `claims.ts:306-313`): it is ours, and it is not
   * evidence. `AssertionSupport` has no first-party inhabitant by construction,
   * which is what makes the original defect — one link to the customer's own
   * site vouching for an invented external reference (`claims.ts:37-46`) —
   * unspellable rather than merely fixed.
   */
  it("does not let the customer's own page support the assertion written as it", () => {
    const own = "https://signalframe.example/reports/onboarding";
    const hits = findUnsupportedClaims(
      index,
      line(
        `According to [our onboarding report](${own}), 73% of teams abandon activation tracking.`,
      ),
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]?.resolution.support).toBeNull();
    expect(hits[0]?.resolution.authority).toBe("D");
    // The same address, asked the other question, is a complete answer.
    expect(resolveLinkProvenance(index, { kind: "url", value: own })).toBe(
      "first_party",
    );
  });
});

/**
 * What an identity is NOT good enough to resolve.
 *
 * Every case here is a pack row that carries SOMETHING — a short name, a bare
 * year, a malformed origin, punctuation — and the question is whether that
 * something may act as a matcher. The answer has to be no in each case, because
 * a matcher this weak confirms references by accident, and a reference confirmed
 * by accident is the one failure mode this whole chain exists to remove.
 */
describe("identities too weak to resolve anything", () => {
  /**
   * `QA_THRESHOLDS.nameMatchMinTokenLen` (`thresholds.ts:64-65`) and blueprint
   * §4.3 step 3: the partial matcher may only run on a token long enough to be
   * an identity. A row whose longest token is below the floor contributes no
   * fuzzy matcher at all — so an invented firm name that merely EMBEDS that
   * token stays unresolved, while the row itself is still resolvable by its
   * exact name (which is what proves the row is really in the pack and the null
   * above is the floor rather than an empty index).
   */
  it("gives a pack row with no long-enough token no fuzzy matcher", () => {
    const index = buildSourceIndex(packWithCitableSources(["IDC"]));

    expect(
      resolveAttribution(index, {
        kind: "name",
        value: "Meridian IDC Advisory",
      }).source,
    ).toBeNull();
    expect(
      resolveAttribution(index, { kind: "name", value: "IDC" }).source,
    ).not.toBeNull();
  });

  /**
   * The year hole, closed on the PACK side.
   *
   * The ported rule accepted any bare four-digit year as proof a line was
   * attributed, and closing that is the single most important correctness
   * requirement of this Task (decisions.md, "跨 Q 的统一约束"; blueprint §1.1
   * RL8-B2B). The suite already proves a year resolves nothing when the pack
   * holds no year. This is the other half: a year must not become a matcher even
   * when a pack row IS a bare number, because a numeric token names nobody.
   *
   * The name deliberately carries the year in the MIDDLE (`Forrester 2024
   * Digital Experience Report`): a leading year is stripped by
   * `cleanNameCandidate`, so only this spelling reaches the token matcher with
   * the year still in it.
   */
  it("never lets a numeric pack row resolve a name that carries the same number", () => {
    const index = buildSourceIndex(packWithCitableSources(["2024"]));

    expect(index.citableCount).toBe(0);
    expect(
      resolveAttribution(index, {
        kind: "name",
        value: "Forrester 2024 Digital Experience Report",
      }).source,
    ).toBeNull();
    expect(
      findUnsupportedClaims(
        index,
        line(
          "According to the Forrester 2024 Digital Experience Report, 73% of teams churn.",
        ),
      )[0]?.resolution.authority,
    ).toBe("D");
  });

  /**
   * A malformed first-party row (`claims.ts:137-141`).
   *
   * `normalizeFirstPartyUrl` rejects a non-URL origin at the freeze boundary
   * (`first-party.ts:60-66`: "Freezing a non-URL would put a bare token into the
   * pack, where the name-matching half of the resolution chain could match it
   * against unrelated prose and silently confirm a reference nothing in our
   * records supports"), so a row like this means the row was malformed. It must
   * then resolve NOTHING rather than degrade into a fuzzy name matcher.
   *
   * `resolveLinkProvenance` is asked with a NAME on purpose: RL12's locator
   * markers really do call it that way (`red-lines.ts:760-763`), so a
   * first-party name token would release a citation shape the pack cannot
   * account for — a fail-open in a blocking rule, not a cosmetic slip.
   */
  it("gives a malformed first-party row no name matcher at all", () => {
    const base = fixturePack();
    const pack: ResearchPack = {
      ...base,
      sources: [
        ...base.sources,
        {
          kind: "first_party_site",
          ref: "SignalFrame Analytics",
          authorityTier: "A",
          limitation: null,
        },
      ],
    };
    const index = buildSourceIndex(pack);
    const named = {
      kind: "name",
      value: "SignalFrame Analytics Group",
    } as const;

    expect(index.citableCount).toBe(0);
    expect(resolveAttribution(index, named).source).toBeNull();
    expect(resolveLinkProvenance(index, named)).toBe("unresolved");
  });
});

/**
 * The chain has to RESOLVE, not only refuse.
 *
 * Slice 2's own pack retrieves nothing external, so "did this resolve?" is the
 * constant no for every real run — which means a suite made only of refusals
 * would pass just as happily against a chain that resolves nothing at all. Each
 * case below is a shape a correct draft is entitled to, and blocking it would be
 * the false-accusation failure rather than a missed fabrication.
 */
describe("what the chain does resolve", () => {
  /**
   * Blueprint §4.3 step 3: "名称最长 token 命中(token 长度 ≥4)→ matched", and
   * step 4: a matched claim takes its source's authority, never `D`.
   *
   * A draft that writes `Forrester Digital Experience Report` against a pack row
   * spelled `Forrester Research` is citing the source we hold under a longer
   * title. Without the token match that draft is reported as an unsupported
   * assertion at authority D — the gate accusing a correct citation, which
   * `names.ts:28-34` names as the failure that costs reviewer trust.
   */
  it("resolves an assertion on the longest identity token of its source", () => {
    const index = buildSourceIndex(
      packWithCitableSources(["Forrester Research"]),
    );
    const hits = findUnsupportedClaims(
      index,
      line(
        "According to the Forrester Digital Experience Report, 73% of teams churn.",
      ),
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]?.resolution.authority).toBe("B");
    expect(hits[0]?.resolution.support?.source.ref).toBe("Forrester Research");
  });

  /**
   * A bare domain literal is an attribution (`claims.ts:360`, blueprint §4.3
   * step 2d), located outside any URL and resolved by DOMAIN.
   *
   * `According to Analyst.example, …` is how a draft cites a source without
   * writing a link, and it is one token away from the laundering case the suite
   * already pins: the same scan that must not read a domain out of the INSIDE of
   * a url must still read one that stands on its own. Losing this arm blocks an
   * honest citation of a pack domain; the second half proves the arm resolves by
   * identity and not by shape.
   */
  it("reads a bare domain literal as an attribution and resolves it by domain", () => {
    const sentence = "According to Analyst.example, 73% of teams churn.";
    const index = buildSourceIndex(
      packWithCitableSources(["https://analyst.example/benchmark"]),
    );

    expect(extractAttributions(sentence)).toContainEqual({
      kind: "url",
      value: "Analyst.example",
    });
    expect(
      findUnsupportedClaims(index, line(sentence))[0]?.resolution.authority,
    ).toBe("B");
    // The same sentence against the Slice 2 pack, which holds no such domain.
    expect(
      findUnsupportedClaims(buildSourceIndex(fixturePack()), line(sentence))[0]
        ?.resolution.authority,
    ).toBe("D");
  });

  /**
   * RL12b's question — "is this address one the frozen inputs account for?"
   * (`claims.ts:306-313`) — has a positive answer, and the suite never took it:
   * every provenance assertion so far was `first_party` or `unresolved`. If this
   * arm collapsed, every correctly cited external source would be reported as an
   * unaccounted-for link, which is noise a reviewer learns to click through.
   *
   * The second assertion is the bound on it. An external source's domain is
   * never widened to its subdomains (`claims.ts:250-255`): widening would let a
   * draft cite `fake.analyst.example` on the strength of a pack entry for
   * `analyst.example`.
   */
  it("accounts for an external link by identity, without widening its domain", () => {
    const index = buildSourceIndex(
      packWithCitableSources(["https://analyst.example/benchmark"]),
    );
    const provenance = (value: string) =>
      resolveLinkProvenance(index, { kind: "url", value });

    expect(provenance("https://WWW.Analyst.example/benchmark/")).toBe(
      "external_evidence",
    );
    expect(provenance("https://fake.analyst.example/benchmark")).toBe(
      "unresolved",
    );
  });

  /**
   * S2's sibling, one layer down. A host this gate cannot canonicalize is
   * unresolvable, never "close enough to ours": `canonicalUrl` refuses non-ASCII
   * hosts rather than guessing their punycode, precisely so the answer fails
   * towards a human instead of towards a silent match (`text.ts:642-649`).
   *
   * Both spellings below are a homograph of the frozen origin — one of the
   * origin itself, one of a subdomain the suffix rule would otherwise widen —
   * and granting either one own-property status is the same defect the leading
   * dot in that rule was added to prevent.
   */
  it("refuses a host it cannot canonicalize rather than reading it as ours", () => {
    const index = buildSourceIndex(fixturePack());
    const provenance = (value: string) =>
      resolveLinkProvenance(index, { kind: "url", value });

    expect(provenance("https://signalframe.exämple/onboarding")).toBe(
      "unresolved",
    );
    expect(provenance("https://dõcs.signalframe.example/onboarding")).toBe(
      "unresolved",
    );
  });
});

/**
 * F1. A line was allowed ONE claim, so a fabrication that shared a line with a
 * resolvable attribution was invisible to the two rules that block on it.
 */
describe("every assertion on a line is resolved on its own evidence", () => {
  const index = buildSourceIndex(packWithCitableSources(["Analyst Insights"]));

  it("reports the invented attribution beside a resolvable one", () => {
    const hits = findUnsupportedClaims(
      index,
      line(
        "According to Analyst Insights, activation rose 30%. According to Forrester, 73% of teams abandon activation tracking.",
      ),
    );

    expect(hits).toHaveLength(2);
    expect(hits.map((hit) => hit.resolution.authority)).toStrictEqual([
      "B",
      "D",
    ]);
    expect(hits[1]?.excerpt).toContain("Forrester");
  });

  /**
   * The order the sentences are written in is not a fact about whether either
   * citation is real, so the same line reversed must judge the same way.
   */
  it("judges the same line the same way whichever sentence comes first", () => {
    const hits = findUnsupportedClaims(
      index,
      line(
        "According to Forrester, 73% of teams abandon activation tracking. According to Analyst Insights, activation rose 30%.",
      ),
    );

    expect(
      hits.filter((hit) => hit.resolution.support === null),
    ).toHaveLength(1);
    expect(hits).toHaveLength(2);
  });

  /** The control: extracting every claim must not manufacture a defect. */
  it("leaves a line whose claims all resolve fully supported", () => {
    const hits = findUnsupportedClaims(
      index,
      line(
        "According to Analyst Insights, activation rose 30%. According to Analyst Insights, 73% of teams abandon activation tracking.",
      ),
    );

    expect(hits.every((hit) => hit.resolution.support !== null)).toBe(true);
    expect(hits.map((hit) => hit.resolution.authority)).not.toContain("D");
  });

  /**
   * The mechanism, isolated. `according to\s+([^\n]{2,120})` captures up to 120
   * characters; the VALUE was cut at the comma and the SPAN was not, so one
   * resolvable name sat on top of every later sentence on the line.
   */
  it("locates a named attribution at its name, not across the rest of the line", () => {
    const flat = flattenLine(
      "According to Analyst Insights, activation rose 30%. According to Forrester, 73% of teams abandon activation tracking.",
    );
    const named = locatedAttributions(flat).filter(
      (attribution) => attribution.kind === "name",
    );

    expect(named.length).toBeGreaterThan(0);
    for (const attribution of named) {
      expect(flat.text.slice(attribution.start, attribution.end)).toBe(
        attribution.value,
      );
    }
  });

  /**
   * Several patterns recognise one assertion (`The Analyst Insights report
   * found that activation improves 30%` is both a research noun beside a verb
   * and a capitalized name beside a verb). That is one defect, and only the
   * reading that NAMES a source knows who the sentence attributes to — so the
   * unnamed reading yields rather than reporting a second, unsupported claim.
   */
  it("does not report one assertion twice because two shapes matched it", () => {
    const hits = findUnsupportedClaims(
      index,
      line("The Analyst Insights report found that activation improves 30%."),
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]?.resolution.authority).toBe("B");
  });

  /**
   * Same sentence, two different names. Collapsing these is the "one
   * resolution licenses everything near it" mistake the role split removed.
   */
  it("keeps two differently-attributed claims apart inside one sentence", () => {
    const hits = findUnsupportedClaims(
      index,
      line(
        "According to Analyst Insights, Forrester found that 73% of teams churn.",
      ),
    );

    expect(hits.some((hit) => hit.resolution.support === null)).toBe(true);
  });
});
