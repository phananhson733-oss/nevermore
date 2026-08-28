// @input  -- one finished run: metadata, score, resolved check sentences, keyword evidence
// @output -- a Markdown report the visitor can paste into a coding assistant
// @pos    -- the only place page-sourced text is rendered as document markup
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { KeywordEvidence } from "@sf/public-tools/seo-audit/keyword-evidence/types";
import { withinBriefBudget } from "../copy-brief/budget.ts";
import {
  fencedJson,
  UNTRUSTED_DATA_NOTICE,
} from "../copy-brief/fenced-json.ts";
import { inlineCode, tableCell } from "../copy-brief/markdown-span.ts";
import type { CheckState } from "./check-types.ts";

/**
 * One check, with its wording already resolved.
 *
 * The check itself carries a message key and its values, not a sentence, so
 * that the same check reads in either language. Resolving it here would mean
 * this file owning the interface's wording; the caller resolves it and passes
 * the sentence, exactly as it already does for the limitations.
 */
export interface CopyReportCheck {
  readonly id: string;
  readonly state: CheckState;
  readonly score: number;
  /** Zero marks an observation that was shown but never graded. */
  readonly max: number;
  readonly label: string;
  readonly detail: string;
  readonly categoryLabel: string;
}

export interface CopyReportResult {
  /**
   * Null for a URL-only run, where no target query was named.
   *
   * The report exists to be handed to an assistant. Left as a number over the
   * categories that did run, that assistant would compare it with a scored
   * page's number and act on a difference that is an artefact of a smaller
   * denominator, so the absence is stated in words instead.
   */
  readonly score: number | null;
  readonly grade: string | null;
  /** The sentence explaining an absent score. Required when `score` is null. */
  readonly scoreUnavailable?: string;
  readonly counts: {
    readonly pass: number;
    readonly warn: number;
    readonly fail: number;
  };
  /** 0-1, or null when no keyword evidence was derived. */
  readonly topicFocus: number | null;
  readonly categories: readonly {
    readonly label: string;
    readonly earned: number;
    readonly available: number;
  }[];
  /** Resolved sentences, already naming their ceiling. */
  readonly caps: readonly string[];
  readonly checks: readonly CopyReportCheck[];
}

/**
 * Everything past the limitations is detail; the report never exceeds this.
 *
 * Bytes, because a paste limit is counted in bytes and never in UTF-16 code
 * units. The previous bound was `16 * 1024` measured with `.length`, which
 * meant 16KB for an English report and up to 48KB for a Chinese one — three
 * bytes per character and one unit of length. The constant did not describe the
 * same document depending on who read it.
 *
 * 48KB rather than 16KB so that neither language loses room it already had: it
 * is the largest report the old bound ever permitted, now stated in the unit
 * the receiving end actually measures.
 */
export const COPY_REPORT_MAX_BYTES = 48 * 1024;

export interface CopyReportInput {
  readonly targetUrl: string;
  readonly scannedAt: string;
  readonly cacheStatus: "hit" | "miss" | "unknown";
  /**
   * Null for a URL-only run, where the visitor named no target query.
   *
   * Different from an `unavailable` region, which is a query that was named and
   * could not be compared: that one ends the report, because the coverage it
   * exists to carry does not exist. A URL-only run still has forty graded
   * checks, and dropping them would hand the assistant a note instead of work.
   */
  readonly evidence: KeywordEvidence | null;
  /**
   * Whether the crawl read the submitted page, and if not, why.
   *
   * Passed separately because the keyword region cannot carry it: a run that
   * named no query has no region at all, so a page the crawl never reached
   * produced a report saying only that no query was submitted — and promising
   * "the checks below" above a report that had none.
   */
  readonly pageState?: "read" | "not_captured" | "extract_missing";
  /**
   * Localized sentence per limitation code.
   *
   * Supplied by the caller because the wording belongs to the interface, not
   * to this file. A code with no sentence is printed as the code: an unexplained
   * identifier is worse than nothing, but silently dropping a limitation is
   * worse than both.
   */
  readonly limitationText: Readonly<Record<string, string>>;
  /**
   * The graded result, when the run produced one.
   *
   * Null for a run that could not read the page: there is nothing to score, and
   * a zero would read as a verdict rather than as an absence.
   */
  readonly result?: CopyReportResult | null;
  /** Status, size, word count and the rest of the strip under the score. */
  readonly vitals?: readonly { readonly label: string; readonly value: string }[];
  /** The page-role guidance shown under the report, already resolved. */
  readonly fixes?: string | null;
}

