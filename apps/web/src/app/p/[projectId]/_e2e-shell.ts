import type { ProjectDto } from "@/lib/services/mappers";
import { isLoopbackDevelopmentRuntime } from "@/lib/auth/dev";

/** Reserved id used only by the database-free Playwright harness. */
export const E2E_PROJECT_ID = "00000000-0000-4000-8000-000000000042";

/**
 * The shell bypass is intentionally gated by an explicit flag, an exact
 * loopback development origin, and one reserved project id. It cannot
 * authenticate or expose a real project and is inert in shared environments.
 */
export function shouldUseE2eProjectShell(
  env: Readonly<Record<string, string | undefined>>,
  projectId: string,
): boolean {
  return (
    env["SF_E2E_MOCK_API"] === "true" &&
    isLoopbackDevelopmentRuntime(env) &&
    projectId === E2E_PROJECT_ID
  );
}

/** Stable shell-only projection; all screen API data is fulfilled by Playwright. */
export function e2eProjectShell(projectId: typeof E2E_PROJECT_ID): ProjectDto {
  const timestamp = "2026-01-01T00:00:00.000Z";
  return {
    id: projectId,
    clientName: "E2E Client",
    projectName: "E2E Critical Flow",
    stage: "planning",
    site: {
      id: "00000000-0000-4000-8000-000000000043",
      origin: "https://example.test",
      host: "example.test",
      marketCodes: ["US"],
      languageCodes: ["en", "zh-CN"],
    },
    contextStatus: "complete",
    currentIcpProfileVersion: 1,
    defaultDeliveryLocale: "en",
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
  };
}
