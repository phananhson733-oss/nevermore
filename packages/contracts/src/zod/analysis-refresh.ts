import { z } from "zod";

/**
 * Analysis Refresh deliberately accepts no client planning input. Site, ICP,
 * connected optional sources, and the ordered five-step plan are all selected
 * and frozen by the server inside the command transaction.
 */
export const CreateAnalysisRefreshRunRequest = z.object({}).strict();
export type CreateAnalysisRefreshRunRequest = z.infer<
  typeof CreateAnalysisRefreshRunRequest
>;
