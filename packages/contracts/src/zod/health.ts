import { z } from "zod";

export const PRODUCT_VERSION = "0.2.0" as const;
export const CONTRACT_VERSION = "2026-07-18" as const;

// Product and contract version identifiers. Wrapped in the data envelope at the
// usage site (e.g. successEnvelope(versionResponse)).
export const versionResponse = z.object({
  productVersion: z.literal(PRODUCT_VERSION),
  contractVersion: z.literal(CONTRACT_VERSION),
  service: z.enum(["web", "worker"]),
  buildSha: z.string().trim().min(1),
});
export type VersionResponse = z.infer<typeof versionResponse>;

type BuildEnvironment = Readonly<Record<string, string | undefined>>;

/** Resolve a stable deploy identifier without making local development lie. */
export function resolveBuildMetadata(
  service: VersionResponse["service"],
  env: BuildEnvironment = process.env,
): VersionResponse {
  const buildSha = [
    env["APP_BUILD_SHA"],
    env["VERCEL_GIT_COMMIT_SHA"],
    env["RAILWAY_GIT_COMMIT_SHA"],
    env["GITHUB_SHA"],
  ]
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value));

  return {
    productVersion: PRODUCT_VERSION,
    contractVersion: CONTRACT_VERSION,
    service,
    buildSha: buildSha ?? "development",
  };
}
