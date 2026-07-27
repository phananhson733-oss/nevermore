import type { QaContext } from "./context.ts";
import {
  resolveAssertionSupport,
  resolveLinkProvenance,
  type Attribution,
} from "./claims.ts";
import { citationEntry } from "./names.ts";
import { longestCommonNgram } from "./ngram.ts";
import { fail, pass, unevaluable, type QaRuleResult } from "./rule-types.ts";
import { QA_THRESHOLDS } from "./thresholds.ts";
import {
  extractMarkdownLinks,
  extractUrls,
  isHeadingLine,
  isListItem,
  normalizeHeading,
  paragraphBlocks,
  sectionBody,
  sentenceCount,
  stripInlineCode,
  tokenize,
  truncateExcerpt,
  wordCount,
  type DraftLine,
  type ReferenceStandard,
} from "./text.ts";

/**
 * Structure checks, ported from the pinned Flow tooling (SC1-SC11, including the
 * SC3b/SC3c/SC9b variants), plus one addition (SC-DUP).
 *
 * Two boundaries this file must respect:
 *
 * 1. **These check the fixed drafting scaffold, never the brief's sections.**
 *    `briefOutline.briefSections` is a COVERAGE CHECKLIST (decision O-6), not a
 *    document structure. Asserting the draft's headings against it would fail by
 *    construction, because the two describe different things on purpose. The
 *    coverage question lives in `coverage.ts`; nothing here reads briefSections.
 * 2. **`english_blog_draft` is free-form markdown.** Its validator does not
 *    require any section, and tightening that validator now would retroactively
 *    invalidate already-minted revisions. So the section expectations here are
 *    SOFT: `sc5`/`sc8`/`sc9`/`sc10` are advisory, and only the resolve-to-pack
 *    check (`sc9b`) can block.
 */

export interface StructureCheck {
  readonly id: string;
  readonly title: string;
}

/** The ported structure vocabulary, in evaluation order. */
export const STRUCTURE_CHECKS: readonly StructureCheck[] = [
  {
    id: "sc1_bolded_definition",
    title: "Opening section states a bold definition",
  },
  { id: "sc2_internal_link_density", title: "Internal link density" },
  { id: "sc3_paragraph_wall", title: "No paragraph walls" },
  {
    id: "sc3b_paragraph_fragmentation",
    title: "Paragraphs are not all one-liners",
  },
  {
    id: "sc3c_section_scatter",
    title: "Sections are not undivided prose runs",
  },
  { id: "sc4_link_distribution", title: "Link distribution" },
  { id: "sc5_faq_section", title: "FAQ section carries real questions" },
  { id: "sc6_h1_value_prop", title: "H1 is more than the bare keyword" },
  {
    id: "sc7_snippet_bullets",
    title: "Opening section carries snippet bullets",
  },
  { id: "sc8_cta_anchor", title: "Calls to action use descriptive anchors" },
  { id: "sc9_sources_section", title: "Sources section present" },
  {
    id: "sc9b_sources_resolve_to_pack",
    title: "Sources entries resolve to a source",
  },
  { id: "sc10_table_integrity", title: "Tables are complete" },
  { id: "sc11_banned_headings", title: "No template-shaped headings" },
  {
    id: "scdup_brief_overlap",
    title: "Draft is not a restatement of the brief",
  },
];

interface Finding {
  readonly line: number;
  readonly excerpt: string;
}

function excerptList(findings: readonly Finding[]): string {
  const shown = findings.slice(0, QA_THRESHOLDS.maxReportedFindings);
  const rendered = shown
    .map(
      (finding) =>
        `line ${finding.line}: "${truncateExcerpt(finding.excerpt, QA_THRESHOLDS.maxExcerptChars)}"`,
    )
    .join("; ");
  const rest = findings.length - shown.length;
  return rest > 0 ? `${rendered}; and ${rest} more` : rendered;
}

/** Body lines grouped by heading-delimited section. */
function sectionsOfBody(context: QaContext): readonly (readonly DraftLine[])[] {
  const sections: DraftLine[][] = [];
  let current: DraftLine[] = [];
  for (const entry of context.body) {
    if (isHeadingLine(entry.text)) {
      if (current.length > 0) sections.push(current);
      current = [];
      continue;
    }
    current.push(entry);
  }
  if (current.length > 0) sections.push(current);
  return sections;
}

