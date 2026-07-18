/**
 * metadata_rewrite JSON validator (spec §10.1). The Zod schema encodes the
 * minimum content contract: url + current/proposed title + current/proposed
 * description + targetQueries + rationale + evidenceRefs. Unknown current values
 * are `null` (never fabricated), so `currentTitle`/`currentDescription` are
 * nullable while the proposed rewrites must be non-empty.
 */

import { z } from "zod";

export const metadataRewriteSchema = z.object({
  /** The page under rewrite. `null` when the subject URL is not known (§1.3). */
  url: z.string().min(1).nullable(),
  /** The live title, or `null` when unknown — never fabricated. */
  currentTitle: z.string().nullable(),
  /** The proposed rewrite; must be a non-empty placeholder to edit. */
  proposedTitle: z.string().min(1),
  /** The live meta description, or `null` when unknown. */
  currentDescription: z.string().nullable(),
  /** The proposed rewrite; must be a non-empty placeholder to edit. */
  proposedDescription: z.string().min(1),
  /** Target queries the rewrite should serve. */
  targetQueries: z.array(z.string()),
  /** Why this rewrite is proposed. */
  rationale: z.string().min(1),
  /** Evidence ids backing the rewrite (may be empty when no excerpts exist). */
  evidenceRefs: z.array(z.string()),
});

export type MetadataRewrite = z.infer<typeof metadataRewriteSchema>;

/**
 * Raw HTML / script tags, inline event handlers, and JS URIs forbidden in ANY
 * string field (spec §14.4). Model output is untrusted; an unlisted tag like
 * `<img src=x onerror=alert(1)>` must never validate, so we reject ANY HTML tag
 * opener rather than a fixed allow/deny list of tag names.
 *
 * `HTML_TAG_PATTERN` encodes the HTML tag-open rule: `<` or `</` IMMEDIATELY
 * followed by an ASCII letter starts a tag, so plain prose like "plans < pro"
 * (a space or non-letter after `<`) stays valid — SEO titles rarely need `<`.
 */
const HTML_TAG_PATTERN = /<\/?[a-zA-Z]/;
const EVENT_HANDLER_PATTERN = /\son[a-z]+\s*=/i;
const JS_URI_PATTERN = /javascript\s*:/i;

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
    if (
      HTML_TAG_PATTERN.test(leaf) ||
      EVENT_HANDLER_PATTERN.test(leaf) ||
      JS_URI_PATTERN.test(leaf)
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
