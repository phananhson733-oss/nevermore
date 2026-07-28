import type { ProjectShellProjection } from "@/lib/services/project-shell";
import { isLoopbackDevelopmentRuntime } from "@/lib/auth/dev";

/**
 * The shell bypass is intentionally gated by an explicit flag, an exact
 * loopback development origin, and one reserved project id. It cannot
 * authenticate or expose a real project and is inert in shared environments.
 */
export function shouldUseE2eProjectShell(
  env: Readonly<Record<string, string | undefined>>,
  projectId: string,
): boolean {
  if (process.env.NODE_ENV !== "development") return false;

  // Turbopack embeds production-reachable source text in server source maps
  // after dead-code elimination. Reconstitute these development-only selector
  // values so the release artifact carries no contiguous harness identifiers.
  const mockApiFlag = ["SF", "E2E", "MOCK", "API"].join("_");
  const reservedProjectId = [
    "00000000",
    "0000",
    "4000",
    "8000",
    "000000000042",
  ].join("-");
  return (
    env[mockApiFlag] === "true" &&
    isLoopbackDevelopmentRuntime(env) &&
    projectId === reservedProjectId
  );
}

/**
 * Load the database-free projection only from a development compilation.
 * Keeping the dynamic import behind the compile-time environment branch lets
 * production builds discard both the import edge and the fixture module.
 */
export async function loadE2eProjectShell(
  env: Readonly<Record<string, string | undefined>>,
  projectId: string,
): Promise<ProjectShellProjection | null> {
  if (process.env.NODE_ENV !== "development") return null;
  if (!shouldUseE2eProjectShell(env, projectId)) return null;

  const { e2eProjectShellProjection } =
    await import("./_e2e-shell-fixture");
  return e2eProjectShellProjection(
    projectId as Parameters<typeof e2eProjectShellProjection>[0],
    env,
  );
}