/** Body lines of the first `##` section, or `null` when the draft has none. */
function openingSection(context: QaContext): readonly DraftLine[] | null {
  const heading = context.view.headings.find((entry) => entry.level === 2);
  if (!heading) return null;
  const next = context.view.headings.find(
    (entry) => entry.line > heading.line && entry.level <= 2,
  );
  const limit = next ? next.line : Number.POSITIVE_INFINITY;
  return context.view.prose.filter(
    (entry) => entry.line > heading.line && entry.line < limit,
  );
}

export function checkSc1(context: QaContext): QaRuleResult {
  const opening = openingSection(context);
  if (opening === null) {
    // No H2 at all: the check has no subject. Reporting a failure here would
    // punish the same draft twice for one shape.
    return pass(
      "sc1_bolded_definition",
      "sc1_no_section",
      "The draft has no `##` section, so there is no opening definition to check.",
    );
  }
  const bolded = opening.some((entry) => /\*\*[^*\n]+\*\*/.test(entry.text));
  return bolded
    ? pass(
        "sc1_bolded_definition",
        "sc1_definition_present",
        "The opening section states a bold definition an answer engine can lift.",
      )
    : fail(
        "sc1_bolded_definition",
        "sc1_definition_missing",
        "The opening section states no bold definition, so there is no direct-answer span to extract.",
      );
}

export function checkSc2(context: QaContext): QaRuleResult {
  // The frozen pack carries no own-domain list and no internal-link candidates,
  // so "internal" cannot be told from "external" here at all. Gating on a
  // distinction we cannot make would only produce noise; this becomes a real
  // gate in Slice 3, when publishing and link resolution exist.
  const links = context.body.flatMap((entry) =>
    extractMarkdownLinks(entry.text).map((link) => link.target),
  );
  return unevaluable(
    "sc2_internal_link_density",
    "sc2_no_own_domain_list",
    `Advisory (never gates): the frozen research pack carries no own-domain or internal-link candidate list, so internal links cannot be distinguished from external ones. The body carries ${links.length} link(s) in total; the internal-link ladder is not gated in Slice 2.`,
  );
}

export function checkSc3(context: QaContext): QaRuleResult {
  if (!context.english) {
    return unevaluable(
      "sc3_paragraph_wall",
      "sc3_locale_unsupported",
      "Sentence and word counts need segmentation: locale not supported by deterministic segmentation.",
    );
  }
  const walls: Finding[] = [];
  for (const block of paragraphBlocks(context.body)) {
    if (block.kind === "table") continue;
    const sentences = sentenceCount(block.text);
    const words = wordCount(block.text);
    if (
      sentences > QA_THRESHOLDS.sc3MaxSentences ||
      words > QA_THRESHOLDS.sc3MaxWords
    ) {
      walls.push({
        line: block.line,
        excerpt: `${sentences} sentences / ${words} words`,
      });
    }
  }
  return walls.length > 0
    ? fail(
        "sc3_paragraph_wall",
        "sc3_paragraph_wall",
        `${walls.length} block(s) exceed ${QA_THRESHOLDS.sc3MaxSentences} sentences or ${QA_THRESHOLDS.sc3MaxWords} words: ${excerptList(walls)}.`,
      )
    : pass(
        "sc3_paragraph_wall",
        "sc3_within_limits",
        `No block exceeds ${QA_THRESHOLDS.sc3MaxSentences} sentences or ${QA_THRESHOLDS.sc3MaxWords} words.`,
      );
}

export function checkSc3b(context: QaContext): QaRuleResult {
  if (!context.english) {
    return unevaluable(
      "sc3b_paragraph_fragmentation",
      "sc3b_locale_unsupported",
      "Sentence counts need segmentation: locale not supported by deterministic segmentation.",
    );
  }
  const prose = paragraphBlocks(context.body).filter(
    (block) => block.kind === "prose",
  );
  if (prose.length < QA_THRESHOLDS.sc3bMinParagraphs) {
    return pass(
      "sc3b_paragraph_fragmentation",
      "sc3b_too_few_paragraphs",
      `Advisory (never gates): ${prose.length} narrative paragraph(s) is below the ${QA_THRESHOLDS.sc3bMinParagraphs} needed to judge fragmentation.`,
    );
  }
  const counts = prose
    .map((block) => sentenceCount(block.text))
    .sort((a, b) => a - b);
  const middle = counts[Math.floor(counts.length / 2)] ?? 0;
  return middle <= 1
    ? fail(
        "sc3b_paragraph_fragmentation",
        "sc3b_fragmented",
        `Advisory (never gates): the median narrative paragraph is ${middle} sentence(s) long across ${prose.length} paragraphs, which reads as fragmented.`,
      )
    : pass(
        "sc3b_paragraph_fragmentation",
        "sc3b_not_fragmented",
        `Median narrative paragraph length is ${middle} sentences.`,
      );
}

