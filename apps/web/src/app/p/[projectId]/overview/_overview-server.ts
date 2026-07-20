import { ProblemError } from "@sf/observability";
import { notFound } from "next/navigation";
import type { OverviewView } from "@/lib/api";
import { getOperatorContext } from "@/lib/auth/session";
import { getWorkspaceView } from "@/lib/services/workspace-view";
import { shouldUseE2eProjectShell } from "../_e2e-shell";

/**
 * Load the canonical Overview projection for a Server Component first paint.
 * `undefined` is reserved for the explicitly gated database-free E2E harness,
 * whose API response is fulfilled in the browser by Playwright.
 */
export async function loadInitialOverviewView(
  projectId: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<OverviewView | undefined> {
  if (shouldUseE2eProjectShell(env, projectId)) return undefined;

  // getOperatorContext uses React's request-scoped cache. The project layout
  // and page therefore share one lookup without a process-global identity leak.
  const operator = await getOperatorContext();
  if (!operator) notFound();

  try {
    const workspaceView = await getWorkspaceView(
      { workspaceId: operator.workspaceId },
      projectId,
      "overview",
      null,
    );
    if (workspaceView.view !== "overview") {
      throw new ProblemError(
        "DEPENDENCY_UNAVAILABLE",
        "Overview projection returned an unexpected workspace view.",
      );
    }

    // Service DTOs mirror the OpenAPI response but retain broader internal
    // string types. The discriminant above safely narrows the union before the
    // canonical response is handed to the stricter browser-facing DTO.
    return workspaceView as OverviewView;
  } catch (error) {
    if (error instanceof ProblemError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
