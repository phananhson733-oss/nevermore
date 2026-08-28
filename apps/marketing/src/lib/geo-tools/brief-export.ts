// @input  -- one assembled brief and the labels the page renders it with
// @output -- the Markdown both the download and the copy button hand out
// @pos    -- one text, two buttons; no i18n lives here

import type { GeoBrief } from "./brief-contract.ts";

/**
 * The words. Supplied by the caller, never written here.
 *
 * The rule this repo keeps: engines return structure and the interface supplies
 * copy. A Markdown builder with English headings baked in would be a second
 * place where the product speaks, and the Chinese page would quietly export an
 * English document.
 */
export interface GeoBriefExportLabels {
  readonly title: string;
  readonly question: string;
  readonly leadAnswer: string;
  readonly requiredEntities: string;
  readonly mustAnswer: string;
  readonly outline: string;
  readonly facts: string;
  readonly wontSay: string;
  readonly citedDomains: string;
  readonly limits: string;
  readonly notVerified: string;
  readonly sourceKb: string;
  readonly sourceCrawl: string;
  readonly sourceSample: string;
  readonly sourceModel: string;
  readonly generatedAt: string;
  /** One line per limit key, already translated by the caller. */
  readonly limitLines: readonly string[];
}

function sourceLabel(
  source: string,
  labels: GeoBriefExportLabels,
): string {
  switch (source) {
    case "kb":
      return labels.sourceKb;
    case "crawl":
      return labels.sourceCrawl;
    case "ai_sample":
      return labels.sourceSample;
    default:
      return labels.sourceModel;
  }
}

/**
 * Render the brief as Markdown.
 *
 * Every item carries where it came from, in the exported text as well as on the
 * page. That is the part most easily lost in an export: a writer pastes this
 * into a document, the provenance chips do not survive, and a subtopic another
 * company's answer happened to use reads as something the brand verified. The
 * words are inline for exactly that reason rather than being a legend at the
 * bottom that gets trimmed.
 */
export function geoBriefMarkdown(
  brief: GeoBrief,
  labels: GeoBriefExportLabels,
): string {
  const lines: string[] = [];
  lines.push(`# ${labels.title}`);
  lines.push("");
  lines.push(`**${labels.question}** ${brief.origin.questionText}`);
  lines.push("");

  lines.push(`## ${labels.leadAnswer}`);
  lines.push(brief.leadAnswer.requirement);
  if (brief.leadAnswer.requiredEntities.length > 0) {
    lines.push("");
    lines.push(`**${labels.requiredEntities}**`);
    for (const entity of brief.leadAnswer.requiredEntities) {
      lines.push(`- ${entity}`);
    }
  }
  lines.push("");

  lines.push(`## ${labels.mustAnswer}`);
  for (const item of brief.mustAnswer) {
    lines.push(`- ${item.text} _(${sourceLabel(item.source, labels)})_`);
  }
  lines.push("");

  if (brief.outline.length > 0) {
    lines.push(`## ${labels.outline}`);
    for (const section of brief.outline) {
      lines.push(`### ${section.heading}`);
      for (const id of section.answers) {
        const item = brief.mustAnswer.find((entry) => entry.id === id);
        if (item !== undefined) lines.push(`- ${item.text}`);
      }
      lines.push("");
    }
  }

  lines.push(`## ${labels.facts}`);
  for (const fact of brief.facts) {
    if (fact.value === null) {
      // Named, not omitted. A fact table that silently drops what it could not
      // verify reads as a shorter but complete table.
      lines.push(`- **${fact.key}**: ${labels.notVerified} (${fact.reason ?? ""})`);
      continue;
    }
    const source = fact.sourceUrl === null ? "" : ` — ${fact.sourceUrl}`;
    lines.push(
      `- **${fact.key}**: ${fact.value} _(${sourceLabel(fact.source, labels)})_${source}`,
    );
  }
  lines.push("");

  if (brief.wontSay.length > 0) {
    lines.push(`## ${labels.wontSay}`);
    for (const key of brief.wontSay) lines.push(`- ${key}`);
    lines.push("");
  }

  if (brief.citedDomains.length > 0) {
    lines.push(`## ${labels.citedDomains}`);
    for (const domain of brief.citedDomains) {
      lines.push(`- ${domain.domain}`);
      for (const url of domain.urls) lines.push(`  - ${url}`);
    }
    lines.push("");
  }

  lines.push(`## ${labels.limits}`);
  for (const line of labels.limitLines) lines.push(`- ${line}`);
  lines.push("");
  lines.push(`_${labels.generatedAt} ${brief.generatedAt}_`);

  return lines.join("\n");
}

/** A stable file name. No clock here; the brief carries its own timestamp. */
export function geoBriefFileName(brief: GeoBrief, extension: string): string {
  const stamp = brief.generatedAt.slice(0, 10);
  const slug = brief.origin.questionText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `geo-brief-${slug.length > 0 ? `${slug}-` : ""}${stamp}.${extension}`;
}
