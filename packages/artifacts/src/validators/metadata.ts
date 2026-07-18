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
 * Validate a metadata_rewrite content object. Returns an array of error strings;
 * an empty array means the object satisfies the schema.
 */
export function validateMetadata(content: unknown): string[] {
  if (typeof content !== "object" || content === null || Array.isArray(content)) {
    return ["metadata content must be a JSON object"];
  }

  const result = metadataRewriteSchema.safeParse(content);
  if (result.success) {
    return [];
  }

  return result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}