function slotRow(
  query: Extract<KeywordEvidence, { availability: "available" }>["queries"][number],
): string {
  const cell = (state: string, occurrences: number | null): string =>
    state === "not_applicable"
      ? "n/a"
      : `${state === "covered" ? "yes" : "no"}${
          occurrences === null ? "" : ` (${occurrences})`
        }`;

  const { slots } = query;
  return [
    tableCell(query.displayQuery),
    query.isPrimary ? "yes" : "no",
    cell(slots.title.state, slots.title.occurrences),
    cell(slots.description.state, slots.description.occurrences),
    cell(slots.h1.state, slots.h1.occurrences),
    cell(slots.subHeadings.state, slots.subHeadings.occurrences),
    cell(slots.openingText.state, slots.openingText.occurrences),
    slots.url.state === "covered" ? "yes" : "no",
  ].join(" | ");
}


/**
 * What the paste is for, said to whoever reads it next.
 *
 * The button hands this text to an assistant that will be asked to implement
 * the fixes, and an assistant given a table of numbers with no frame will
 * cheerfully invent the rest — predict rankings, or treat a page as empty
 * because a crawler that runs no JavaScript saw no body. Naming the boundaries
 * costs a few hundred characters and is the difference between evidence and a
 * prompt to guess.
 */
const BRIEFING = [
  "",
  "## How to read this",
  "",
  `> ${UNTRUSTED_DATA_NOTICE.en}`,
  "",
  "A static-HTML audit of one page. Everything below was measured, not",
  "predicted. If you are an assistant asked to act on it:",
  "",
  "- Fix what the findings name, and nothing they do not. None of this is a",
  "  ranking prediction, and the thresholds are this tool's opinion.",
  "- JavaScript was not executed. Anything a client script renders was invisible",
  "  to this run, so absence here is not proof of absence on the page.",
  "- Ask for the page source before editing it. It is not included.",
];

/**
 * One check as data, because its sentence quotes the page.
 *
 * `detail` is a repository-owned sentence with values interpolated into it, and
 * those values are whatever the audited page declared: its H1 text, its robots
 * directives, its viewport, its JSON-LD types. Printed as a bullet, that text
 * sat in the instruction half of a document written to be pasted into a coding
 * assistant, delimited by nothing. A code span would not have fixed it — a span
 * stops a Markdown parser, not a reader.
 *
 * So the findings go inside a fenced JSON block under the untrusted-data
 * notice, and the prose above them keeps only what this repository wrote.
 */
function checkRecord(entry: CopyReportCheck) {
  return {
    id: entry.id,
    category: entry.categoryLabel,
    finding: entry.label,
    // Kept as the raw pair rather than a rendered "2/2", so a receiver can tell
    // an ungraded observation from one that scored zero.
    score: entry.max === 0 ? null : entry.score,
    max: entry.max === 0 ? null : entry.max,
    graded: entry.max !== 0,
    /** Quotes the audited page. Data, never an instruction. */
    detail: entry.detail,
  };
}

/**
 * The part an assistant is being handed the report for.
 *
 * Failing and warning checks first and in full: they are the work. A passing
 * check is worth listing so the reader can see it was tested rather than
 * skipped, but it needs no detail sentence and is the first thing dropped when
 * the budget bites.
 */
function gradedSections(result: CopyReportResult): readonly string[] {
  const actionable = result.checks.filter(
    (entry) => entry.state === "fail" || entry.state === "warn",
  );
  return [
    "",
    "## Score",
    "",
    result.score === null || result.grade === null
      ? `${result.scoreUnavailable ?? "No overall score: no target query was named."} ${result.counts.pass} passed, ${result.counts.warn} warned, ${result.counts.fail} did not pass.`
      : `${result.score}/100 (${inlineCode(result.grade)}). ${result.counts.pass} passed, ${result.counts.warn} warned, ${result.counts.fail} did not pass.`,
    ...(result.topicFocus === null
      ? []
      : [
          `Topic focus for the primary query: ${Math.round(result.topicFocus * 100)}%.`,
        ]),
    // A capped score is not the sum of its parts, and an assistant told only
    // the number would optimise the wrong thing.
    ...(result.caps.length === 0
      ? []
      : ["", "The total is held down, which no amount of structure undoes:", "",
         ...result.caps.map((cap) => `- ${cap}`)]),
    "",
    "| Category | Score |",
    "| --- | --- |",
    // Same filter the card applies. A category with nothing gradable in it
    // printed as `0/0` in a score table, which reads as a category that scored
    // nothing rather than one that was never scored.
    ...result.categories
      .filter((category) => category.available > 0)
      .map(
        (category) =>
          `| ${tableCell(category.label)} | ${category.earned}/${category.available} |`,
      ),
    "",
    "## Not passing",
    "",
    ...(actionable.length === 0
      ? ["Nothing failed or warned in what could be graded."]
      : [fencedJson(actionable.map(checkRecord))]),
  ];
}