export function checkSc3c(context: QaContext): QaRuleResult {
  const scattered: Finding[] = [];
  let run = 0;
  let runStart = 0;
  const flush = (): void => {
    if (run > QA_THRESHOLDS.sc3cMaxSectionParas) {
      scattered.push({
        line: runStart,
        excerpt: `${run} consecutive prose blocks`,
      });
    }
    run = 0;
  };
  // Headings are the section boundaries, and `paragraphBlocks` drops them, so
  // the run is reset per heading-delimited section rather than over the whole
  // body — otherwise two well-divided sections would read as one long run.
  for (const section of sectionsOfBody(context)) {
    for (const block of paragraphBlocks(section)) {
      if (block.kind === "prose") {
        if (run === 0) runStart = block.line;
        run += 1;
      } else {
        flush();
      }
    }
    flush();
  }
  return scattered.length > 0
    ? fail(
        "sc3c_section_scatter",
        "sc3c_undivided_run",
        `${scattered.length} run(s) of more than ${QA_THRESHOLDS.sc3cMaxSectionParas} consecutive prose blocks: ${excerptList(scattered)}.`,
      )
    : pass(
        "sc3c_section_scatter",
        "sc3c_divided",
        `No run of more than ${QA_THRESHOLDS.sc3cMaxSectionParas} consecutive prose blocks.`,
      );
}

export function checkSc4(context: QaContext): QaRuleResult {
  const links = context.body.filter(
    (entry) => extractMarkdownLinks(entry.text).length > 0,
  );
  return unevaluable(
    "sc4_link_distribution",
    "sc4_no_own_domain_list",
    `Advisory (never gates): link distribution is defined over INTERNAL links, and the frozen pack carries no own-domain list to identify them. ${links.length} line(s) carry a link; distribution is not gated in Slice 2.`,
  );
}

const FAQ_TITLES: readonly string[] = ["faq", "frequently asked questions"];

