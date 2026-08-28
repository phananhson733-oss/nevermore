// @input  -- one DraftResult and the two locale-specific notes for sections without a body
// @output -- the Markdown the copy button hands out, and the JSON the export button writes
// @pos    -- handoff §5.5: screen, Markdown and JSON are projections of the SAME DraftResult;
//            this module is the Markdown one, pure so a test can hold it to the screen

import type {
  DraftResult,
  DraftSection,
} from "@sf/public-tools/content-brief/contract";

export interface MarkdownNotes {
  /** Printed under a failed section's heading; receives the closed fail reason. */
  readonly failed: (reason: string) => string;
  /** Printed under a skipped section's heading. */
  readonly skipped: string;
}

/**
 * Every section keeps its H2, body or not.
 *
 * A failed or skipped section prints its heading followed by a one-line
 * blockquote saying why there is no body. Dropping the heading would make the
 * Markdown's outline disagree with the screen's, and the Playwright check of
 * handoff §8 item 29 compares exactly that list.
 */
function sectionMarkdown(section: DraftSection, notes: MarkdownNotes): string {
  const heading = `## ${section.h2}`;
  if (section.status === "failed") {
    return `${heading}\n\n> ${notes.failed(section.fail_reason)}`;
  }
  if (section.status === "skipped") {
    return `${heading}\n\n> ${notes.skipped}`;
  }
  // Sentences are joined verbatim: no marker, no bracket, no footnote. A gap
  // sentence in the Markdown must read character for character like the one
  // on screen, or the verify list stops pointing at the text it names.
  const paragraphs = section.body.paragraphs.map((paragraph) =>
    paragraph.sentences.map((sentence) => sentence.text).join(" "),
  );
  return [heading, ...paragraphs].join("\n\n");
}

export function draftMarkdown(result: DraftResult, notes: MarkdownNotes): string {
  const title = `# ${result.brief_ref.keyword}`;
  const sections = result.sections.map((section) =>
    sectionMarkdown(section, notes),
  );
  return `${[title, ...sections].join("\n\n")}\n`;
}

/** The H2 lines of a Markdown document, in order, without the marker. */
export function markdownHeadings(markdown: string): readonly string[] {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice("## ".length));
}

/** The exact object, fingerprint included, as the file the export button writes. */
export function draftExportJson(result: DraftResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** The sentence texts the screen underlines as gaps, in document order. */
export function gapSentences(result: DraftResult): readonly string[] {
  return result.sections.flatMap((section) =>
    section.status === "ok"
      ? section.body.paragraphs.flatMap((paragraph) =>
          paragraph.sentences
            .filter((sentence) => sentence.claim === "gap")
            .map((sentence) => sentence.text),
        )
      : [],
  );
}
