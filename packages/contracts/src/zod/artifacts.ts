import { z } from "zod";
import { Bcp47Locale } from "./common.ts";

/**
 * Artifact + export request schemas (spec §10). Artifact create is always async
 * (202) even for template mode. Content updates carry `baseRevision` for optimistic
 * concurrency; a stale base is 409 STALE_REVISION.
 */

export const ArtifactType = z.enum([
  "content_brief",
  "metadata_rewrite",
  "technical_ticket",
]);
export type ArtifactType = z.infer<typeof ArtifactType>;

export const GenerationMode = z.enum(["template", "structured_llm"]);
export type GenerationMode = z.infer<typeof GenerationMode>;

export const ContentFormat = z.enum(["markdown", "json", "csv"]);
export type ContentFormat = z.infer<typeof ContentFormat>;

export const CreateArtifactRequest = z
  .object({
    artifactType: ArtifactType,
    generationMode: GenerationMode,
    outputLocale: Bcp47Locale,
    operatorInstructions: z.string().max(4000).nullable().optional(),
  })
  .strict();
export type CreateArtifactRequest = z.infer<typeof CreateArtifactRequest>;

/**
 * Artifact content / status update (spec §10.3). Either a new content revision
 * (contentFormat + content) or a status change (draft/ready/archived). `content`
 * is a string (markdown/csv) or an object (metadata json).
 */
export const UpdateArtifactRequest = z
  .object({
    baseRevision: z.number().int().min(0),
    contentFormat: ContentFormat.optional(),
    content: z.union([z.string(), z.record(z.string(), z.unknown()), z.null()]).optional(),
    status: z.enum(["draft", "ready", "archived"]).optional(),
    editorNote: z.string().max(4000).nullable().optional(),
  })
  .strict()
  .refine(
    (v) => (v.contentFormat !== undefined && v.content !== undefined) || v.status !== undefined,
    { message: "Provide contentFormat+content or a status." },
  );
export type UpdateArtifactRequest = z.infer<typeof UpdateArtifactRequest>;

export const CreateExportRequest = z
  .object({
    kind: z.enum(["service_bundle", "client_bundle"]),
    outputLocale: Bcp47Locale,
  })
  .strict();
export type CreateExportRequest = z.infer<typeof CreateExportRequest>;
