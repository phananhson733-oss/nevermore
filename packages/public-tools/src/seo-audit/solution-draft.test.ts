import { describe, expect, it } from "vitest";
import {
  buildSolutionDraftPrompt,
  readSolutionDraft,
  type SolutionDraftInput,
} from "./solution-draft.ts";

function input(overrides: Partial<SolutionDraftInput> = {}): SolutionDraftInput {
  return {
    kind: "search-presentation",
    url: "https://acme.test/chart",
    title: "Chart",
    metaDescription: "A chart page",
    headings: ["Chart", "How to read it"],
    targetQuery: "natal chart",
    pageType: "tool",
    openingText: "Enter a birth date to draw a chart.",
    ...overrides,
  };
}

describe("the draft prompt", () => {
  it("carries the page's own measured text, not a description of it", () => {
    const prompt = buildSolutionDraftPrompt(input());

    expect(prompt).toContain("https://acme.test/chart");
    expect(prompt).toContain("current title: Chart");
    expect(prompt).toContain("confirmed target query: natal chart");
    expect(prompt).toContain("Enter a birth date to draw a chart.");
    expect(prompt).toContain("Chart | How to read it");
  });

  it("says a field is absent rather than leaving the model to guess", () => {
    const prompt = buildSolutionDraftPrompt(
      input({ title: null, targetQuery: null, headings: [] }),
    );

    // An empty slot reads as "anything goes here"; naming the absence is what
    // stops the model from inventing a title the page never had.
    expect(prompt).toContain("current title: (none on the page)");
    expect(prompt).toContain("confirmed target query: (the owner confirmed none)");
    expect(prompt).toContain("headings, in page order: (none captured)");
  });

  it("forbids promising what the page does not deliver", () => {
    const prompt = buildSolutionDraftPrompt(input());

    expect(prompt).toContain("Do not invent features, numbers, prices");
    expect(prompt).toContain("A weaker true line beats a stronger false one");
    expect(prompt).toContain("Nothing you write is applied automatically");
  });

  it("asks for the shape each kind is read back as", () => {
    expect(buildSolutionDraftPrompt(input())).toContain(
      '{"title": string, "metaDescription": string, "openingLine": string}',
    );
    expect(
      buildSolutionDraftPrompt(input({ kind: "heading-structure" })),
    ).toContain('{"h1": string, "h2": string[]}');
  });
});

describe("reading a reply", () => {
  it("accepts the exact shape", () => {
    const draft = readSolutionDraft(
      "search-presentation",
      JSON.stringify({
        title: "Free natal chart calculator",
        metaDescription: "Draw your natal chart from a birth date and time.",
        openingLine: "Enter a birth date to draw your chart.",
      }),
    );

    expect(draft).toMatchObject({
      kind: "search-presentation",
      title: "Free natal chart calculator",
      metaDescription: "Draw your natal chart from a birth date and time.",
      openingLine: "Enter a birth date to draw your chart.",
    });
  });

  describe("what the draft says about itself", () => {
    const reply = (title: string, metaDescription = "x".repeat(80)) =>
      JSON.stringify({
        title,
        metaDescription,
        openingLine: "Enter a birth date to draw your chart.",
      });

    it("measures the rewrite against the bands the prompt asked for", () => {
      // A draft offered to fix a title-length finding that itself overshoots
      // the band is the failure mode this reports. It is reported, not
      // refused: the sentence may still be better than what is on the page,
      // and the reader is the one who decides.
      const draft = readSolutionDraft(
        "search-presentation",
        reply("Chart"),
        null,
      );

      expect(draft).toMatchObject({
        review: { titleWidth: 5, titleWithinRange: false },
      });
    });

    it("counts a CJK character as two, the way a result row renders it", () => {
      const draft = readSolutionDraft(
        "search-presentation",
        reply("免费出生星盘计算器"),
        null,
      );

      expect(
        (draft as { review: { titleWidth: number } }).review.titleWidth,
      ).toBe(18);
    });

    it("says whether the confirmed query survived into the title", () => {
      expect(
        readSolutionDraft(
          "search-presentation",
          reply("Free natal chart calculator"),
          "natal chart",
        ),
      ).toMatchObject({ review: { titleContainsTargetQuery: true } });

      expect(
        readSolutionDraft(
          "search-presentation",
          reply("Free birth wheel calculator"),
          "natal chart",
        ),
      ).toMatchObject({ review: { titleContainsTargetQuery: false } });
    });

    it("judges the query the way 2.3 does, not as loose letters", () => {
      // A substring reading called this a survival: `cat` is in `Catalog`.
      // The check the draft exists to satisfy reads word sequences, so a
      // draft reported as keeping the query would still have failed 2.3.
      expect(
        readSolutionDraft(
          "search-presentation",
          reply("Catalog software for teams"),
          "cat",
        ),
      ).toMatchObject({ review: { titleContainsTargetQuery: false } });

      expect(
        readSolutionDraft(
          "search-presentation",
          reply("The cat sitting guide"),
          "cat",
        ),
      ).toMatchObject({ review: { titleContainsTargetQuery: true } });
    });

    it("reports nothing about a query the owner never confirmed", () => {
      // `false` would read as a defect in the draft rather than the absence of
      // anything to look for.
      expect(
        readSolutionDraft("search-presentation", reply("Anything"), null),
      ).toMatchObject({ review: { titleContainsTargetQuery: null } });
    });

    it("publishes the draft even when it misses every band", () => {
      expect(
        readSolutionDraft("search-presentation", reply("Chart", "Short"), "x"),
      ).not.toBeNull();
    });
  });

  it.each([
    ["not JSON at all", "Here is your title: Free natal chart"],
    ["a JSON array", "[]"],
    ["a missing field", '{"title":"T","metaDescription":"D"}'],
    ["an empty field", '{"title":"T","metaDescription":"D","openingLine":"  "}'],
    ["a non-string field", '{"title":"T","metaDescription":"D","openingLine":4}'],
  ])("refuses %s", (_label, reply) => {
    // A reply that is merely close would be shown beside measured evidence with
    // the same weight, and a dropped field renders as an empty box the reader
    // takes for "we found nothing to say".
    expect(readSolutionDraft("search-presentation", reply)).toBeNull();
  });

  it("refuses an outline shorter than the one it asked for", () => {
    const short = readSolutionDraft(
      "heading-structure",
      JSON.stringify({ h1: "Draw a natal chart", h2: ["Enter a birth time"] }),
    );
    const whole = readSolutionDraft(
      "heading-structure",
      JSON.stringify({
        h1: "Draw a natal chart",
        h2: ["Enter a birth time", "Read the houses", "Save the chart"],
      }),
    );

    // One heading back from a request for three or more is a reply that lost
    // fields, not a shorter outline.
    expect(short).toBeNull();
    expect(whole).toMatchObject({ kind: "heading-structure" });
  });

  it("drops a reply whose field is long enough to be prose", () => {
    expect(
      readSolutionDraft(
        "search-presentation",
        JSON.stringify({
          title: "T".repeat(400),
          metaDescription: "D",
          openingLine: "O",
        }),
      ),
    ).toBeNull();
  });
});
