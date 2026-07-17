import { z } from "zod";

// Product and contract version identifiers. Wrapped in the data envelope at the
// usage site (e.g. successEnvelope(versionResponse)).
export const versionResponse = z.object({
  productVersion: z.literal("0.2.0"),
  contractVersion: z.literal("2026-07-18"),
});
export type VersionResponse = z.infer<typeof versionResponse>;
