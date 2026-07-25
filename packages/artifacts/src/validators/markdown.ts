/**
 * Deterministic markdown section validator (spec §10.1, §14.4). Returns an
 * array of human-readable error strings; an empty array means the markdown
 * satisfies the required-section contract and is safe to render.
 *
 * A "section" is a level-2 (`## `) heading and the body up to the next level-1
 * or level-2 heading. A required section may be satisfied by any of its aliases
 * (used to accept both English and zh-CN headings for the same section).
 */

/** A required section, satisfied when any alias appears as a `## ` heading. */
export interface RequiredSection {
  /** Human-readable label used in error messages. */
  readonly label: string;
  /** Accepted heading texts (any one present satisfies the requirement). */
  readonly aliases: readonly string[];
}

export interface MarkdownValidationOptions {
  /** When true, skip the raw-HTML/script sanitization check. Default false. */
  readonly allowHtml?: boolean;
}

/**
 * Any raw-HTML opener forbidden by spec §14.4: start/end tags, comments,
 * declarations, processing instructions, and CDATA sections. Real tag names
 * begin immediately after `<` / `</` with an ASCII letter; the other branches
 * mirror CommonMark raw-HTML block openers. Requiring a concrete opener keeps
 * comparison prose such as `plans < pro` valid.
 */
const RAW_HTML_PATTERN = /<(?:\/?[a-z]|!--|\?|![a-z]|!\[cdata\[)/i;

/** Inline `on*=` handler syntax, including mixed case and line whitespace. */
const EVENT_HANDLER_PATTERN = /(?:^|[\s"'`/])on[a-z][a-z0-9_-]*[ \t\r\n]*=/i;

/**
 * A javascript URI, allowing tabs/newlines between scheme characters because
 * URL preprocessing can discard those control characters before evaluation.
 */
const JS_URI_PATTERN =
  /j[\t\r\n]*a[\t\r\n]*v[\t\r\n]*a[\t\r\n]*s[\t\r\n]*c[\t\r\n]*r[\t\r\n]*i[\t\r\n]*p[\t\r\n]*t[ \t\r\n]*:/i;

const NUMERIC_CHARACTER_REFERENCE = /&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));?/gi;
const SECURITY_NAMED_REFERENCE = /&(colon|tab|newline);/gi;

/** Decode only character references relevant to active URI/handler scanning. */
function decodeSecurityCharacterReferences(value: string): string {
  return value
    .replace(
      NUMERIC_CHARACTER_REFERENCE,
      (reference, hex: string | undefined, decimal: string | undefined) => {
        const digits = hex ?? decimal;
        if (digits === undefined) return reference;
        const codePoint = Number.parseInt(digits, hex === undefined ? 10 : 16);
        if (
          !Number.isFinite(codePoint) ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return reference;
        }
        return String.fromCodePoint(codePoint);
      },
    )
    .replace(SECURITY_NAMED_REFERENCE, (_reference, name: string) => {
      switch (name.toLowerCase()) {
        case "colon":
          return ":";
        case "tab":
          return "\t";
        case "newline":
          return "\n";
        default:
          return _reference;
      }
    });
}

export interface ParsedSection {
  readonly heading: string;
  readonly body: string;
}

const LEVEL2_HEADING = /^##(?!#)[ \t]+(.+?)[ \t]*$/;
const LEVEL1_OR_2_HEADING = /^#{1,2}(?!#)[ \t]+/;

/**
 * Split markdown into its `## ` sections, in document order.
 *
 * Exported (behaviour unchanged) so the Content Shadow brief-outline extractor
 * reads a brief through EXACTLY the same heading grammar the validator uses.
 * Two implementations of "what is a section" would let a heading the validator
 * requires disagree with the heading the draft prompt is told about.
 */
export function parseMarkdownSections(
  markdown: string,
): readonly ParsedSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: ParsedSection[] = [];
  let heading: string | null = null;
  let body: string[] = [];

  const flush = (): void => {
    if (heading !== null) {
      sections.push({ heading, body: body.join("\n") });
    }
  };

  for (const line of lines) {
    const level2 = LEVEL2_HEADING.exec(line);
    if (level2 && level2[1] !== undefined) {
      flush();
      heading = level2[1];
      body = [];
      continue;
    }
    // A level-1 heading closes the current section without opening a new one.
    if (LEVEL1_OR_2_HEADING.test(line)) {
      flush();
      heading = null;
      body = [];
      continue;
    }
    if (heading !== null) {
      body.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * Case/spacing/trailing-colon-insensitive heading key (validator semantics).
 *
 * Step order is load-bearing. Folding whitespace FIRST and stripping the whole
 * trailing colon/whitespace run AFTER is what makes `"Growth Loop"`,
 * `"Growth Loop:"`, `"Growth Loop :"` and `"Growth Loop ::"` one key. Stripping
 * a single colon first left the space that preceded it behind (`"X :"` -> `"x "`),
 * so headings that differ only by punctuation keyed differently — and any caller
 * that de-duplicates or budgets by this key would then treat one topic as many.
 */
export function normalizeHeading(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[\s:：]+$/u, "")
    .toLowerCase();
}

/** True when `heading` equals an alias or extends it as a prefix word. */
export function headingMatches(heading: string, alias: string): boolean {
  const h = normalizeHeading(heading);
  const a = normalizeHeading(alias);
  return h === a || h.startsWith(`${a} `);
}

/**
 * Validate that every required section is present (as a `## ` heading) and has a
 * non-empty body, and that the markdown carries no forbidden raw HTML/script.
 */
export function validateMarkdownSections(
  markdown: string,
  requiredSections: readonly RequiredSection[],
  opts?: MarkdownValidationOptions,
): string[] {
  if (typeof markdown !== "string" || markdown.trim().length === 0) {
    return ["markdown content is empty"];
  }

  const errors: string[] = [];

  if (opts?.allowHtml !== true) {
    const activeContent = decodeSecurityCharacterReferences(markdown);
    if (
      RAW_HTML_PATTERN.test(markdown) ||
      EVENT_HANDLER_PATTERN.test(activeContent) ||
      JS_URI_PATTERN.test(activeContent)
    ) {
      errors.push("markdown contains disallowed raw HTML/script (spec §14.4)");
    }
  }

  const sections = parseMarkdownSections(markdown);
  for (const req of requiredSections) {
    const match = sections.find((s) =>
      req.aliases.some((alias) => headingMatches(s.heading, alias)),
    );
    if (match === undefined) {
      errors.push(`missing required section: ## ${req.label}`);
    } else if (match.body.trim().length === 0) {
      errors.push(`empty required section: ## ${req.label}`);
    }
  }

  return errors;
}