export function checkSc5(context: QaContext): QaRuleResult {
  const body = sectionBody(context.view, FAQ_TITLES);
  if (body === null) {
    return pass(
      "sc5_faq_section",
      "sc5_no_faq_section",
      "Advisory (never gates): the draft carries no FAQ section. `english_blog_draft` is free-form markdown, so no section is contractually required.",
    );
  }
  const questions = body.filter((entry) =>
    /^\s*(?:[-*+]\s+)?(?:\*\*|###?\s+).*\?\s*(?:\*\*)?\s*$/.test(entry.text),
  ).length;
  return questions < QA_THRESHOLDS.sc5MinFaqQuestions
    ? fail(
        "sc5_faq_section",
        "sc5_too_few_questions",
        `Advisory (never gates): the FAQ section carries ${questions} question(s); ${QA_THRESHOLDS.sc5MinFaqQuestions} is the target.`,
      )
    : pass(
        "sc5_faq_section",
        "sc5_questions_present",
        `The FAQ section carries ${questions} question(s).`,
      );
}

export function checkSc6(context: QaContext): QaRuleResult {
  const h1 = context.view.headings.find((entry) => entry.level === 1);
  if (!h1) {
    return pass(
      "sc6_h1_value_prop",
      "sc6_no_h1",
      "Advisory (never gates): the draft has no H1 to judge.",
    );
  }
  if (context.targetKeywordTokens.length === 0) {
    return unevaluable(
      "sc6_h1_value_prop",
      "sc6_no_target_keyword",
      "Advisory (never gates): no frozen target keyword, so the H1 cannot be compared against it.",
    );
  }
  const headingTokens = tokenize(h1.text);
  const bare =
    headingTokens.length <= context.targetKeywordTokens.length + 1 &&
    !/[:—–|-]/.test(h1.text);
  const template = /^\s*[^:]+:\s+\S/.test(h1.text);
  return bare || template
    ? fail(
        "sc6_h1_value_prop",
        bare ? "sc6_bare_keyword" : "sc6_template_shape",
        `Advisory (never gates): the H1 "${truncateExcerpt(h1.text, QA_THRESHOLDS.maxExcerptChars)}" reads as ${bare ? "the bare keyword" : "a `keyword: clause` template"} rather than a value proposition.`,
      )
    : pass(
        "sc6_h1_value_prop",
        "sc6_value_prop",
        "The H1 carries more than the bare keyword.",
      );
}

export function checkSc7(context: QaContext): QaRuleResult {
  const opening = openingSection(context);
  if (opening === null) {
    return pass(
      "sc7_snippet_bullets",
      "sc7_no_section",
      "Advisory (never gates): the draft has no `##` section, so there is no opening bullet list to check.",
    );
  }
  const bullets = opening.filter((entry) => isListItem(entry.text)).length;
  return bullets < QA_THRESHOLDS.sc7MinBullets
    ? fail(
        "sc7_snippet_bullets",
        "sc7_too_few_bullets",
        `Advisory (never gates): the opening section carries ${bullets} list item(s); ${QA_THRESHOLDS.sc7MinBullets} is the snippet target.`,
      )
    : pass(
        "sc7_snippet_bullets",
        "sc7_bullets_present",
        `The opening section carries ${bullets} list item(s).`,
      );
}

const VAGUE_ANCHORS: ReadonlySet<string> = new Set([
  "here",
  "click here",
  "this",
  "this link",
  "read more",
  "learn more",
  "more",
  "link",
]);

export function checkSc8(context: QaContext): QaRuleResult {
  // The ported rule also asserted the CTA URL equals the ICP's conversion
  // target. The conversion target IS now part of the frozen tuple (it comes from
  // the immutable `icp_profiles` version the frozen diagnosis already pinned),
  // so that half is no longer blocked by a mutable input — but it is still not
  // enabled here. Asserting destination EQUALITY would fail every draft that
  // links to a pricing page, a docs page or any other legitimate first-party
  // destination, and this rule is advisory precisely because it must not
  // manufacture that kind of defect. What the frozen identity does change is
  // RL12/RL12b, where a first-party link now resolves instead of being reported
  // as uncheckable. This rule still judges anchor TEXT only.
  const vague: Finding[] = [];
  for (const entry of context.body) {
    for (const link of extractMarkdownLinks(entry.text)) {
      const label = normalizeHeading(link.label);
      if (VAGUE_ANCHORS.has(label)) {
        vague.push({ line: entry.line, excerpt: link.label });
      }
    }
  }
  return vague.length > 0
    ? fail(
        "sc8_cta_anchor",
        "sc8_vague_anchor",
        `Advisory (never gates): ${vague.length} link(s) use a non-descriptive anchor — ${excerptList(vague)}.`,
      )
    : pass(
        "sc8_cta_anchor",
        "sc8_descriptive_anchors",
        "Every link uses a descriptive anchor. This rule judges anchor TEXT only: the frozen inputs do carry the ICP conversion target, but a draft may legitimately link to any first-party destination, so no destination equality is asserted here.",
      );
}

const TABLE_DELIMITER_ROW = /^\s{0,3}\|[\s:|-]+\|\s*$/;
const LIST_MARKER = /^\s{0,3}(?:[-*+]|\d+[.)])\s+/;
const QUOTE_MARKER = /^\s{0,3}>\s?/;

/**
 * Every reference entry the draft lists, in every reference section.
 *
 * An entry is ANY non-empty line under a reference heading, not only a
 * markdown list item. The list-item-only version made the whole
 * anti-fabrication guarantee depend on whether the model happened to type a
 * hyphen: the identical bibliography was blocked when written as `- Forrester,
 * 2024` and passed when written as a plain paragraph, a table or a blockquote.
 * A reference the model chose to format differently is still a reference.
 *
 * The one line that is skipped is a markdown table's header and delimiter row,
 * because markdown REQUIRES a header row — it is table syntax, not a claim
 * about a source.
 */
interface ReferenceEntry {
  readonly line: number;
  readonly text: string;
  /** What the heading over this entry promises about it. */
  readonly standard: ReferenceStandard;
}

