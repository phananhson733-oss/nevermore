// @input  -- one finished run: its metadata, keyword evidence, and localized limitation text
// @output -- a Markdown report the visitor can paste into an assistant
// @pos    -- the only place page-sourced text is rendered as document markup
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { KeywordEvidence } from "@sf/public-tools/seo-audit/keyword-evidence/types";

/** Everything past the limitations is detail; the report never exceeds this. */
export const COPY_REPORT_MAX_CHARS = 16 * 1024;

export interface CopyReportInput {
  readonly targetUrl: string;
  readonly scannedAt: string;
  readonly cacheStatus: "hit" | "miss" | "unknown";
  readonly evidence: KeywordEvidence;
  /**
   * Localized sentence per limitation code.
   *
   * Supplied by the caller because the wording belongs to the interface, not
   * to this file. A code with no sentence is printed as the code: an unexplained
   * identifier is worse than nothing, but silently dropping a limitation is
   * worse than both.
   */
  readonly limitationText: Readonly<Record<string, string>>;
}

/**
 * Wrap a value so its own characters cannot become markup.
 *
 * The URL, the queries and anything else here came from outside: a value
 * containing a backtick, a pipe or a bracket would otherwise reformat the
 * document it is quoted in, and this text is written to be pasted somewhere
 * that reads Markdown. The fence grows past the longest run of backticks in
 * the value, which is what makes the span unbreakable rather than merely
 * unlikely to break.
 */
export function inlineCode(value: string): string {
  return codeSpan(value);
}

/**
 * The same span, escaped for a table cell.
 *
 * A code span does not protect a cell. GFM splits the row on pipes before it
 * looks at spans, so `plan | tier` becomes two cells and every column after it
 * shifts one to the left — the coverage table would report one query's numbers
 * under another query's heading. The pipe has to be backslash-escaped, and
 * that escape is what the surrounding backticks then carry.
 */
export function tableCell(value: string): string {
  return codeSpan(value).replace(/\|/g, "\\|");
}

function codeSpan(value: string): string {
  const flat = value.replace(/\r?\n|\r/g, " ").trim();
  if (flat === "") return "``";
  const longestRun = Math.max(
    0,
    ...[...flat.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const fence = "`".repeat(longestRun + 1);
  const padding = flat.startsWith("`") || flat.endsWith("`") ? " " : "";
  return `${fence}${padding}${flat}${padding}${fence}`;
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
 * Render the report.
 *
 * The order is fixed: what was measured, then the coverage table, then the
 * numbers, then every limitation in full. If the whole thing will not fit, the
 * table loses rows from the end and says so — the metadata and the limitations
 * are the parts that keep the numbers honest, so they are never what gets cut.
 */
export function buildCopyReport(input: CopyReportInput): string {
  const header = [
    "# On-page keyword check",
    "",
    `- Page: ${inlineCode(input.targetUrl)}`,
    `- Collected at: ${inlineCode(input.scannedAt)}`,
    `- Crawl cache: ${inlineCode(input.cacheStatus)}`,
  ];

  if (input.evidence.availability === "unavailable") {
    // The two reasons are not the same fact. One says the page never came back
    // as readable HTML; the other says it did and its text did not survive the
    // projection. Printing the first for both misreports the second.
    const why =
      input.evidence.reason === "target_page_not_captured"
        ? [
            "The submitted page was not collected as a readable HTML response,",
            "so no coverage was measured.",
          ]
        : [
            "The submitted page was collected, but its text was not carried in",
            "the response, so no coverage was measured.",
          ];
    return [
      ...header,
      "",
      "## Result",
      "",
      `No keyword evidence: ${inlineCode(input.evidence.reason)}.`,
      ...why,
      "This is not a score of zero.",
      "",
    ].join("\n");
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

  for (let kept = rows.length; kept >= 0; kept -= 1) {
    const truncated = kept < rows.length;
    const table = [
      ...tableHead,
      ...rows.slice(0, kept).map((row) => `| ${row} |`),
      ...(truncated
        ? ["", `_${rows.length - kept} more rows omitted to fit._`]
        : []),
    ];
    const report = [...header, ...basis, ...table, ...numbers, ...limitations]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
    if (report.length <= COPY_REPORT_MAX_CHARS) return report;
  }

  // Even with no rows the fixed sections can exceed the budget once their
  // sentences are translated. The bound is a promise to whoever pastes this
  // somewhere with a limit, so it is enforced rather than approximated — and
  // dropping the coverage table entirely is still a cut, so it is announced.
  // A report that quietly lost its table would read as a page with nothing to
  // report about.
  const droppedTable = [
    ...header,
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
  if (droppedTable.length <= COPY_REPORT_MAX_CHARS) return droppedTable;

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
  if (essential.length <= COPY_REPORT_MAX_CHARS) return essential;

  /**
   * The limitations alone exceed the budget.
   *
   * Slicing the assembled text would take whole limitations off the end, and
   * "every limitation is published" is the rule this whole ordering exists to
   * keep — a report missing one reads as a page that has one fewer caveat.
   * So every limitation stays present and each one is shortened to an equal
   * share of what is left, marked where it was cut. Losing the tail of a
   * sentence is a visible loss; losing a whole caveat is an invisible one.
   */
  const bareHeader = [
    ...header,
    "",
    "_Every limitation below is shortened to fit, each marked where it was cut.",
    "The coverage table and the sections explaining the measurement are omitted._",
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
  let share = COPY_REPORT_MAX_CHARS;
  let rendered = render(share);
  while (rendered.length > COPY_REPORT_MAX_CHARS && share > 16) {
    share = Math.max(16, Math.floor(share / 2));
    rendered = render(share);
  }
  // At share 16 the limitation texts cannot be what overflows: only the header
  // and the codes themselves can, and both are bounded by the frozen vocabulary.
  return rendered.slice(0, COPY_REPORT_MAX_CHARS);
}