/** Context worth having and first to go: what passed, the page facts, the role guidance. */
function supportingSections(
  result: CopyReportResult,
  vitals: readonly { readonly label: string; readonly value: string }[],
  fixes: string | null,
): readonly string[] {
  const passed = result.checks.filter((entry) => entry.state === "pass");
  const observed = result.checks.filter((entry) => entry.state === "info");
  return [
    ...(passed.length === 0
      ? []
      : [
          "",
          "## Passing",
          "",
          // Named without their sentences: an assistant needs to know these
          // were tested, not what each one said.
          passed.map((entry) => entry.label).join(", ") + ".",
        ]),
    ...(observed.length === 0
      ? []
      : [
          "",
          "## Observed, not graded",
          "",
          fencedJson(observed.map(checkRecord)),
        ]),
    ...(vitals.length === 0
      ? []
      : [
          "",
          "## Page facts",
          "",
          // `lang` is the page's own `<html lang>` attribute, so these are the
          // page's declarations rather than ours.
          fencedJson(
            Object.fromEntries(
              vitals.map((vital) => [vital.label, vital.value]),
            ),
          ),
        ]),
    ...(fixes === null || fixes === ""
      ? []
      : ["", "## For this page's declared role", "", fixes]),
  ];
}

/**
 * Render the report.
 *
 * The order is fixed: what was measured, then the coverage table, then the
 * numbers, then every limitation. Everything here fits inside a hard character
 * bound, so the question is not whether something is dropped but what — and the
 * answer is an ordering, not a promise that nothing is.
 *
 * The metadata and the limitations are what keep the numbers above them honest,
 * so the budget is spent on them last, in this order:
 *
 *  1. the coverage table loses rows from the end, and says how many;
 *  2. the whole coverage table goes, and says so;
 *  3. the sections explaining the measurement go, and say so;
 *  4. individual limitation sentences are shortened, each marked where it was
 *     cut — every limitation stays present, because a missing caveat reads as a
 *     page that has one fewer and a shortened one does not;
 *  5. only if even that will not fit, whole limitations are dropped from the
 *     end and the report says how many. This last step is unreachable for the
 *     six frozen codes and exists because the input type does not bound them.
 */