function referenceEntries(context: QaContext): readonly ReferenceEntry[] {
  const entries: ReferenceEntry[] = [];
  for (const section of context.referenceSections) {
    let tableRow = -1;
    for (const block of paragraphBlocks(section.lines)) {
      if (isHeadingLine(block.text)) {
        tableRow = -1;
        continue;
      }
      if (block.kind === "table") {
        tableRow += 1;
        if (TABLE_DELIMITER_ROW.test(block.text)) continue;
        if (tableRow === 0) continue;
        const cells = block.text
          .split("|")
          .map((cell) => cell.trim())
          .filter((cell) => cell.length > 0)
          .join(" — ");
        if (cells.length > 0) {
          entries.push({
            line: block.line,
            text: cells,
            standard: section.standard,
          });
        }
        continue;
      }
      tableRow = -1;
      const text = block.text
        .replace(LIST_MARKER, "")
        .replace(QUOTE_MARKER, "")
        .trim();
      if (text.length > 0) {
        entries.push({ line: block.line, text, standard: section.standard });
      }
    }
  }
  return entries;
}

export function checkSc9(context: QaContext): QaRuleResult {
  const present = context.referenceSections.length > 0;
  if (context.index.citableCount === 0) {
    return pass(
      "sc9_sources_section",
      "sc9_no_citable_sources",
      `Advisory (never gates): the frozen research pack carries no EXTERNAL citable source — every source in it is a first-party record (project record IDs plus this project's own site origin and conversion target) — so a Sources section is not expected. The draft ${present ? "carries one anyway" : "carries none under a heading recognised as a reference list"}.`,
    );
  }
  const entries = referenceEntries(context);
  return entries.length < QA_THRESHOLDS.sc9MinSourceEntries
    ? fail(
        "sc9_sources_section",
        "sc9_sources_missing",
        `Advisory (never gates): the pack carries ${context.index.citableCount} citable source(s) but the draft lists ${entries.length}.`,
      )
    : pass(
        "sc9_sources_section",
        "sc9_sources_present",
        `The draft lists ${entries.length} source entry(ies).`,
      );
}

const SOURCE_NAME_STOP = /\s+[-–—]\s+|:\s+|,\s+(?:19|20)\d{2}\b/;

/**
 * SC9b, upgraded from the ported WARN.
 *
 * The original only asked whether a Sources entry was mentioned in the body —
 * a dangling-reference check. This asks whether it exists in our records at
 * all, which is the difference between catching a formatting slip and catching
 * an invented reference.
 *
 * What it asks for is EVIDENCE, so the customer's own web identity never
 * satisfies it. Accepting one let an entire fabricated bibliography pass by
 * hanging a link to the customer's own site on the end of every entry:
 * "Forrester Digital Experience Report, 2024. https://our-site/product"
 * resolved, and the rule wrote down that all of its entries resolved to the
 * frozen pack. A first-party URL says where a page is; a reference entry claims
 * a source stands behind the draft, and those are different assertions.
 */
/** Every attribution one reference entry offers, in resolution order. */
function entryAttributions(text: string): readonly Attribution[] {
  const attributions: Attribution[] = [];
  for (const link of extractMarkdownLinks(text)) {
    attributions.push({ kind: "url", value: link.target });
  }
  for (const url of extractUrls(text)) {
    attributions.push({ kind: "url", value: url });
  }
  const stop = SOURCE_NAME_STOP.exec(text);
  const name = (stop?.index !== undefined ? text.slice(0, stop.index) : text)
    .replace(/\[|\]\([^)]*\)/g, " ")
    .replace(/\s*,\s*(?:19|20)\d{2}\s*$/, "")
    .trim();
  if (name.length > 0) attributions.push({ kind: "name", value: name });
  return attributions;
}

type EntryVerdict = "resolved" | "unsupported" | "unverifiable";

/**
 * What ONE reference entry is being offered as, and whether that holds.
 *
 * This is RL12's locator/evidence split, applied where it was missing. SC9b ran
 * every entry through `resolveAssertionSupport` regardless of what its heading
 * said, so three navigation sections listing the customer's own pages came back
 * pass / blocked / blocked — and the blocked ones told the reviewer that a B2B
 * post's internal links were unresolvable sources at authority D. Same content,
 * same meaning, three different verdicts, one of them an accusation.
 *
 * The heading sets the entry's DEFAULT role and the entry's own shape may
 * override it upward:
 *
 * - Under an EVIDENCE heading (`Sources`, `References`, `Bibliography`, `Works
 *   Cited`) every entry claims a source stands behind the draft. Only external
 *   evidence answers that, and the customer's own address never does. Unchanged.
 * - Under a LOCATOR heading (`Further reading`, `See also`) an entry is an
 *   ADDRESS — "here is another page" — so the customer's own address is a
 *   complete answer. An address we cannot place is unverifiable, not
 *   unsupported: it goes to a human, it is not blocked.
 * - An entry that is written AS A CITATION — a name phrase carrying a year, a
 *   quotation or an `et al.` — is evidence wherever it sits. A bibliography does
 *   not stop being a bibliography because the heading over it says "Further
 *   reading", so the upward override is what keeps that case blocked.
 */
