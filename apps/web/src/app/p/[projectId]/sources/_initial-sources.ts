import { notFound, redirect } from "next/navigation";
import { getOperatorContext } from "@/lib/auth/session";
import { getSourceConnectionGate } from "@/lib/services/source-connect";
import { shouldUseE2eProjectShell } from "../_e2e-shell";

/**
 * Fail-closed first-paint gate for customer-managed source connections.
 *
 * A Product Profile / ICP working draft is not analysis authority. The Sources
 * screen becomes reachable only after the immutable profile version has been
 * confirmed. The reserved loopback-only browser harness remains database-free.
 */
export async function ensureSourcesPageAccess(
  projectId: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  if (shouldUseE2eProjectShell(env, projectId)) return;

  const operator = await getOperatorContext();
  if (!operator) notFound();

  const gate = await getSourceConnectionGate(
    { workspaceId: operator.workspaceId },
    projectId,
  );
  if (gate === "not_found") notFound();
  if (gate === "product_profile_required") {
    redirect(`/p/${projectId}/context`);
  }
}