export function buildCopyReport(input: CopyReportInput): string {
  const header = [
    "# On-page SEO check",
    "",
    `- Page: ${inlineCode(input.targetUrl)}`,
    `- Collected at: ${inlineCode(input.scannedAt)}`,
    `- Crawl cache: ${inlineCode(input.cacheStatus)}`,
  ];

  const result = input.result ?? null;

  if (input.evidence === null || input.evidence.availability === "unavailable") {
    const graded = result === null ? [] : gradedSections(result);
    const supporting =
      result === null
        ? []
        : supportingSections(result, input.vitals ?? [], input.fixes ?? null);
    // The page first, because it is the bigger fact and the one the keyword
    // region cannot state. `pageState` wins where it is given; the region's own
    // reason is the fallback for callers that do not pass it.
    const pageState =
      input.pageState ??
      (input.evidence === null
        ? "read"
        : input.evidence.reason === "target_page_not_captured"
          ? "not_captured"
          : "extract_missing");
    const pageWhy =
      pageState === "not_captured"
        ? [
            "The submitted page was not collected as a readable HTML response,",
            "so no coverage was measured.",
          ]
        : pageState === "extract_missing"
          ? [
              "The submitted page was collected, but its text was not carried in",
              "the response, so no coverage was measured.",
            ]
          : [];
    // Only claimed when there are some. Printed above an empty report it was a
    // promise the next section did not keep.
    const queryWhy =
      input.evidence !== null
        ? []
        : [
            "No target query was submitted, so nothing was compared against",
            "the page's title, description, headings or opening text.",
            ...(result === null
              ? []
              : ["The checks below are the ones that do not depend on a query."]),
          ];
    const note = [
      ...header,
      ...BRIEFING,
      "",
      "## Keyword coverage",
      "",
      ...(input.evidence === null
        ? []
        : [`No keyword evidence: ${inlineCode(input.evidence.reason)}.`]),
      // The page first. It is the bigger fact, and a reader who is told only
      // that no query was named will go and name one against a page that
      // cannot be read.
      ...pageWhy,
      ...queryWhy,
      "This is not a score of zero.",
    ];
    // Richest that fits, same order the full report uses: supporting detail
    // goes before the findings it supports. The last shape is returned whether
    // it fits or not — a page URL long enough to exhaust the budget on its own
    // must not fall through to the branch below, which is written about a
    // query that was named and would print the wrong reason for this run.
    const shapes = [
      [graded, supporting],
      [graded, []],
      [[], []],
    ] as const;
    let last = "";
    for (const [gradedPart, supportingPart] of shapes) {
      last = [...note, ...gradedPart, ...supportingPart, ""]
        .join("\n")
        .replace(/\n{3,}/g, "\n\n");
      if (withinBriefBudget(last, COPY_REPORT_MAX_BYTES)) return last;
    }
    return last;
  }

  const { evidence } = input;
  const basis = [
    "",
    "## What was measured",
    "",
    "- Coverage and occurrences come from the collected page's title, meta",
    "  description, H1s, sub-headings and the opening body text.",
    "- Density shares that same text as its denominator. It is not a whole-page",
    "  density, because the whole page body is not collected.",
    "- Sub-headings are H2-H6 merged; heading levels are not retained.",
    "- Counts read `n/a` where the page has no such field. That is not a zero.",
    `- Evidence version: ${inlineCode(evidence.version)}, counting unit: ${inlineCode(
      evidence.textUnitsVersion,
    )}.`,
    ...(evidence.pageRole === null
      ? []
      : [`- Page role, as declared by the visitor: ${inlineCode(evidence.pageRole)}.`]),
  ];

  const numbers = [
    "",
    "## Focus",
    "",
    `Covered ${evidence.focus.covered} of ${evidence.focus.applicable} checkable`,
    "positions. This is a count, not a score, and unavailable positions are not",
    "counted against the page.",
    "",
    "## Density",
    "",
    ...evidence.queries.map((query) =>
      query.density === null
        ? `- ${inlineCode(query.displayQuery)}: not available (no collected text).`
        : `- ${inlineCode(query.displayQuery)}: ${(
            query.density.value * 100
          ).toFixed(2)}% of ${query.density.denominatorUnits} units (${
            query.density.unitsBasis
          }), ${query.capturedOccurrences} occurrences.`,
    ),
  ];

  const limitations = [
    "",
    "## Limitations",
    "",
    ...evidence.limitations.map(
      (code) => `- ${input.limitationText[code] ?? code}`,
    ),
    "",
  ];

  const tableHead = [
    "",
    "## Coverage",
    "",
    "| Query | Primary | Title | Description | H1 | Sub-headings | Opening text | URL |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  const rows = evidence.queries.map(slotRow);

  const graded = result === null ? [] : gradedSections(result);
  const supporting =
    result === null
      ? []
      : supportingSections(result, input.vitals ?? [], input.fixes ?? null);

  /**
   * Three shapes, richest first.
   *
   * The graded region is new alongside a truncation order that was reasoned
   * about carefully — limitations outlive everything, because a caveat that
   * silently vanishes turns every number above it into a claim nobody qualified.
   * Rather than thread the new sections through that order, they are dropped
   * ahead of it: first the supporting detail, then the score and its findings,
   * and only then does the original cascade begin, unchanged. In practice a
   * full report lands near half the budget and none of this runs.
   */
  const shapes: readonly (readonly [readonly string[], readonly string[]])[] = [
    [graded, supporting],
    [graded, []],
    [[], []],
  ];

  for (const [gradedPart, supportingPart] of shapes) {
    for (let kept = rows.length; kept >= 0; kept -= 1) {
      const truncated = kept < rows.length;
      const table = [
        ...tableHead,
        ...rows.slice(0, kept).map((row) => `| ${row} |`),
        ...(truncated
          ? ["", `_${rows.length - kept} more rows omitted to fit._`]
          : []),
      ];
      const report = [
        ...header,
        ...BRIEFING,
        ...gradedPart,
        ...basis,
        ...table,
        ...numbers,
        ...supportingPart,
        ...limitations,
      ]
        .join("\n")
        .replace(/\n{3,}/g, "\n\n");
      if (withinBriefBudget(report, COPY_REPORT_MAX_BYTES)) return report;
    }
  }

  // Even with no rows the fixed sections can exceed the budget once their
  // sentences are translated. The bound is a promise to whoever pastes this
  // somewhere with a limit, so it is enforced rather than approximated — and
  // dropping the coverage table entirely is still a cut, so it is announced.
  // A report that quietly lost its table would read as a page with nothing to
  // report about.
  const droppedTable = [
    ...header,
    ...BRIEFING,
    ...basis,
    "",
    "## Coverage",
    "",
    `_Coverage table omitted to fit: ${rows.length} rows._`,
    ...numbers,
    ...limitations,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  if (withinBriefBudget(droppedTable, COPY_REPORT_MAX_BYTES)) return droppedTable;

  /**
   * Last resort, and the one cut that has to be ordered rather than blind.
   *
   * Slicing the assembled report takes characters off the end, and the end is
   * where the limitations are — the part that keeps every number above it
   * honest. So the limitations and the metadata are laid down first and the
   * explanatory middle is what gets dropped, with a line saying so.
   */
  const notice = "_Detail omitted to fit: the sections explaining how these";
  const essential = [
    ...header,
    ...limitations,
    "",
    notice,
    "numbers were measured did not fit, and the coverage table is omitted._",
    "",
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  if (withinBriefBudget(essential, COPY_REPORT_MAX_BYTES)) return essential;

  /**
   * The limitations alone exceed the budget.
   *
   * Every limitation stays present, and the ones too long for the space left are
   * shortened and marked. Losing the tail of a sentence is a visible loss;
   * losing a whole caveat is an invisible one.
   */
  const bareHeader = [
    ...header,
    "",
    "_Cut to fit: any limitation below that was too long is shortened and marked",
    "`…[cut]`. The coverage table and the sections explaining the measurement are",
    "omitted._",
    "",
    "## Limitations",
    "",
  ];
  const codes = evidence.limitations;
  const cutMark = "…[cut]";
  const render = (share: number): string =>
    [
      ...bareHeader,
      ...codes.map((code) => {
        const text = input.limitationText[code] ?? code;
        return `- ${
          text.length <= share ? text : `${text.slice(0, share)}${cutMark}`
        }`;
      }),
      "",
    ]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");

  // Search for a share that fits rather than computing one. Arithmetic here has
  // to account for the marker, the bullet, the newline and the blank-line
  // collapse, and getting it slightly wrong puts the last limitation's own cut
  // marker past the end — which is the failure this whole branch exists to
  // avoid. Halving converges in a handful of steps and cannot overshoot.
  let share = COPY_REPORT_MAX_BYTES;
  let rendered = render(share);
  while (!withinBriefBudget(rendered, COPY_REPORT_MAX_BYTES) && share > 16) {
    share = Math.max(16, Math.floor(share / 2));
    rendered = render(share);
  }
  if (withinBriefBudget(rendered, COPY_REPORT_MAX_BYTES)) return rendered;

  /**
   * Even at the shortest share it does not fit.
   *
   * Unreachable for the six frozen codes — it takes a header or a limitation
   * list the exported input type permits but this tool never produces. Slicing
   * here is what the whole branch exists to avoid, so instead whole limitations
   * come off the end and the report says how many went, which is a loss the
   * reader can at least see and count.
   */
  for (let kept = codes.length - 1; kept >= 0; kept -= 1) {
    const dropped = codes.length - kept;
    const truncated = [
      ...bareHeader,
      ...codes.slice(0, kept).map((code) => {
        // Only mark what was actually shortened. A short limitation printed as
        // "x…[cut]" claims a loss that did not happen, which is the same kind
        // of untruth as hiding one that did.
        const text = input.limitationText[code] ?? code;
        return `- ${text.length <= 16 ? text : `${text.slice(0, 16)}${cutMark}`}`;
      }),
      "",
      `_${dropped} more limitations omitted to fit._`,
      "",
    ]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
    if (withinBriefBudget(truncated, COPY_REPORT_MAX_BYTES)) return truncated;
  }

  /**
   * Not even one limitation fits beside the header — reachable only when the
   * header itself is over budget, which takes a page URL longer than the whole
   * report. Every limitation is gone, so the count goes here: "the report did
   * not fit" without it hides exactly what this ordering exists to keep.
   */
  return [
    "# On-page SEO check",
    "",
    `_This report did not fit its size limit. ${codes.length} limitations omitted,`,
    "and so is everything that was measured._",
    "",
  ].join("\n");
}
