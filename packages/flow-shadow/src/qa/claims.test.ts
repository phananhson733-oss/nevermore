import { describe, expect, it } from "vitest";
import {
  buildSourceIndex,
  extractAttributions,
  findUnsupportedClaims,
  resolveAttribution,
  resolveLinkProvenance,
} from "./claims.ts";
import { fixturePack, packWithCitableSources } from "./__fixtures__/pack.ts";
import { canonicalUrl } from "./text.ts";

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
});
