/**
 * metadata_rewrite JSON validator (spec §10.1). The Zod schema encodes the
 * minimum content contract: url + current/proposed title + current/proposed
 * description + targetQueries + rationale + evidenceRefs. Unknown current values
 * are `null` (never fabricated), so `currentTitle`/`currentDescription` are
 * nullable while the proposed rewrites must be non-empty.
 */

import { z } from "zod";

/**
 * Persisted-content safety bounds. Title/description/rationale mirror the LLM
 * output gate (the template's 65/155 limits remain generation-quality targets,
 * not the manual-editor contract). Query text uses the machine contract's
 * 500-character keyword/ICP short-text bound; array caps prevent amplification.
 * Evidence ids are UUIDs in production, but the wider bound deliberately keeps
 * existing deterministic/non-UUID fixture ids compatible.
 */
const METADATA_LIMITS = {
  urlChars: 2_048,
  titleChars: 512,
  descriptionChars: 2_048,
  rationaleChars: 8_000,
  targetQueries: 100,
  targetQueryChars: 500,
  evidenceRefs: 100,
  evidenceRefChars: 256,
} as const;

function boundedTrimmedString(maxChars: number): z.ZodString {
  return z
    .string()
    .min(1)
    .max(maxChars)
    .refine((value) => value.trim() === value, {
      message: "must not have leading or trailing whitespace",
    });
}

function isAbsoluteHttpUrlWithoutCredentials(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}

const metadataUrlSchema = boundedTrimmedString(METADATA_LIMITS.urlChars).refine(
  isAbsoluteHttpUrlWithoutCredentials,
  "must be an absolute http(s) URL without credentials",
);
const metadataTitleSchema = boundedTrimmedString(METADATA_LIMITS.titleChars);
const metadataDescriptionSchema = boundedTrimmedString(
  METADATA_LIMITS.descriptionChars,
);

export const metadataRewriteSchema = z
  .object({
    /** The page under rewrite. `null` when the subject URL is not known (§1.3). */
    url: metadataUrlSchema.nullable(),
    /** The live title, or `null` when unknown — never fabricated. */
    currentTitle: metadataTitleSchema.nullable(),
    /** The proposed rewrite; must be a non-empty placeholder to edit. */
    proposedTitle: metadataTitleSchema,
    /** The live meta description, or `null` when unknown. */
    currentDescription: metadataDescriptionSchema.nullable(),
    /** The proposed rewrite; must be a non-empty placeholder to edit. */
    proposedDescription: metadataDescriptionSchema,
    /** Target queries the rewrite should serve. */
    targetQueries: z
      .array(boundedTrimmedString(METADATA_LIMITS.targetQueryChars))
      .max(METADATA_LIMITS.targetQueries),
    /** Why this rewrite is proposed. */
    rationale: boundedTrimmedString(METADATA_LIMITS.rationaleChars),
    /** Evidence ids backing the rewrite (may be empty when no excerpts exist). */
    evidenceRefs: z
      .array(boundedTrimmedString(METADATA_LIMITS.evidenceRefChars))
      .max(METADATA_LIMITS.evidenceRefs),
  })
  .strict();

export type MetadataRewrite = z.infer<typeof metadataRewriteSchema>;

/**
 * Raw HTML / script tags, inline event handlers, and JS URIs forbidden in ANY
 * string field (spec §14.4). These rules intentionally match the Markdown
 * validator so changing content format cannot bypass the safety boundary.
 *
 * A concrete raw-HTML opener is required, so comparison prose such as
 * "plans < pro" remains valid. URI/handler scanning first decodes security-
 * relevant character references and tolerates control whitespace inside the
 * javascript scheme, matching browser/CommonMark preprocessing behavior.
 */
const RAW_HTML_PATTERN = /<(?:\/?[a-z]|!--|\?|![a-z]|!\[cdata\[)/i;
const EVENT_HANDLER_PATTERN = /(?:^|[\s"'`/])on[a-z][a-z0-9_-]*[ \t\r\n]*=/i;
const JS_URI_PATTERN =
  /j[\t\r\n]*a[\t\r\n]*v[\t\r\n]*a[\t\r\n]*s[\t\r\n]*c[\t\r\n]*r[\t\r\n]*i[\t\r\n]*p[\t\r\n]*t[ \t\r\n]*:/i;

const NUMERIC_CHARACTER_REFERENCE =
  /&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));?/gi;
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
    .replace(SECURITY_NAMED_REFERENCE, (reference, name: string) => {
      switch (name.toLowerCase()) {
        case "colon":
          return ":";
        case "tab":
          return "\t";
        case "newline":
          return "\n";
        default:
          return reference;
      }
    });
}

/** Collect every string leaf in the metadata object for sanitization scanning. */
function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(stringLeaves);
  }
  return [];
}

/**
 * Validate a metadata_rewrite content object. Returns an array of error strings;
 * an empty array means the object satisfies the schema AND carries no unsafe
 * HTML/script (spec §14.4) — a revision with errors can never be set `ready`.
 */
export function validateMetadata(content: unknown): string[] {
  if (
    typeof content !== "object" ||
    content === null ||
    Array.isArray(content)
  ) {
    return ["metadata content must be a JSON object"];
  }

  const errors: string[] = [];
  for (const leaf of stringLeaves(content)) {
    const activeContent = decodeSecurityCharacterReferences(leaf);
    if (
      RAW_HTML_PATTERN.test(leaf) ||
      EVENT_HANDLER_PATTERN.test(activeContent) ||
      JS_URI_PATTERN.test(activeContent)
    ) {
      errors.push("metadata contains disallowed raw HTML/script (spec §14.4)");
      break;
    }
  }

  const result = metadataRewriteSchema.safeParse(content);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path =
        issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
      errors.push(`${path}: ${issue.message}`);
    }
  }
  return errors;
}
