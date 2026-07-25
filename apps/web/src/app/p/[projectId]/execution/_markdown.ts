/**
 * A small, closed Markdown reader for model-written bodies.
 *
 * The draft and the brief are the evidence a reviewer judges, so they have to
 * read as prose rather than as a JSON blob — but they are also model output,
 * which is untrusted. This module parses text into a CLOSED node set: there is
 * no node kind that carries markup, so raw HTML in a body can only ever come
 * back out as the characters the model wrote. The renderer builds React
 * elements from these nodes and never touches `dangerouslySetInnerHTML`.
 *
 * Link addresses are filtered here rather than at render time, so the rule is
 * testable without a browser: only `http`/`https` survive, and anything else
 * stays literal text.
 */

export type InlineNode =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "em"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

export type MarkdownBlock =
  | {
      readonly kind: "heading";
      readonly level: 1 | 2 | 3 | 4;
      readonly inline: readonly InlineNode[];
    }
  | { readonly kind: "paragraph"; readonly inline: readonly InlineNode[] }
  | { readonly kind: "quote"; readonly inline: readonly InlineNode[] }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly items: readonly (readonly InlineNode[])[];
    }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "rule" }
  | {
      readonly kind: "table";
      readonly header: readonly (readonly InlineNode[])[];
      readonly rows: readonly (readonly (readonly InlineNode[])[])[];
    };

const HEADING = /^(#{1,4})\s+(.*)$/u;
const UNORDERED = /^\s*[-*+]\s+(.*)$/u;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/u;
const QUOTE = /^\s*>\s?(.*)$/u;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u;
const FENCE = /^\s*```/u;
const TABLE_ROW = /^\s*\|.*\|\s*$/u;
const TABLE_DIVIDER = /^\s*\|[\s:|-]+\|\s*$/u;

/**
 * Emphasis requires a non-space right inside the markers, so a body that uses
 * `*` as a bullet or a literal asterisk does not silently become italics.
 */
const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*\S(?:[^*\n]*\S)?\*)|(_\S(?:[^_\n]*\S)?_)|(\[[^\]]*\]\([^)\s]+\))/u;

/** Only addresses a browser can safely follow; everything else stays text. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  return /^https?:\/\/[^\s<>"']+$/iu.test(href) ? href : null;
}

export function parseInline(text: string): readonly InlineNode[] {
  const out: InlineNode[] = [];
  let rest = text;
  const pushText = (value: string): void => {
    if (value.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") {
      out[out.length - 1] = { kind: "text", text: last.text + value };
      return;
    }
    out.push({ kind: "text", text: value });
  };

  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (!match) {
      pushText(rest);
      break;
    }
    pushText(rest.slice(0, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      out.push({ kind: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("**") || token.startsWith("__")) {
      out.push({ kind: "strong", text: token.slice(2, -2) });
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      if (href === null) pushText(token);
      else
        out.push({ kind: "link", text: label.length > 0 ? label : href, href });
    } else {
      out.push({ kind: "em", text: token.slice(1, -1) });
    }
    rest = rest.slice(match.index + token.length);
  }
  return out;
}

function tableCells(line: string): readonly (readonly InlineNode[])[] {
  return line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => parseInline(cell.trim()));
}

export function parseMarkdown(markdown: string): readonly MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ");
    paragraph = [];
    blocks.push({ kind: "paragraph", inline: parseInline(text) });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    if (FENCE.test(line)) {
      flushParagraph();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i] ?? "")) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      const level = (heading[1] ?? "#").length as 1 | 2 | 3 | 4;
      blocks.push({
        kind: "heading",
        level,
        inline: parseInline(heading[2] ?? ""),
      });
      continue;
    }

    if (
      TABLE_ROW.test(line) &&
      i + 1 < lines.length &&
      TABLE_DIVIDER.test(lines[i + 1] ?? "")
    ) {
      flushParagraph();
      const header = tableCells(line);
      i += 2;
      const rows: (readonly (readonly InlineNode[])[])[] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i] ?? "")) {
        rows.push(tableCells(lines[i] ?? ""));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      const quoted: string[] = [quote[1] ?? ""];
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1] ?? "")) {
        i += 1;
        quoted.push(QUOTE.exec(lines[i] ?? "")?.[1] ?? "");
      }
      blocks.push({ kind: "quote", inline: parseInline(quoted.join(" ")) });
      continue;
    }

    const unordered = UNORDERED.exec(line);
    const ordered = ORDERED.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = ordered !== null && unordered === null;
      const items: string[] = [(unordered ?? ordered)?.[1] ?? ""];
      while (i + 1 < lines.length) {
        const peek = lines[i + 1] ?? "";
        const next = isOrdered ? ORDERED.exec(peek) : UNORDERED.exec(peek);
        if (!next) break;
        i += 1;
        items.push(next[1] ?? "");
      }
      blocks.push({
        kind: "list",
        ordered: isOrdered,
        items: items.map((item) => parseInline(item)),
      });
      continue;
    }

    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}
