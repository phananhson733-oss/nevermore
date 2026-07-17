import { z } from "zod";

/**
 * Source collection request schemas (spec §7.5). CSV uses the dedicated import
 * endpoint; DataForSEO is disabled — so `createCollectionRun` only accepts
 * crawl/gsc/ga4. `operation` is optional and derived from `provider` when absent.
 */

export const CollectionProvider = z.enum(["crawl", "gsc", "ga4"]);
export type CollectionProvider = z.infer<typeof CollectionProvider>;

export const CollectionOperationInput = z.enum([
  "site_graph",
  "search_analytics",
  "organic_landing",
]);
export type CollectionOperationInput = z.infer<typeof CollectionOperationInput>;

export const CreateCollectionRunRequest = z
  .object({
    provider: CollectionProvider,
    sourceConnectionId: z.uuid().nullable().optional(),
    operation: CollectionOperationInput.optional(),
  })
  .strict();
export type CreateCollectionRunRequest = z.infer<typeof CreateCollectionRunRequest>;
