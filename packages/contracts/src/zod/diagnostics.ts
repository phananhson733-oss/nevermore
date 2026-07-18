import { z } from "zod";
import { Bcp47Locale } from "./common.ts";

/**
 * Diagnostic + review request schemas (spec §8, §9). `createDiagnosticRun`
 * freezes the selected snapshots into an immutable input manifest; the run must
 * include a current-project crawl snapshot (server-enforced) and 1–10 snapshots.
 */

export const CreateDiagnosticRunRequest = z
  .object({
    snapshotIds: z.array(z.uuid()).min(1).max(10),
    outputLocale: Bcp47Locale,
  })
  .strict()
  .refine((v) => new Set(v.snapshotIds).size === v.snapshotIds.length, {
    message: "snapshotIds must be unique",
    path: ["snapshotIds"],
  });
export type CreateDiagnosticRunRequest = z.infer<
  typeof CreateDiagnosticRunRequest
>;

/** `reviewProjectFinding` mutation (spec §9.1). `baseRevision` guards concurrency. */
export const ReviewFindingRequest = z.discriminatedUnion("reviewState", [
  z
    .object({
      reviewState: z.literal("confirmed"),
      baseRevision: z.number().int().min(0),
      note: z.string().max(2000).optional(),
    })
    .strict(),
  z
    .object({
      reviewState: z.literal("ignored"),
      baseRevision: z.number().int().min(0),
      reason: z.string().min(3).max(2000),
    })
    .strict(),
  z
    .object({
      reviewState: z.literal("needs_more_data"),
      baseRevision: z.number().int().min(0),
      note: z.string().min(3).max(2000),
    })
    .strict(),
]);
export type ReviewFindingRequest = z.infer<typeof ReviewFindingRequest>;

export const PriorityBand = z.enum(["critical", "high", "medium", "low"]);
export type PriorityBand = z.infer<typeof PriorityBand>;

export const RoadmapLane = z.enum(["now", "next", "later"]);
export type RoadmapLane = z.infer<typeof RoadmapLane>;

export const ActionStatus = z.enum([
  "candidate",
  "planned",
  "in_progress",
  "done",
  "blocked",
  "dismissed",
]);
export type ActionStatus = z.infer<typeof ActionStatus>;

/**
 * `updateProjectAction` override (spec §9.3). At least one of status /
 * priorityBand / roadmapLane must be present; a reason (min 3) is always
 * required and `baseRevision` guards concurrency.
 */
export const UpdateActionRequest = z
  .object({
    baseRevision: z.number().int().min(1),
    status: ActionStatus.optional(),
    priorityBand: PriorityBand.optional(),
    roadmapLane: RoadmapLane.optional(),
    reason: z.string().min(3).max(1000),
    note: z.string().max(4000).nullable().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.status !== undefined ||
      v.priorityBand !== undefined ||
      v.roadmapLane !== undefined,
    {
      message: "At least one of status, priorityBand, roadmapLane is required.",
    },
  );
export type UpdateActionRequest = z.infer<typeof UpdateActionRequest>;
