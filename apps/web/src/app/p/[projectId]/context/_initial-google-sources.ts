import type { OAuthProvider } from "@sf/contracts";
import { getOperatorContext } from "@/lib/auth/session";
import { getOnboardingGoogleSourceState } from "@/lib/services/source-connect";
import { shouldUseE2eProjectShell } from "../_e2e-shell";

/**
 * Load the minimal, presentational source state used by Product Profile.
 * The reserved browser harness owns this state through intercepted API calls
 * and must remain database-free.
 */
export async function loadInitialConnectedGoogleProviders(
  projectId: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<readonly OAuthProvider[]> {
  if (shouldUseE2eProjectShell(env, projectId)) return [];

  const operator = await getOperatorContext();
  if (!operator) return [];

  const state = await getOnboardingGoogleSourceState(
    { workspaceId: operator.workspaceId },
    projectId,
  );
  return state?.connectedProviders ?? [];
}
