import type { ArtifactType } from "../types.ts";

export const SAMPLE_CSV_MARKER = "# sample-data";

/**
 * Stamps the §6.8 provenance onto an artifact body (R5). `line` is already
 * localised by the caller. For json, `_sampleData` is the first key unless the
 * body has integer-like top-level keys: `JSON.stringify` always lists those
 * first. No builder emits such a key.
 */
export function stampArtifact(
  type: ArtifactType,
  body: string,
  line: string,
): string {
  const notice = line.replace(/[\r\n]+/g, " ").trim();
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
      return JSON.stringify({ _sampleData: notice, ...rest }, null, 2);
    }
    case "md":
    case "prompt":
      return `${notice}\n\n${body}`;
  }
}
