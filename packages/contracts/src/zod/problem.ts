import { z } from "zod";

// Field-level validation error entry within an RFC9457 problem body.
// Field names match the OpenAPI `Problem.errors` item exactly (pointer/code/message).
export const problemErrorItem = z.object({
  pointer: z.string(),
  code: z.string(),
  message: z.string(),
});
export type ProblemErrorItem = z.infer<typeof problemErrorItem>;

// RFC9457 problem details body (application/problem+json).
export const problemBody = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  code: z.string(),
  detail: z.string(),
  requestId: z.string(),
  errors: z.array(problemErrorItem).optional(),
  current: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type ProblemBody = z.infer<typeof problemBody>;
