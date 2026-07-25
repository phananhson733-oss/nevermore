import { describe, expect, it } from "vitest";
import {
  buildSourceIndex,
  extractAttributions,
  findUnsupportedClaims,
  resolveAttribution,
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
      expect(resolveAttribution(index, { kind: "name", value }).source).toBeNull();
    }
    expect(
      resolveAttribution(index, { kind: "name", value: "Gartner" }).source,
    ).not.toBeNull();
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
      findUnsupportedClaims(index, line("No study shows that CMS choice matters.")),
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
      findUnsupportedClaims(index, line("We rejected `research shows X` as a prompt.")),
    ).toHaveLength(0);
  });

  it("reports assertions on every line, not just the first", () => {
    const hits = findUnsupportedClaims(index, [
      { line: 3, text: "Research shows activation matters." },
      { line: 9, text: "Studies suggest onboarding time predicts churn." },
    ]);

    expect(hits.map((hit) => hit.line)).toStrictEqual([3, 9]);
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
