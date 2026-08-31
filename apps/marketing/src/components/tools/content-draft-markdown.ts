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
  const provenance = draftGeoProvenanceMarkdown(result);
  return `${[title, ...sections, ...(provenance === "" ? [] : [provenance])].join("\n\n")}\n`;
}

/** GEO-only appendices preserve the evidence chain without altering authored sentence bytes. */
export function draftGeoProvenanceMarkdown(result: DraftResult): string {
  const origin = result.brief_ref.geo_origin;
  const evidence = result.brief_ref.evidence;
  if (origin === undefined || evidence === undefined) return "";
  const lines = ["## geo_origin", `question: ${origin.question.text}`, `question_id: ${origin.question.id ?? "manual"} · role: ${origin.role ?? "none"}`, `kind: ${origin.kind} · layer: ${origin.layer ?? "unavailable"} · gap: ${origin.gap ?? "none"}`, `kb_ref: ${origin.kb_ref.kb_id} · ${origin.kb_ref.snapshot_id} · v${origin.kb_ref.revision} · ${origin.kb_ref.content_hash}`, `promptset_ref: ${origin.promptset_ref.schema} · ${origin.promptset_ref.registry_version} · ${origin.promptset_ref.hash}`, `profile_ref: ${origin.profile_ref === null ? "none" : JSON.stringify(origin.profile_ref)}`, `run_ref: ${origin.run_ref === null ? "none (manual; no observed run)" : `${origin.run_ref.id} · ${origin.run_ref.fingerprint}`}`, "", "## evidence"];
  for (const fact of evidence.facts) lines.push(`- ${fact.id} · source=${fact.source} · ${fact.observed_at} · ${fact.url ?? "no URL"}: ${fact.text}`);
  for (const sample of evidence.samples) lines.push(`- ${sample.id} · ai_sample (topic evidence only; not a fact source) · ${sample.engine} · ${sample.status} · ${sample.collected_at}: ${sample.excerpt}`);
  for (const page of evidence.site_index) lines.push(`- ${page.id} · site_index · ${page.observed_at} · ${page.url}: ${page.title}`);
  return lines.join("\n");
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
