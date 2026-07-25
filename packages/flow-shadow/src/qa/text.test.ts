import { describe, expect, it } from "vitest";
import {
  flattenLine,
  hasDirectNegation,
  isReferenceSectionTitle,
  partitionDraft,
  readDraft,
  sentenceSpanAt,
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

  /**
   * The second half of the same defect. A CLOSING delimiter was accepted as
   * proof that the region between the two `---` lines was metadata, so a draft
   * that opens with a thematic break and uses another one later had its whole
   * first content block masked — and the two fabricated attributions inside it
   * were judged by rules that had read nothing.
   *
   * The mask now requires the region to LOOK like frontmatter. When it does
   * not, nothing is removed, which is the invariant that makes the mask safe:
   * content is either metadata by shape, or it is still scanned.
   */
  it("refuses to mask a region between two thematic breaks", () => {
    const view = readDraft(
      [
        "---",
        "",
        "# Onboarding analytics",
        "",
        "Gartner found that 73% of teams abandon activation tracking.",
        "",
        "---",
        "",
        "## Audience",
        "",
      ].join("\n"),
    );

    expect(
      view.prose.some((line) => line.text.includes("Gartner found that 73%")),
    ).toBe(true);
    expect(view.headings.map((heading) => heading.text)).toStrictEqual([
      "Onboarding analytics",
      "Audience",
    ]);
  });

  /** Real frontmatter is still masked, and still only up to its delimiter. */
  it("masks a `key: value` block and stops at its delimiter", () => {
    const view = readDraft(
      [
        "---",
        "title: draft",
        "tags:",
        "  - onboarding",
        "---",
        "",
        "Gartner found that 73% of teams abandon activation tracking.",
        "",
      ].join("\n"),
    );

    expect(view.prose.slice(0, 5).every((line) => line.text === "")).toBe(true);
    expect(view.prose[6]?.text).toContain("Gartner found");
  });

  /**
   * Whatever the frontmatter mask covers has to be metadata, not prose. This is
   * the property the two defects above violated, stated as an invariant rather
   * than as two repaired cases.
   */
  it("never masks a heading or a sentence as frontmatter", () => {
    for (const draft of [
      ["---", "", "# Heading", "", "Body.", "", "---", "", "More body.", ""],
      ["---", "Not a key value line", "---", "", "Body.", ""],
      ["---", "- just", "- a list", "---", "", "Body.", ""],
    ]) {
      const view = readDraft(draft.join("\n"));
      const masked = view.prose.filter(
        (line, index) => line.text === "" && (draft[index] ?? "").trim() !== "",
      );

      expect(masked, draft.join(" | ")).toStrictEqual([]);
    }
  });
});

