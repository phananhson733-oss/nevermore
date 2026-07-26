import { describe, expect, it } from "vitest";
import {
  flattenLine,
  hasDirectNegation,
  isReferenceSectionTitle,
  paragraphBlocks,
  partitionDraft,
  readDraft,
  referenceSectionStandard,
  sentenceCount,
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

  /**
   * `---` under an ATX heading is a thematic break: the line above it is
   * already a heading, so there is no paragraph for an underline to promote.
   * Read as a setext title it rewrote `# Onboarding analytics` into
   * `## # Onboarding analytics` AND pushed a second entry onto the heading
   * spine for the same line — and `partitionDraft` keys its sections by line,
   * so the duplicate would quietly replace the real H1 with a level-2 heading
   * whose text still carries a `#`.
   */
  it("does not read an underline under an ATX heading as a heading", () => {
    const view = readDraft(
      ["# Onboarding analytics", "---", "", "Body."].join("\n"),
    );

    expect(view.headings).toStrictEqual([
      { line: 1, level: 1, text: "Onboarding analytics" },
    ]);
    expect(view.prose[0]?.text).toBe("# Onboarding analytics");
  });

  /**
   * An underline promotes a one-line PARAGRAPH. A table row and a blockquote
   * are neither, and promoting one invents a section boundary in the middle of
   * a table — or makes a quoted line the section title every reference matcher
   * reads, which is how a body region ends up cut out of the half the red lines
   * scan.
   */
  it("refuses an underline over a line that is not a paragraph", () => {
    for (const title of [
      "| Source | Year |",
      "> Forrester puts churn at 42%.",
    ]) {
      const view = readDraft([title, "---", "", "Body."].join("\n"));

      expect(view.headings, title).toStrictEqual([]);
      expect(view.prose[0]?.text, title).toBe(title);
    }
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

describe("reference-section standard", () => {
  /**
   * The split that made three headings meaning the same thing behave the same
   * way. Before it, `## Further reading` and `## See Also` listing the
   * customer's own pages were blocked while `## Related links` passed.
   */
  it("tells an evidence heading from a navigation one", () => {
    for (const title of [
      "Sources",
      "References",
      "Citations",
      "Works Cited",
      "Bibliography",
      "Footnotes",
      "Additional sources",
      "参考文献",
    ]) {
      expect(referenceSectionStandard(title), title).toBe("evidence");
    }
    for (const title of [
      "Further Reading",
      "Related Reading",
      "See Also",
      "延伸阅读",
    ]) {
      expect(referenceSectionStandard(title), title).toBe("locator");
    }
  });

  /** Evidence wins a tie: the weaker word does not withdraw the promise. */
  it("keeps a mixed heading on the evidence standard", () => {
    expect(referenceSectionStandard("Sources and further reading")).toBe(
      "evidence",
    );
    expect(referenceSectionStandard("References and notes")).toBe("evidence");
  });

  it("still calls an ordinary body heading neither", () => {
    expect(
      referenceSectionStandard("Sources of onboarding friction"),
    ).toBeNull();
    expect(referenceSectionStandard("Related links")).toBeNull();
  });
});

describe("draft partition", () => {
  /**
   * A heading NAMES a region; it cannot make the region be what it says.
   *
   * The heading text had a guard and what followed it had none, so a bold
   * `**Further reading**` — which models write constantly — claimed the next
   * two paragraphs of ordinary prose, and every non-empty line under it was
   * read as a reference entry. Two honest sentences were reported as references
   * resolving to nothing at authority D.
   */
  it("does not claim a region that is prose rather than entries", () => {
    const partition = partitionDraft(
      readDraft(
        [
          "**Further reading**",
          "",
          "Teams that instrument activation once keep the weekly review going.",
          "The same habit keeps the milestone from drifting.",
          "",
        ].join("\n"),
      ),
    );

    expect(partition.reference).toStrictEqual([]);
    expect(
      partition.body.some((line) => line.text.includes("weekly review")),
    ).toBe(true);
    // Even a `##` heading that says `Sources` does not claim running prose.
    expect(
      partitionDraft(
        readDraft(
          ["## Sources", "", "We wrote this from our own export.", ""].join(
            "\n",
          ),
        ),
      ).reference,
    ).toStrictEqual([]);
  });

  /** The partition stays TOTAL whichever way that decision goes. */
  it("keeps every prose line in exactly one half when a heading is refused", () => {
    const view = readDraft(
      [
        "# Title",
        "",
        "**Further reading**",
        "",
        "Ordinary prose that no heading may turn into a reference entry.",
        "",
        "## Sources",
        "",
        "- Forrester Digital Experience Report, 2024",
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
    expect(partition.reference).toHaveLength(1);
    expect(partition.reference[0]?.standard).toBe("evidence");
  });

  /**
   * A reference section runs to the next heading of the SAME OR HIGHER level,
   * so a deeper heading inside it is one of its lines rather than a new
   * section. That is what stops a nested `### Further reading` from re-opening
   * the region under the weaker LOCATOR standard: an entry may override its
   * section's standard upward on its own shape, never downward, and a locator
   * entry is answered completely by the customer's own address. Re-opening
   * here would also leave `## Sources` holding no line at all, so the heading
   * that made the evidence promise would be handed back to the body.
   */
  it("keeps a deeper reference heading inside the section it opened", () => {
    const view = readDraft(
      [
        "## Sources",
        "",
        "### Further reading",
        "",
        "- Forrester Digital Experience Report, 2024",
        "",
      ].join("\n"),
    );
    const partition = partitionDraft(view);

    expect(partition.reference).toHaveLength(1);
    expect(partition.reference[0]?.title).toBe("Sources");
    expect(partition.reference[0]?.standard).toBe("evidence");
    expect(
      partition.reference[0]?.lines.map((line) => line.text),
    ).toStrictEqual([
      "",
      "### Further reading",
      "",
      "- Forrester Digital Experience Report, 2024",
      "",
    ]);
    expect(partition.body).toStrictEqual([]);
  });

  /**
   * An ADDRESS is one of the entry forms the region predicate accepts. A
   * bibliography a model wrote as bare URLs carries no list marker and no name
   * phrase, so without that arm the whole section is handed back to the body —
   * and the only rule that resolves reference entries then reports, in a
   * persisted claim, that the draft lists no source entry at all.
   */
  it("claims a reference region whose entries are bare addresses", () => {
    const partition = partitionDraft(
      readDraft(
        [
          "## Sources",
          "",
          "https://analyst.example/2024-benchmark",
          "https://vendor.example/churn-report",
          "",
        ].join("\n"),
      ),
    );

    expect(partition.reference).toHaveLength(1);
    expect(partition.reference[0]?.standard).toBe("evidence");
    expect(partition.body).toStrictEqual([]);
  });

  /**
   * The same clause one step further out. A site-relative link carries no
   * `http`/`www`, so it is an address only the markdown-link reader can see; a
   * sources list written entirely as relative links would otherwise fall back
   * into the body for want of a single scheme.
   */
  it("claims a reference region whose entries are relative links", () => {
    const partition = partitionDraft(
      readDraft(
        [
          "## Sources",
          "",
          "[Forrester Digital Experience Report, 2024](/library/forrester-2024.pdf)",
          "",
        ].join("\n"),
      ),
    );

    expect(partition.reference).toHaveLength(1);
    expect(partition.reference[0]?.standard).toBe("evidence");
    expect(partition.body).toStrictEqual([]);
  });
});

describe("draft partition (existing shapes)", () => {
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

  /**
   * CommonMark allows BALANCED brackets in a link label, and the label pattern
   * did not. The cost was not a lost link: the unparsed URL went back into the
   * sentence text, where it was harvested as a bare url and classified as a
   * LOCATOR — and a first-party address answers a locator completely. So
   * `[Forrester](our-url) reports that 73% …` was blocked and `[Forrester
   * [Inc]](our-url) reports that 73% …` passed, on one pair of brackets.
   */
  it("parses a link label that contains balanced brackets", () => {
    const flat = flattenLine(
      "[Forrester [Inc]](https://analyst.example/x) reports that 73% churn.",
    );

    expect(flat.text).toBe("Forrester [Inc] reports that 73% churn.");
    expect(flat.links).toStrictEqual([
      {
        start: 0,
        end: "Forrester [Inc]".length,
        label: "Forrester [Inc]",
        target: "https://analyst.example/x",
      },
    ]);
    // The url never leaks back into the sentence, which is what let it be read
    // as a locator instead of as the evidence the sentence attributes to.
    expect(flat.urls).toStrictEqual([]);
  });

  /**
   * The destination half of the same scan. CommonMark allows BALANCED
   * parentheses in a link destination and encyclopedia-style URLs use them, so
   * stopping at the first `)` truncates the target. A truncated target is not a
   * lost link — it is a DIFFERENT address, which resolves against no source the
   * pack holds, so the sentence comes back attributed to nothing at authority D
   * while its link was perfectly good.
   */
  it("parses a link destination that contains balanced parentheses", () => {
    const flat = flattenLine(
      "[Churn benchmark](https://analyst.example/wiki/Churn-rate-(SaaS)) reports 73% churn.",
    );

    expect(flat.text).toBe("Churn benchmark reports 73% churn.");
    expect(flat.links).toHaveLength(1);
    expect(flat.links[0]?.target).toBe(
      "https://analyst.example/wiki/Churn-rate-(SaaS)",
    );
    expect(flat.urls).toStrictEqual([]);
  });

  /**
   * An escaped bracket does not open link syntax, so a reader sees the literal
   * `[label](url)` — address and all. The flattened line has to read the way
   * the reader reads it: no link to credit the sentence with, and the address
   * still standing in the text where a bare-url rule can see it.
   */
  it("does not read an escaped bracket as the start of a link", () => {
    const flat = flattenLine(
      "\\[Forrester](https://analyst.example/x) reports 73% churn.",
    );

    expect(flat.links).toStrictEqual([]);
    expect(flat.urls.map((url) => url.value)).toStrictEqual([
      "https://analyst.example/x",
    ]);
  });

  /**
   * The mirror image, and the same failure the balanced-bracket case above
   * carries: an escaped `]` inside a label must not close it. Closing there
   * finds no `(` after the label, so the link is not parsed at all, the raw URL
   * goes back into the sentence text, and it is harvested as a bare url — a
   * LOCATOR, which a first-party address answers completely. The sentence would
   * pass on one backslash.
   */
  it("does not let an escaped bracket close a link label", () => {
    const flat = flattenLine(
      "[Forrester \\] Inc](https://analyst.example/x) reports 73% churn.",
    );

    expect(flat.links).toHaveLength(1);
    expect(flat.links[0]?.target).toBe("https://analyst.example/x");
    expect(flat.links[0]?.start).toBe(0);
    expect(flat.urls).toStrictEqual([]);
    expect(flat.text.endsWith(" reports 73% churn.")).toBe(true);
  });

  it("still refuses the shapes that are not links", () => {
    for (const line of [
      "[Forrester(https://analyst.example/x) reports 73%.",
      "[Forrester](https://analyst.example/x reports 73%.",
      "[Forrester]() reports 73%.",
      "Churn fell 42%.[^1]",
    ]) {
      expect(flattenLine(line).links, line).toStrictEqual([]);
    }
    expect(
      flattenLine('[Forrester](https://analyst.example/x "title") reports.')
        .links[0]?.target,
    ).toBe("https://analyst.example/x");
  });

  /**
   * Emphasis is typography, never a token. `Forrester's **2024** data puts
   * churn at 42%` read as a different sentence from the unemphasised one to
   * every matcher in the gate, and the emphasised one passed.
   */
  it("removes emphasis so a marked-up sentence reads as the plain one", () => {
    expect(
      flattenLine("Forrester's **2024** data puts churn at 42%.").text,
    ).toBe("Forrester's 2024 data puts churn at 42%.");
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

describe("sentence counting", () => {
  /**
   * Sentence terminators, with a floor of 1 for ANY NON-EMPTY text — both
   * halves of that sentence do work. SC3 reads the count off every block to
   * find a wall, and SC3b takes the median across the narrative paragraphs, so
   * a paragraph a model wrote without a terminator has to count as the one
   * sentence a reader reads, while text with nothing in it has to count as
   * none rather than as a phantom sentence the floor invented.
   */
  it("floors non-empty text at one sentence and empty text at none", () => {
    expect(sentenceCount("Churn fell 42% last quarter")).toBe(1);
    expect(sentenceCount("Alpha claim. Beta claim.")).toBe(2);
    expect(sentenceCount("")).toBe(0);
    expect(sentenceCount("   \t ")).toBe(0);
  });
});

describe("paragraph blocks", () => {
  /**
   * `block.lines` is the only thing separating a bibliography entry written
   * without a list marker from the running text around it: a prose block is an
   * entry position exactly when it was joined from ONE source line. So
   * consecutive prose lines have to join and carry the count, while a line that
   * is a list in a markup `-`/`*` does not cover — an HTML list element, a
   * definition-list term — has to stand alone. Joined into the surrounding
   * paragraph, such an entry stops occupying an entry position, and the
   * bibliography written in either markup walks past the whole gate.
   *
   * A heading is a boundary and never a block of its own, which is the property
   * the per-section checks rely on when they group a section's own paragraphs.
   */
  it("joins prose lines and gives a markup list line its own block", () => {
    const blocks = paragraphBlocks(
      readDraft(
        [
          "First line of the paragraph",
          "second line of the same paragraph.",
          "",
          "<li>Forrester Digital Experience Report, 2024</li>",
          ": Gartner Market Guide, 2024",
          "",
          "## Sources",
          "Tail paragraph.",
          "",
        ].join("\n"),
      ).prose,
    );

    expect(
      blocks.map((block) => [block.line, block.lines, block.text]),
    ).toStrictEqual([
      [1, 2, "First line of the paragraph second line of the same paragraph."],
      [4, 1, "<li>Forrester Digital Experience Report, 2024</li>"],
      [5, 1, ": Gartner Market Guide, 2024"],
      [8, 1, "Tail paragraph."],
    ]);
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
