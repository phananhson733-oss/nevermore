import { describe, expect, it } from "vitest";

import {
  geoBriefSubtopics,
  GEO_BRIEF_MAX_SUBTOPICS,
  GEO_BRIEF_MAX_SUBTOPIC_CHARS,
  geoBriefSubtopicEvidence,
} from "./brief-subtopics.ts";

describe("geoBriefSubtopics", () => {
  it("retains candidate counts beyond the display and evidence caps", () => {
    const answer = Array.from({ length: 53 }, (_, index) => `## Topic ${index + 1}`).join("\n");
    expect(geoBriefSubtopicEvidence(answer)).toMatchObject({ candidateCount: 53, omittedCount: 3 });
    expect(geoBriefSubtopicEvidence(answer).items).toHaveLength(50);
  });
  it("reads the headings an answer separated itself with", () => {
    const answer = [
      "Here are the main options.",
      "",
      "## Pricing",
      "Most tools charge per seat.",
      "",
      "### Who it is for",
      "Mid-market operations teams.",
    ].join("\n");

    expect(geoBriefSubtopics(answer)).toEqual(["Pricing", "Who it is for"]);
  });

  it("keeps a list item's lead-in and drops the claim after it", () => {
    // The claim is another company's number. A sampled answer decides what the
    // page has to answer; it never contributes a fact.
    const answer = [
      "- Pricing: starts at $29 per seat for teams of five or more",
      "- Integrations — connects to Slack, Jira and Linear",
      "1. Support: 24/7 chat on the enterprise plan",
    ].join("\n");

    expect(geoBriefSubtopics(answer)).toEqual([
      "Pricing",
      "Integrations",
      "Support",
    ]);
  });

  it("reads a bold lead-in as the heading it is standing in for", () => {
    expect(geoBriefSubtopics("**Onboarding**: takes about a week")).toEqual([
      "Onboarding",
    ]);
  });

  it("strips inline markup so one subtopic does not survive twice", () => {
    const answer = ["## **Pricing**", "- `Pricing`: per seat"].join("\n");
    expect(geoBriefSubtopics(answer)).toEqual(["Pricing"]);
  });

  it("keeps the link text and drops the target", () => {
    expect(geoBriefSubtopics("## [Security](https://example.test/sec)")).toEqual([
      "Security",
    ]);
  });

  it("returns nothing for prose rather than inventing structure", () => {
    // The brief reports this as a run limit. Splitting a paragraph into
    // "subtopics" would be the tool manufacturing the evidence it claims to
    // have observed.
    const answer =
      "There are several good options depending on your team size and budget.";
    expect(geoBriefSubtopics(answer)).toEqual([]);
  });

  it("stops at the bound instead of returning a table of contents", () => {
    const answer = Array.from(
      { length: GEO_BRIEF_MAX_SUBTOPICS + 5 },
      (_, index) => `## Section ${index + 1}`,
    ).join("\n");
    expect(geoBriefSubtopics(answer)).toHaveLength(GEO_BRIEF_MAX_SUBTOPICS);
  });

  it("drops a heading that is really a paragraph", () => {
    const long = "x".repeat(GEO_BRIEF_MAX_SUBTOPIC_CHARS + 1);
    expect(geoBriefSubtopics(`## ${long}`)).toEqual([]);
  });

  it("drops a fragment too short to be a thing to answer", () => {
    expect(geoBriefSubtopics("- ok")).toEqual([]);
  });

  it("does not read a fenced code line as a bullet", () => {
    // `- name: value` inside a config block is not a subtopic, but it is also
    // not worth a parser: what matters is that the heading beside it wins and
    // the fragment rules keep the noise out.
    expect(geoBriefSubtopics("## Configuration\n- id: 7")).toEqual([
      "Configuration",
    ]);
  });
});
