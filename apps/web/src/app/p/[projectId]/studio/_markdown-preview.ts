import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

const markdown = new Marked({
  async: false,
  breaks: false,
  gfm: true,
  renderer: {
    // Studio content is model-authored. Markdown syntax is supported, but raw
    // HTML and embedded resources are never part of the preview surface.
    html: () => "",
    image: () => "",
  },
});

const STUDIO_MARKDOWN_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "a",
    "blockquote",
    "code",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
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
    ol: ["start"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
};

const SAFE_TABLE_OPEN =
  '<div data-studio-markdown-table-scroll="true"><table>';
const SAFE_TABLE_CLOSE = "</table></div>";

/**
 * Add the one non-Markdown element used by the preview after sanitization.
 *
 * Raw HTML is discarded by the Marked renderer and the sanitizer does not
 * allow `div`, so model-authored content cannot forge this data attribute.
 */
function wrapSanitizedTables(safeHtml: string): string {
  return safeHtml
    .replaceAll("<table>", SAFE_TABLE_OPEN)
    .replaceAll("</table>", SAFE_TABLE_CLOSE);
}

/** Render model-authored Markdown into the Studio preview's safe HTML subset. */
export function renderStudioMarkdown(source: string): string {
  const rendered = markdown.parse(source);
  if (typeof rendered !== "string") {
    throw new Error("Expected synchronous Studio Markdown rendering.");
  }

  const safeHtml = sanitizeHtml(rendered, STUDIO_MARKDOWN_SANITIZE_OPTIONS);
  return wrapSanitizedTables(safeHtml);
}