describe("setext headings", () => {
  /**
   * `Sources` over `-------` renders as `## Sources`. The ATX-only reader saw a
   * paragraph, so the fabricated bibliography under it was never partitioned
   * out and the only rule that resolves reference entries reported that the
   * draft was headed by no reference list at all.
   */
  it("reads an underlined title as the heading it renders as", () => {
    const view = readDraft(
      ["Sources", "-------", "", "- Forrester, 2024", ""].join("\n"),
    );

    expect(view.headings).toStrictEqual([
      { line: 1, level: 2, text: "Sources" },
    ]);
    expect(view.prose[0]?.text).toBe("## Sources");
    expect(partitionDraft(view).reference).toHaveLength(1);
  });

  it("reads `===` as an H1 and leaves the line numbers alone", () => {
    const view = readDraft(["Title", "=====", "", "Body."].join("\n"));

    expect(view.headings[0]).toStrictEqual({
      line: 1,
      level: 1,
      text: "Title",
    });
    expect(view.prose.map((line) => line.line)).toStrictEqual([1, 2, 3, 4]);
  });

  /**
   * The conservative half. A multi-line paragraph under an underline is a
   * heading in CommonMark too, but converting it would move a paragraph of
   * prose out of the body, and this reader never trades scanned content for a
   * guess.
   */
  it("leaves a multi-line paragraph in the body", () => {
    const view = readDraft(
      ["First line of prose", "second line of prose", "---", ""].join("\n"),
    );

    expect(view.headings).toStrictEqual([]);
    expect(view.prose[1]?.text).toBe("second line of prose");
  });

  it("does not turn a table delimiter row into a heading", () => {
    const view = readDraft(
      ["| Source | Year |", "| --- | --- |", "| Forrester | 2024 |", ""].join(
        "\n",
      ),
    );

    expect(view.headings).toStrictEqual([]);
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
   * The forms a model actually types that the recogniser could not see. Each
   * differs from a heading it DID recognise by punctuation, a qualifier or a
   * script — never by meaning — and each hid a fabricated bibliography behind a
   * `passed` verdict.
   */
  it("recognises the same heading through its punctuation and script", () => {
    for (const title of [
      "Sources:",
      "Sources：",
      "References (external)",
      "Notes and Sources",
      "See Also",
      "参考文献",
      "參考文獻",
      "延伸阅读",
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

  /**
   * A bold line standing in for a heading. It is claimed ONLY when the bold
   * text is a reference title, so every other bold span — including the one
   * SC1 looks for — is untouched.
   */
  it("treats a bold line as a heading only when it titles a reference list", () => {
    const reference = partitionDraft(
      readDraft(["**Sources**", "", "- Forrester, 2024", ""].join("\n")),
    );
    expect(reference.reference).toHaveLength(1);
    expect(reference.reference[0]?.title).toBe("Sources");
    expect(reference.body).toStrictEqual([]);

    const prose = partitionDraft(
      readDraft(["**Onboarding analytics**", "", "Body.", ""].join("\n")),
    );
    expect(prose.reference).toStrictEqual([]);
    expect(prose.body.some((line) => line.text === "Body.")).toBe(true);
  });

  it("closes a bold pseudo-heading at the next real heading", () => {
    const partition = partitionDraft(
      readDraft(
        [
          "**Sources**",
          "",
          "- Forrester, 2024",
          "",
          "# Title",
          "",
          "Body.",
          "",
        ].join("\n"),
      ),
    );

    expect(partition.body.some((line) => line.text === "Body.")).toBe(true);
    expect(
      partition.reference[0]?.lines.some((line) => line.text === "Body."),
    ).toBe(false);
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

describe("flattened lines carry positions", () => {
  /**
   * The primitive root cause two needed. Asking "what appears anywhere on this
   * line?" pulled the customer's own host out of another url's QUERY STRING and
   * offered it as an attribution.
   */
  it("gives a url one span, so nothing is read out of its inside", () => {
    const flat = flattenLine(
      "See https://attacker.test/?u=https://signalframe.example/ for the chart.",
    );

    expect(flat.urls).toHaveLength(1);
    expect(flat.urls[0]?.value).toBe(
      "https://attacker.test/?u=https://signalframe.example/",
    );
    expect(
      flat.text.indexOf("signalframe.example") >= (flat.urls[0]?.start ?? 0) &&
        flat.text.indexOf("signalframe.example") < (flat.urls[0]?.end ?? 0),
    ).toBe(true);
  });

  /**
   * A link is replaced by its LABEL, so the sentence reads as a reader reads
   * it. `[Forrester](url) reports that 73% …` matched no assertion pattern at
   * all while the name was wrapped in link syntax.
   */
  it("replaces a link with its label and keeps the target reachable", () => {
    const flat = flattenLine(
      "[Forrester](https://analyst.example/x) reports that 73% churn.",
    );

    expect(flat.text).toBe("Forrester reports that 73% churn.");
    expect(flat.links[0]).toStrictEqual({
      start: 0,
      end: "Forrester".length,
      label: "Forrester",
      target: "https://analyst.example/x",
    });
    expect(flat.urls).toStrictEqual([]);
  });

  it("blanks inline code before anything else reads the line", () => {
    expect(
      flattenLine("We rejected `research shows X` as a prompt.").text,
    ).toBe("We rejected   as a prompt.");
  });

  it("bounds a sentence at its own terminator", () => {
    const text = "Alpha claim. Beta claim. Gamma claim.";

    expect(sentenceSpanAt(text, 0)).toStrictEqual({ start: 0, end: 12 });
    expect(sentenceSpanAt(text, 15)).toStrictEqual({ start: 12, end: 24 });
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
