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

    expect(draft).toEqual({
      kind: "search-presentation",
      title: "Free natal chart calculator",
      metaDescription: "Draw your natal chart from a birth date and time.",
      openingLine: "Enter a birth date to draw your chart.",
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
