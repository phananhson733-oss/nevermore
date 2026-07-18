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

/** Raw HTML / script tags that spec §14.4 forbids in rendered markdown. */
const HTML_TAG_PATTERN = /<\s*\/?\s*(script|html|iframe|style|object|embed|link|meta|svg|form)\b/i;
const JS_URI_PATTERN = /javascript\s*:/i;

interface ParsedSection {
  readonly heading: string;
  readonly body: string;
}

const LEVEL2_HEADING = /^##(?!#)[ \t]+(.+?)[ \t]*$/;
const LEVEL1_OR_2_HEADING = /^#{1,2}(?!#)[ \t]+/;

function parseSections(markdown: string): readonly ParsedSection[] {
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

function normalizeHeading(value: string): string {
  return value
    .trim()
    .replace(/[:：]\s*$/u, "")
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function headingMatches(heading: string, alias: string): boolean {
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
    if (HTML_TAG_PATTERN.test(markdown) || JS_URI_PATTERN.test(markdown)) {
      errors.push("markdown contains disallowed raw HTML/script (spec §14.4)");
    }
  }

  const sections = parseSections(markdown);
  for (const req of requiredSections) {
    const match = sections.find((s) => req.aliases.some((alias) => headingMatches(s.heading, alias)));
    if (match === undefined) {
      errors.push(`missing required section: ## ${req.label}`);
    } else if (match.body.trim().length === 0) {
      errors.push(`empty required section: ## ${req.label}`);
    }
  }

  return errors;
}