function judgeEntry(context: QaContext, entry: ReferenceEntry): EntryVerdict {
  const text = stripInlineCode(entry.text);
  const attributions = entryAttributions(text);
  const shape = citationEntry(text);
  const asEvidence =
    entry.standard === "evidence" || (shape !== null && shape.corroborated);
  if (asEvidence) {
    return resolveAssertionSupport(context.index, attributions) === null
      ? "unsupported"
      : "resolved";
  }
  const placed = attributions.some(
    (attribution) =>
      attribution.kind === "url" &&
      resolveLinkProvenance(context.index, attribution) !== "unresolved",
  );
  if (placed) return "resolved";
  const hasAddress = attributions.some(
    (attribution) => attribution.kind === "url",
  );
  // A navigation entry with no address and no outside-looking name is prose
  // under a navigation heading ("Read the onboarding guide"). Nothing to check.
  return hasAddress || shape !== null ? "unverifiable" : "resolved";
}

export function checkSc9b(context: QaContext): QaRuleResult {
  const entries = referenceEntries(context);
  if (entries.length === 0) {
    return pass(
      "sc9b_sources_resolve_to_pack",
      "sc9b_no_sources_section",
      context.referenceSections.length === 0
        ? "This check RECOGNISED no section of the draft as a reference list (sources, references, citations, works cited, bibliography, further reading, see also, and their non-English equivalents), so it had no reference entry to resolve. That is what it scanned, and it is not a statement that the draft carries no reference list: a list under a heading this check does not recognise — and a region whose heading says `Sources` but whose content is running prose rather than entries — stays in the body, where RL8 and RL12 scan it."
        : `${context.referenceSections.length} section(s) were recognised as a reference list but carry no entry line, so there was nothing to resolve. This reports what it scanned, not what the draft contains.`,
    );
  }
  const unsupported: Finding[] = [];
  const unverifiable: Finding[] = [];
  for (const entry of entries) {
    const verdict = judgeEntry(context, entry);
    if (verdict === "unsupported") {
      unsupported.push({ line: entry.line, excerpt: entry.text });
    } else if (verdict === "unverifiable") {
      unverifiable.push({ line: entry.line, excerpt: entry.text });
    }
  }
  if (unsupported.length > 0) {
    return fail(
      "sc9b_sources_resolve_to_pack",
      "sc9b_source_unresolved",
      `${unsupported.length} of ${entries.length} reference entry(ies) resolve to no source in the frozen research pack (authority D): ${excerptList(unsupported)}. ${context.index.citableCount === 0 ? "This run retrieved no external research at all, so NOTHING external can be confirmed from our records — this is a statement that the reference is unverifiable here, not evidence that it was invented. A human has to check each entry." : "The pack is assembled only from records the customer confirmed, so an entry that does not resolve names a source we do not hold."}`,
    );
  }
  if (unverifiable.length > 0) {
    // A navigation heading promises destinations, not evidence. An entry under
    // one that points somewhere we cannot place is UNCHECKED, and saying so is
    // the whole truth available: calling it unsupported would repeat the mistake
    // of reporting a B2B post's own further-reading list as a fabrication.
    return unevaluable(
      "sc9b_sources_resolve_to_pack",
      "sc9b_locator_unverifiable",
      `${unverifiable.length} of ${entries.length} entry(ies) sit under a navigation heading (further reading, see also) and point somewhere the frozen inputs cannot place: ${excerptList(unverifiable)}. A heading like that offers destinations rather than evidence, so the customer's own pages answer it completely and these do not — but "we cannot place this address" is not "this source does not exist", and this check will not say the second when it only knows the first. A reviewer confirms them by hand.`,
    );
  }
  return pass(
    "sc9b_sources_resolve_to_pack",
    "sc9b_sources_resolve",
    `All ${entries.length} reference entry(ies) resolve: every entry under an evidence heading (sources, references, bibliography, works cited) resolves to the frozen research pack, and every entry under a navigation heading (further reading, see also) points at the customer's own frozen web identity.`,
  );
}

