import { z } from "zod";

// Pagination / response metadata carried alongside the data payload.
export const metaSchema = z.object({
  nextCursor: z.string().nullish(),
  limit: z.number().int().optional(),
});
export type Meta = z.infer<typeof metaSchema>;

// Canonical success envelope: { data, meta? }. Wrap any data schema.
export function successEnvelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    data,
    meta: metaSchema.optional(),
  });
}
