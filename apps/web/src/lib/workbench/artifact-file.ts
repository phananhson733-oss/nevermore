/**
 * What an artifact is called and what media type it is handed over as when the
 * operator saves it (裁决 Q35).
 *
 * It lives in `lib/` rather than next to one of its callers because there are
 * two of them, in two layers: the artifact drawer in `shell/` and the four-action
 * footer in `ui/`. `ui/` must not import `shell/`, and a second copy of the
 * sanitiser is worse than either — the version nobody edits is the one that
 * keeps letting a path separator through.
 *
 * `download.ts` is deliberately still a dumb sink: it takes a name and a MIME
 * type and creates the blob. Deciding them is this module's job.
 */

import { truncateUtf16 } from "./truncate.ts";
import type { Artifact, ArtifactType } from "./types.ts";

type AssertNever<T extends never> = T;

/**
 * `satisfies`, not an annotation: the annotation would make `keyof typeof`
 * collapse to `ArtifactType` and the guards below tautological, while this
 * keeps the object literal's own keys and still makes a fifth artifact type a
 * compile error right here. `artifact-file.test.ts` carries the runtime half,
 * against the separately written `ARTIFACT_TYPES` list.
 */
export const ARTIFACT_MIME = {
  csv: "text/csv;charset=utf-8",
  md: "text/markdown;charset=utf-8",
  json: "application/json;charset=utf-8",
  prompt: "text/plain;charset=utf-8",
} as const satisfies Readonly<Record<ArtifactType, string>>;

/** The extension always follows `type`, never whatever the stored name ends in. */
export const ARTIFACT_EXT = {
  csv: "csv",
  md: "md",
  json: "json",
  prompt: "txt",
} as const satisfies Readonly<Record<ArtifactType, string>>;

// Both directions, and against the object literals rather than their
// annotations: a table that lost a key, and a table that grew a key no artifact
// type has, are different defects and neither should compile.
type _MimeCoversEveryType = AssertNever<
  Exclude<ArtifactType, keyof typeof ARTIFACT_MIME>
>;
type _MimeHasNoStrangerKeys = AssertNever<
  Exclude<keyof typeof ARTIFACT_MIME, ArtifactType>
>;
type _ExtCoversEveryType = AssertNever<
  Exclude<ArtifactType, keyof typeof ARTIFACT_EXT>
>;
type _ExtHasNoStrangerKeys = AssertNever<
  Exclude<keyof typeof ARTIFACT_EXT, ArtifactType>
>;

/** Longest stem the download name keeps; the schema already caps a stored `filename` at 120. */
const STEM_MAX = 100;

/**
 * The name the browser is handed for a download. The stored `filename` (or the
 * title) is only a suggestion: everything outside `[\p{L}\p{N}_ .()-]` (the
 * same class as `ARTIFACT_FILENAME_PATTERN`, so a Chinese title survives)
 * becomes `_`, so no path separator or control character reaches the save
 * dialog, the stem is cut at `STEM_MAX`, and a text extension it carried is
 * replaced by the one the artifact `type` dictates — a `.md` artifact named
 * `report.csv` is `report.md`. Only the known text extensions are stripped, so
 * a title such as `Release 1.2` keeps its `.2`. Leading dots go too: `.env`
 * would otherwise be handed over as the hidden file `.env.md`, and `..` as
 * `...md`. A stem that sanitises to nothing falls back to `artifact` so the
 * file never ends up as a bare, hidden `.csv`.
 */
export function downloadName(artifact: Artifact): string {
  const stem = truncateUtf16(
    (artifact.filename ?? artifact.title)
      .replace(/[^\p{L}\p{N}_ .()-]/gu, "_")
      .replace(/\.(?:csv|md|markdown|json|txt|prompt)$/i, "")
      .trim()
      .replace(/^[. ]+/, ""),
    STEM_MAX,
  );
  return `${stem === "" ? "artifact" : stem}.${ARTIFACT_EXT[artifact.type]}`;
}