export function checkSc10(context: QaContext): QaRuleResult {
  const rows = context.body.filter((entry) =>
    /^\s{0,3}\|.*\|\s*$/.test(entry.text),
  );
  if (rows.length === 0) {
    return pass(
      "sc10_table_integrity",
      "sc10_no_table",
      "Advisory (never gates): the scanned body carries no table row, and no table is required.",
    );
  }
  const dataRows = rows.filter(
    (entry) => !/^\s{0,3}\|[\s:|-]+\|\s*$/.test(entry.text),
  );
  const header = rows[0];
  const columns = header
    ? header.text.split("|").filter((cell) => cell.trim().length > 0).length
    : 0;
  const bodyRows = Math.max(0, dataRows.length - 1);
  return columns < QA_THRESHOLDS.sc10MinCols ||
    bodyRows < QA_THRESHOLDS.sc10MinRows
    ? fail(
        "sc10_table_integrity",
        "sc10_table_thin",
        `Advisory (never gates): the first table has ${columns} column(s) and ${bodyRows} data row(s); ${QA_THRESHOLDS.sc10MinCols}x${QA_THRESHOLDS.sc10MinRows} is the target.`,
      )
    : pass(
        "sc10_table_integrity",
        "sc10_table_complete",
        `The first table has ${columns} columns and ${bodyRows} data rows.`,
      );
}

const BANNED_HEADING_SHAPES: readonly RegExp[] = [
  /vs\.?\s+adjacent concepts/i,
  /^What is\s+/,
  /^How to Read\s+[a-z]/,
];

export function checkSc11(context: QaContext): QaRuleResult {
  if (!context.english) {
    return unevaluable(
      "sc11_banned_headings",
      "sc11_locale_unsupported",
      "Template heading shapes are English patterns: locale not supported by deterministic segmentation.",
    );
  }
  const hits: Finding[] = [];
  for (const heading of context.view.headings) {
    if (heading.level < 2) continue;
    for (const pattern of BANNED_HEADING_SHAPES) {
      if (pattern.test(heading.text)) {
        hits.push({ line: heading.line, excerpt: heading.text });
        break;
      }
    }
  }
  return hits.length > 0
    ? fail(
        "sc11_banned_headings",
        "sc11_template_heading",
        `${hits.length} heading(s) use a template shape that reads as bulk-produced: ${excerptList(hits)}.`,
      )
    : pass(
        "sc11_banned_headings",
        "sc11_headings_clean",
        "No heading matched the template shapes this rule scans for.",
      );
}

/**
 * SC-DUP (new, not ported).
 *
 * RL3 used this dynamic program against SERP snippets, which SignalFrame does
 * not hold. It DOES hold the pinned brief revision, and the most realistic
 * failure of a shadow pipeline is a model that restates the brief and calls it
 * a draft. Advisory: a restatement is a quality problem, not a false statement.
 */
export function checkScDup(context: QaContext): QaRuleResult {
  const brief = context.input.briefMarkdown.trim();
  if (brief.length === 0) {
    return unevaluable(
      "scdup_brief_overlap",
      "scdup_no_brief_text",
      "Advisory (never gates): the pinned brief revision carried no text to compare the draft against.",
    );
  }
  const run = longestCommonNgram(context.draftTokens, tokenize(brief));
  return run > QA_THRESHOLDS.scdupMaxBriefNgram
    ? fail(
        "scdup_brief_overlap",
        "scdup_restates_brief",
        `Advisory (never gates): the draft shares a ${run}-token verbatim run with the pinned brief (threshold ${QA_THRESHOLDS.scdupMaxBriefNgram}), which reads as a restatement rather than a draft.`,
      )
    : pass(
        "scdup_brief_overlap",
        "scdup_distinct",
        `Longest verbatim run shared with the pinned brief is ${run} tokens (threshold ${QA_THRESHOLDS.scdupMaxBriefNgram}).`,
      );
}

export function evaluateStructureRules(
  context: QaContext,
): readonly QaRuleResult[] {
  return [
    checkSc1(context),
    checkSc2(context),
    checkSc3(context),
    checkSc3b(context),
    checkSc3c(context),
    checkSc4(context),
    checkSc5(context),
    checkSc6(context),
    checkSc7(context),
    checkSc8(context),
    checkSc9(context),
    checkSc9b(context),
    checkSc10(context),
    checkSc11(context),
    checkScDup(context),
  ];
}
