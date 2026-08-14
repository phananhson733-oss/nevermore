// @input  — Markdown 源文本、marked、sanitize-html
// @output — frontmatter 解析、H2/H3 分节切分、围栏块提取、纯文本投影与受限 HTML 渲染
// @pos    — Prompt / Skill 资源库共享的 Markdown 契约层，被两个 loader 与详情页使用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

export interface ParsedResourceFile {
  readonly values: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface ResourceSubsection {
  readonly heading: string;
  readonly content: string;
}

/** A fence run at the start of a line, allowing CommonMark's 3-space indent. */
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Advance the fenced-block state for one line, returning the open fence marker
 * or null.
 *
 * Two CommonMark rules carry real weight here. A closing fence must be at least
 * as long as the one that opened the block, which is what lets an author wrap a
 * prompt that itself contains ``` in a longer ```` fence. And a closing fence
 * carries no info string, so the ```json inside such a prompt opens nothing and
 * closes nothing. Getting either wrong truncates a prompt at the point the
 * author was demonstrating output — silently, because the remaining text simply
 * stops being part of the block.
 */
function advanceFence(line: string, open: string | null): string | null {
  const match = FENCE_PATTERN.exec(line);
  if (!match?.[1]) return open;

  const marker = match[1];
  const trailing = line.slice(match[0].length).trim();

  if (open === null) {
    // A backtick fence's info string may not itself contain a backtick, so a
    // line like ```text `literal` opens nothing. Treating it as an opener would
    // swallow the headings that follow, or report a false unterminated block.
    if (marker[0] === "`" && trailing.includes("`")) return null;
    return marker;
  }

  const closes =
    marker[0] === open[0] && marker.length >= open.length && trailing === "";
  return closes ? null : open;
}

export function unquoteScalar(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parse the scalar-only frontmatter block shared by prompt and skill files.
 * Values stay strings here; each loader applies its own Zod schema, so an
 * unknown or malformed field fails at the boundary rather than downstream.
 */
export function parseResourceFrontmatter(
  source: string,
  sourceName: string,
): ParsedResourceFile {
  if (!source.startsWith("---\n")) {
    throw new Error(
      `${sourceName}: file must start with YAML-style frontmatter.`,
    );
  }

  const boundary = source.indexOf("\n---\n", 4);
  if (boundary === -1) {
    throw new Error(`${sourceName}: frontmatter closing delimiter is missing.`);
  }

  const raw = source.slice(4, boundary);
  const values: Record<string, string> = {};

  for (const [index, line] of raw.split("\n").entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (!match?.[1] || match[2] === undefined) {
      throw new Error(`${sourceName}:${index + 2}: invalid frontmatter line.`);
    }
    if (Object.hasOwn(values, match[1])) {
      throw new Error(
        `${sourceName}:${index + 2}: duplicate '${match[1]}' field.`,
      );
    }
    values[match[1]] = unquoteScalar(match[2]);
  }

  const body = source.slice(boundary + "\n---\n".length).trim();
  if (!body) {
    throw new Error(`${sourceName}: body must not be empty.`);
  }

  return { values, body };
}

/**
 * Split a body into its `##` sections.
 *
 * Fenced blocks are tracked because a prompt body legitimately contains its own
 * `#` headings — treating those as document structure would cut a prompt in
 * half at the point an author is least likely to look.
 */
export function splitResourceSections(
  body: string,
  sourceName: string,
): ReadonlyMap<string, string> {
  const sections = new Map<string, string>();
  let heading: string | null = null;
  let buffer: string[] = [];
  let fence: string | null = null;

  const flush = (): void => {
    if (heading === null) {
      // Text before the first `##` belongs to no section, so it would be
      // dropped on the floor while the file still parsed cleanly.
      const preamble = buffer.join("\n").trim();
      if (preamble !== "") {
        throw new Error(
          `${sourceName}: text before the first '## ' section would not be published: ${JSON.stringify(
            preamble.split("\n")[0],
          )}.`,
        );
      }
      return;
    }
    if (sections.has(heading)) {
      throw new Error(`${sourceName}: duplicate '## ${heading}' section.`);
    }
    sections.set(heading, buffer.join("\n").trim());
  };

  for (const line of body.split("\n")) {
    const nextFence = advanceFence(line, fence);
    if (nextFence !== fence) {
      fence = nextFence;
      buffer.push(line);
      continue;
    }

    const headingMatch = fence === null ? /^##\s+(.+?)\s*$/.exec(line) : null;
    if (headingMatch?.[1]) {
      flush();
      heading = headingMatch[1];
      buffer = [];
      continue;
    }

    buffer.push(line);
  }
  flush();

  if (fence !== null) {
    throw new Error(`${sourceName}: unterminated fenced code block.`);
  }

  return sections;
}

/** Split a section into its `###` subsections, preserving document order. */
export function splitResourceSubsections(
  section: string,
  sourceName: string,
  label: string,
): readonly ResourceSubsection[] {
  const subsections: ResourceSubsection[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];
  let fence: string | null = null;

  const seen = new Set<string>();
  const flush = (): void => {
    if (heading === null) {
      // Same reasoning as the section splitter: text before the first `###`
      // has no subsection to live in and would vanish from the page.
      const preamble = buffer.join("\n").trim();
      if (preamble !== "") {
        throw new Error(
          `${sourceName}: '${label}' has text before its first '### ' heading, which would not be published: ${JSON.stringify(
            preamble.split("\n")[0],
          )}.`,
        );
      }
      return;
    }
    // Duplicate headings become duplicate React keys and a card or FAQ entry
    // rendered twice, which reads as a content mistake nobody put there.
    if (seen.has(heading)) {
      throw new Error(
        `${sourceName}: '${label}' repeats the '### ${heading}' heading.`,
      );
    }
    seen.add(heading);
    subsections.push({ heading, content: buffer.join("\n").trim() });
  };

  for (const line of section.split("\n")) {
    const nextFence = advanceFence(line, fence);
    if (nextFence !== fence) {
      fence = nextFence;
      buffer.push(line);
      continue;
    }

    const headingMatch = fence === null ? /^###\s+(.+?)\s*$/.exec(line) : null;
    if (headingMatch?.[1]) {
      flush();
      heading = headingMatch[1];
      buffer = [];
      continue;
    }

    buffer.push(line);
  }
  flush();

  // Checked here as well as in the section splitter: a fence left open in the
  // last subsection would otherwise pass, because the enclosing section already
  // has its required number of subsections and nothing else looks wrong.
  if (fence !== null) {
    throw new Error(
      `${sourceName}: '${label}' has an unterminated fenced code block.`,
    );
  }

  return subsections;
}

/**
 * Return the contents of the first fenced block in a section.
 *
 * Prompt and skill-file text is served verbatim — to the clipboard and to the
 * download route — so it is extracted rather than rendered.
 */
export function extractFencedBlock(
  section: string,
  sourceName: string,
  label: string,
): string {
  let fence: string | null = null;
  let collected: string[] | null = null;
  let completed: string | null = null;
  const stray: string[] = [];

  for (const line of section.split("\n")) {
    const nextFence = advanceFence(line, fence);

    if (fence === null && nextFence === null && line.trim() !== "") {
      // Prose outside the block. The section maps to a single string, so this
      // text has nowhere to render — keeping it silently would publish a prompt
      // missing the sentence its author wrote right above it.
      stray.push(line.trim());
    }

    if (fence === null && nextFence !== null) {
      if (completed !== null) {
        // A second block means the author's intent is ambiguous — most often a
        // prompt demonstrating output whose inner fence closed the outer one
        // early. Refusing turns a silently half-published prompt into a build
        // error that names the file.
        throw new Error(
          `${sourceName}: '${label}' contains more than one fenced code block. Wrap the whole block in a longer fence (\`\`\`\`) when it needs to contain one.`,
        );
      }
      fence = nextFence;
      collected = [];
      continue;
    }

    if (fence !== null && nextFence === null) {
      // Joined without trimming. The opener and closer lines are already
      // excluded structurally, so everything between them is the payload — and
      // this string is what the copy button copies and the download route
      // serves. Trimming it would silently rewrite an author's leading
      // indentation and trailing lines while the type still promised verbatim.
      completed = (collected ?? []).join("\n");
      fence = null;
      collected = null;
      continue;
    }

    if (collected !== null) collected.push(line);
  }

  if (stray.length > 0) {
    throw new Error(
      `${sourceName}: '${label}' has text outside its fenced block, which would not be published: ${JSON.stringify(
        stray[0],
      )}${stray.length > 1 ? ` (and ${stray.length - 1} more line(s))` : ""}.`,
    );
  }

  if (fence !== null) {
    throw new Error(
      `${sourceName}: '${label}' has an unterminated fenced code block.`,
    );
  }
  if (completed === null) {
    throw new Error(
      `${sourceName}: '${label}' must contain a closed fenced code block.`,
    );
  }

  return completed;
}

/**
 * Flatten Markdown to the words a reader would hear.
 *
 * Structured data must carry the same answer the page shows; deriving the
 * schema text from the rendered source keeps the two from drifting.
 */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/(^|\n)(`{3,}|~{3,})[\s\S]*?\n\2/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    // No italic-underscore rule: prompts document snake_case variable names,
    // and a pair-matching underscore rule turns "put {{a_b}} into c_d" into
    // "ab into cd" — the schema would then contradict the visible answer.
    .replace(/\s+/g, " ")
    .trim();
}

const marked = new Marked({ async: false, breaks: false, gfm: true });

/**
 * The tag set a resource page may render. Deliberately narrower than the blog's:
 * resource prose is authored to a section contract, and no section is meant to
 * introduce its own images or top-level headings.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "em",
    "h4",
    "h5",
    "h6",
    "hr",
    "li",
    "ol",
    "p",
    "pre",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    code: ["class"],
    ol: ["start"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
};

/** Render authored Markdown to an allow-listed HTML subset. */
export function renderResourceMarkdown(markdown: string): string {
  const rendered = marked.parse(markdown);
  if (typeof rendered !== "string") {
    throw new Error("Expected synchronous Markdown rendering to return HTML.");
  }
  return sanitizeHtml(rendered, SANITIZE_OPTIONS);
}

/** Require a section, failing closed so a half-written file never ships. */
export function requireSection(
  sections: ReadonlyMap<string, string>,
  name: string,
  sourceName: string,
): string {
  const section = sections.get(name);
  if (!section) {
    throw new Error(`${sourceName}: missing required '## ${name}' section.`);
  }
  return section;
}

/** Parse a `- item` list, rejecting empty lists so cards never render blank. */
export function parseBulletList(
  section: string,
  sourceName: string,
  label: string,
): readonly string[] {
  const lines = section.split("\n");

  // Fence-aware like every other splitter here: a "- item" inside a fenced
  // example is example text, and promoting it would put a bullet on the page
  // that the author never wrote as one.
  const outsideFences: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const nextFence = advanceFence(line, fence);
    if (nextFence !== fence) {
      fence = nextFence;
      continue;
    }
    if (fence === null) outsideFences.push(line);
  }
  if (fence !== null) {
    throw new Error(
      `${sourceName}: '${label}' has an unterminated fenced code block.`,
    );
  }

  const items = outsideFences
    .map((line) => /^\s{0,3}[-*+]\s+(.+?)\s*$/.exec(line)?.[1])
    .filter((item): item is string => Boolean(item));

  if (new Set(items).size !== items.length) {
    throw new Error(`${sourceName}: '${label}' repeats an item.`);
  }

  // These sections render as flat lists, so a nested bullet has nowhere to go.
  // Dropping it quietly is the failure worth preventing: the author sees their
  // sub-point in the file and never on the page.
  // A tab is a single \s, so a \s{4,} test never sees a tab-indented sub-item.
  const nested = outsideFences.filter((line) =>
    /^(?:\t|\s{4,})\s*[-*+]\s+\S/.test(line),
  );
  if (nested.length > 0) {
    throw new Error(
      `${sourceName}: '${label}' must be a flat list; nested items are not rendered (${nested.length} found).`,
    );
  }

  const prose = outsideFences.filter(
    (line) => line.trim() !== "" && !/^\s*[-*+]\s+/.test(line),
  );
  if (prose.length > 0) {
    throw new Error(
      `${sourceName}: '${label}' renders as a flat list, so this line would not be published: ${JSON.stringify(
        prose[0]?.trim(),
      )}.`,
    );
  }

  if (items.length === 0) {
    throw new Error(`${sourceName}: '${label}' must list at least one item.`);
  }
  return items;
}
