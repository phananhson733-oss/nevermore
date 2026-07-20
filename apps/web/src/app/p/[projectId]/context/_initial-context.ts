import { ProblemError } from "@sf/observability";
import { notFound } from "next/navigation";
import type { IcpProfile } from "@/lib/api/types";
import { getOperatorContext } from "@/lib/auth/session";
import { getContext } from "@/lib/services/context";
import { shouldUseE2eProjectShell } from "../_e2e-shell";

/**
 * Resolve the canonical first-paint value. `undefined` is reserved for the
 * database-free E2E harness, whose browser route interception must remain the
 * source of its test fixture; production always returns a profile or `null`.
 */
export async function loadInitialContext(
  projectId: string,
): Promise<IcpProfile | null | undefined> {
  if (shouldUseE2eProjectShell(process.env, projectId)) return undefined;

  const operator = await getOperatorContext();
  if (!operator) notFound();

  try {
    return await getContext(
      { workspaceId: operator.workspaceId },
      projectId,
    );
  } catch (error) {
    if (error instanceof ProblemError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
