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

/**
 * One immutable artifact revision is intentionally small enough to render,
 * export, hash, and restore without turning an operator edit into a memory/CPU
 * amplification path. Text uses this as a direct character ceiling; JSON uses
 * it for the compact serialized representation.
 */
export const MAX_ARTIFACT_CONTENT_CHARS = 40_000;

/** Runtime guard shared by HTTP schemas and service-level defence in depth. */
export function isArtifactContentWithinBudget(value: unknown): boolean {
  if (typeof value === "string") {
    return value.length <= MAX_ARTIFACT_CONTENT_CHARS;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  try {
    return JSON.stringify(value).length <= MAX_ARTIFACT_CONTENT_CHARS;
  } catch {
    return false;
  }
}

const UNSUPPORTED_TEMPLATE_LOCALE_MESSAGE =
  "Template generation supports only en or zh-CN. Use structured_llm for other locales.";

function canonicalTemplateLocale(locale: string): "en" | "zh-CN" | null {
  const normalized = locale.toLowerCase();
  if (normalized === "en") return "en";
  if (normalized === "zh-cn") return "zh-CN";
  return null;
}

/**
 * The validated wire shape, before cross-field policy or canonicalization.
 *
 * The artifact route deliberately parses this shape first so the service can
 * look up an immutable completed idempotency record using the exact historical
 * request values. Only a command that is not replayed is subjected to the
 * tightened template-locale policy below.
 */
export const CreateArtifactWireRequest = z
  .object({
    artifactType: ArtifactType,
    generationMode: GenerationMode,
    outputLocale: Bcp47Locale,
    operatorInstructions: z.string().max(4000).nullable().optional(),
  })
  .strict();
export type CreateArtifactWireRequest = z.infer<
  typeof CreateArtifactWireRequest
>;

export const CreateArtifactRequest = CreateArtifactWireRequest
  .superRefine((value, ctx) => {
    if (
      value.generationMode === "template" &&
      !canonicalTemplateLocale(value.outputLocale)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["outputLocale"],
        message: UNSUPPORTED_TEMPLATE_LOCALE_MESSAGE,
      });
    }
  })
  .transform((value) =>
    value.generationMode === "template"
      ? {
          ...value,
          outputLocale: canonicalTemplateLocale(value.outputLocale)!,
        }
      : value,
  );
export type CreateArtifactRequest = z.infer<typeof CreateArtifactRequest>;

/**
 * Artifact content / status update (spec §10.3). Either a new content revision
 * (contentFormat + content) or a status change (draft/ready/archived). `content`
 * is a string (markdown/csv) or an object (metadata json).
 */
const ArtifactRevisionContent = z.union([
  z.string().max(MAX_ARTIFACT_CONTENT_CHARS),
  z
    .record(z.string(), z.unknown())
    .refine(isArtifactContentWithinBudget, {
      message: `Serialized artifact content must not exceed ${MAX_ARTIFACT_CONTENT_CHARS} characters.`,
    }),
]);

const ArtifactRevisionUpdate = z
  .object({
    baseRevision: z.number().int().min(0),
    contentFormat: ContentFormat,
    content: ArtifactRevisionContent,
    editorNote: z.string().max(4000).nullable().optional(),
  })
  .strict();

const ArtifactStatusUpdate = z
  .object({
    baseRevision: z.number().int().min(0),
    status: z.enum(["draft", "ready", "archived"]),
  })
  .strict();

export const UpdateArtifactRequest = z.union([
  ArtifactRevisionUpdate,
  ArtifactStatusUpdate,
]);
export type UpdateArtifactRequest = z.infer<typeof UpdateArtifactRequest>;

export const CreateExportRequest = z
  .object({
    kind: z.enum(["service_bundle", "client_bundle"]),
    outputLocale: Bcp47Locale,
  })
  .strict();
export type CreateExportRequest = z.infer<typeof CreateExportRequest>;
