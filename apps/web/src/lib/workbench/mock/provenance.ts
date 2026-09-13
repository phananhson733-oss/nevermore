import type { ArtifactType } from "../types.ts";

export const SAMPLE_CSV_MARKER = "# sample-data";

/**
 * Stamps the §6.8 provenance onto an artifact body (R5). `line` is already
 * localised by the caller; one that folds to nothing throws rather than ship an
 * artifact without its declaration. For json, `JSON.stringify` always lists
 * integer-like keys first, so such a top-level key lands ahead of
 * `_sampleData` (pinned by the "integer-like top-level keys" case in
 * `provenance.test.ts`).
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
      return `${SAMPLE_CSV_MARKER}\n# ${notice}\n${body}`;
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
      return `${notice}\n\n${body}`;
  }
}
