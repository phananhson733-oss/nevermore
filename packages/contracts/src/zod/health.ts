import { z } from "zod";

export const PRODUCT_VERSION = "0.3.0" as const;
export const CONTRACT_VERSION = "2026-07-21" as const;

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
  // Platform-provided commit metadata is immutable for a deployment, whereas
  // APP_BUILD_SHA is a portable fallback and can become stale when configured
  // as a long-lived environment variable. Prefer the hosting platform that
  // owns each service so /version always identifies the code actually running.
  const buildCandidates =
    service === "web"
      ? [
          env["VERCEL_GIT_COMMIT_SHA"],
          env["APP_BUILD_SHA"],
          env["GITHUB_SHA"],
          env["RAILWAY_GIT_COMMIT_SHA"],
          env["RENDER_GIT_COMMIT"],
        ]
      : [
          env["RAILWAY_GIT_COMMIT_SHA"],
          env["RENDER_GIT_COMMIT"],
          env["APP_BUILD_SHA"],
          env["GITHUB_SHA"],
          env["VERCEL_GIT_COMMIT_SHA"],
        ];

  const buildSha = buildCandidates
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value));

  return {
    productVersion: PRODUCT_VERSION,
    contractVersion: CONTRACT_VERSION,
    service,
    buildSha: buildSha ?? "development",
  };
}
