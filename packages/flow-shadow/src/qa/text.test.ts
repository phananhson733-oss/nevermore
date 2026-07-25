import { describe, expect, it } from "vitest";
import {
  hasDirectNegation,
  isReferenceSectionTitle,
  partitionDraft,
  readDraft,
  truncateExcerpt,
} from "./text.ts";

describe("frontmatter masking", () => {
  it("masks a closed frontmatter block and nothing after it", () => {
    const view = readDraft(
      ["---", "title: draft", "---", "", "# Heading", "Body line.", ""].join(
        "\n",
      ),
    );

    expect(view.prose.slice(0, 3).every((line) => line.text === "")).toBe(true);
    expect(view.prose[5]?.text).toBe("Body line.");
    expect(view.headings.map((heading) => heading.text)).toStrictEqual([
      "Heading",
    ]);
  });

  /**
   * A leading `---` with no closing delimiter is a horizontal rule, which is
   * ordinary LLM output. Treating it as an unterminated frontmatter block
   * masked the entire draft, and every language rule then ran over an empty
   * document and reported that it had found nothing wrong.
   */
  it("treats an unclosed leading `---` as body, not as frontmatter", () => {
    const view = readDraft(
      ["---", "", "# Heading", "Body line.", ""].join("\n"),
    );

    expect(view.prose.some((line) => line.text === "Body line.")).toBe(true);
    expect(view.headings).toHaveLength(1);
  });
});

describe("reference-section recognition", () => {
  it("recognises the reference headings a model actually writes", () => {
    for (const title of [
      "Sources",
      "References",
      "Citations",
      "Works Cited",
      "Bibliography",
      "Further Reading",
      "Related Reading",
      "Sources and further reading",
      "References and notes",
      "Additional sources",
      "Footnotes",
    ]) {
      expect(isReferenceSectionTitle(title), title).toBe(true);
    }
  });

  /**
   * The bias is one-directional on purpose: an unrecognised heading stays in
   * the BODY, where the red lines scan it. Recognising a body section as a
   * reference list would report honest prose as unresolvable references.
   */
  it("leaves an ordinary body heading in the body", () => {
    for (const title of [
      "Sources of onboarding friction",
      "What onboarding analytics covers",
      "Evidence",
      "FAQ",
      "Call To Action",
      "How to read your activation report",
      // A link list is not a citation list. `## Related Links` under a B2B post
      // is usually the customer's own pages, and pulling it out of the body
      // would report every one of them as an unresolvable reference.
      "Related links",
    ]) {
      expect(isReferenceSectionTitle(title), title).toBe(false);
    }
  });
});

describe("draft partition", () => {
  /**
   * The structural invariant that replaced two hand-maintained title lists.
   *
   * The body used to be cut at four tail titles while the reference rule only
   * re-scanned two, so `## Further Reading` and `## Related Reading` fell into
   * a gap that NO rule read: a fabricated bibliography there was invisible to
   * rl8, rl12 and sc9b at once. Asserting a total partition is what makes that
   * gap unrepresentable rather than merely fixed.
   */
  it("assigns every prose line to exactly one half", () => {
    const view = readDraft(
      [
        "# Title",
        "",
        "## Body section",
        "",
        "Prose line.",
        "",
        "## Further Reading",
        "",
        "- Some reference",
        "",
        "## Another body section",
        "",
        "More prose.",
        "",
        "## Works Cited",
        "",
        "- Another reference",
        "",
      ].join("\n"),
    );
    const partition = partitionDraft(view);

    const covered = [
      ...partition.body.map((line) => line.line),
      ...partition.reference.flatMap((section) => [
        section.headingLine,
        ...section.lines.map((line) => line.line),
      ]),
    ].sort((left, right) => left - right);

    expect(covered).toStrictEqual(view.prose.map((line) => line.line));
    expect(new Set(covered).size).toBe(covered.length);
    expect(partition.reference.map((section) => section.title)).toStrictEqual([
      "Further Reading",
      "Works Cited",
    ]);
    expect(
      partition.body.some((line) => line.text === "More prose."),
      "a body section after a reference list stays in the body",
    ).toBe(true);
  });

  it("closes a reference section at the next same-level heading", () => {
    const view = readDraft(
      [
        "## Sources",
        "",
        "- One",
        "",
        "## Call To Action",
        "",
        "Do it.",
        "",
      ].join("\n"),
    );
    const partition = partitionDraft(view);

    expect(
      partition.reference[0]?.lines.some((line) =>
        line.text.includes("Do it."),
      ),
    ).toBe(false);
    expect(partition.body.some((line) => line.text === "Do it.")).toBe(true);
  });
});

describe("direct negation", () => {
  it("exempts a negator that governs the next noun", () => {
    for (const clause of ["No ", "**No ", "Not a single ", "There are no "]) {
      expect(hasDirectNegation(clause), clause).toBe(true);
    }
  });

  /**
   * The rhetorical openers the previous any-negator-in-the-clause rule ate.
   * Both of the sentences these clauses come from are fabrications.
   */
  it("does not exempt a negator that merely shares the clause", () => {
    for (const clause of [
      "There is no doubt that ",
      "Few operators know that a ",
      "Without exception the ",
      "It is not surprising that recent ",
    ]) {
      expect(hasDirectNegation(clause), clause).toBe(false);
    }
  });
});

describe("excerpt truncation", () => {
  /**
   * `jsonb` rejects unpaired surrogates, so a UTF-16 slice through an emoji
   * turned a good verdict into a failed insert.
   */
  it("never splits a surrogate pair", () => {
    const text = `${"x".repeat(118)}🚀 tail`;
    const cut = truncateExcerpt(text, 120);

    for (const unit of cut) {
      const code = unit.codePointAt(0) ?? 0;
      expect(code < 0xd800 || code > 0xdfff, JSON.stringify(cut)).toBe(true);
    }
    expect(JSON.stringify(cut)).not.toContain("\\ud");
  });

  it("counts the bound in code points, not code units", () => {
    expect(truncateExcerpt("🚀".repeat(10), 10)).toBe("🚀".repeat(10));
    expect([...truncateExcerpt("🚀".repeat(20), 10)]).toHaveLength(10);
  });
});
