import { z } from "zod";
import { ArtifactType } from "./artifacts.ts";

/**
 * Presentational, current-view copy derived from the static ActionTemplate
 * registry. This preview is deliberately not an Action, workflow state,
 * publication command, Artifact, or measurement record.
 */
export const ExecutionPreview = z
  .object({
    templateId: z.string().trim().min(1).max(200),
    templateVersion: z.union([z.literal(1), z.literal(2)]),
    artifactType: ArtifactType,
    effort: z.enum(["small", "medium", "large"]),
    risk: z.enum(["low", "medium", "high"]),
    contentLocale: z.enum(["en", "zh-CN"]),
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().min(1).max(4000),
    expectedOutcome: z.string().trim().min(1).max(4000),
  })
  .strict();
export type ExecutionPreview = z.infer<typeof ExecutionPreview>;
