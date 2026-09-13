import type { ArtifactType } from "../types.ts";

export const SAMPLE_CSV_MARKER = "# sample-data";

const LINE_FEED = 10;

/**
 * The one text shape every stamped artifact leaves this module in: LF line
 * endings and no trailing newline. Design §6.8 states it for csv; it holds for
 * all four types because the AI wrapper needs it (Q23). `fenceBlock` rewrites
 * every CR to LF and absorbs a body's final LF into its closing fence, so for
 * any other shape the AI payload differs from what copy, export and save hand
 * over, and "x" and "x\n" wrap to the same prompt. On this shape both rewrites
 * are no-ops, so payload === content holds by construction instead of by every
 * builder happening to emit the right bytes. `fenceBlock` itself is shared by
 * the prompt builders and stays as it is.
 *
 * Applied to the whole stamped text, not to the body alone: an empty or
 * newline-only body would otherwise leave the notice's own separator trailing.
 * The trailing strip is a backwards scan, not `/\n+$/`, which re-scans a long
 * newline run from every start position (quadratic). Only line endings change —
 * U+2028, trailing spaces and everything else are content and are kept.
 *
 * One consequence worth knowing: a CR inside a quoted CSV cell becomes LF. A CSV
 * reader treats both as a line break inside the cell, and keeping the CR would
 * break the one-text invariant for every artifact that carries one.
 */
function canonicalText(text: string): string {
  const unified = text.replace(/\r\n?/g, "\n");
  let end = unified.length;
  while (end > 0 && unified.charCodeAt(end - 1) === LINE_FEED) end -= 1;
  return unified.slice(0, end);
}

/**
 * Stamps the §6.8 provenance onto an artifact body (R5). `line` is already
 * localised by the caller; one that folds to nothing throws rather than ship an
 * artifact without its declaration. Every result is in the canonical shape
 * above: json by re-serialisation, the other three by `canonicalText`. For json,
 * `JSON.stringify` always lists integer-like keys first, so such a top-level key
 * lands ahead of `_sampleData` (pinned by the "integer-like top-level keys" case
 * in `provenance.test.ts`).
 */
export function stampArtifact(
  type: ArtifactType,
  body: string,
  line: string,
): string {
  const notice = line.replace(/[\r\n]+/g, " ").trim();
  if (notice === "") {
    throw new Error("stampArtifact: provenance line is empty");
  }
  switch (type) {
    case "csv":
      return canonicalText(`${SAMPLE_CSV_MARKER}\n# ${notice}\n${body}`);
    case "json": {
      const parsed: unknown = JSON.parse(body);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error("stampArtifact: json artifacts must be a JSON object");
      }
      // A body key named _sampleData must not overwrite the declaration, so drop it before spreading.
      const { _sampleData: _ignored, ...rest } = parsed as Record<
        string,
        unknown
      >;
      // `<`, U+2028 and U+2029 can only occur inside JSON strings, so escaping them keeps the parsed value
      // identical while the text stays safe to paste into <script type="application/ld+json">. This is the
      // one place every json artifact's final text is produced; a builder cannot do it (this re-serializes).
      return JSON.stringify({ _sampleData: notice, ...rest }, null, 2)
        .replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
    }
    case "md":
    case "prompt":
      return canonicalText(`${notice}\n\n${body}`);
  }
}
