import { createElement } from "react";
import { ExecutionClient } from "./_execution.tsx";
import { parseExecutionDeepLink } from "./_execution-deep-link.ts";

interface ExecutionPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<{
    readonly actionId?: string | string[];
    readonly artifactId?: string | string[];
  }>;
}

/**
 * Canonical Execution destination. The single-chain projection sits above the
 * reused Studio delivery client (spec §11.3, Task 7).
 */
export default async function ExecutionPage({
  params,
  searchParams,
}: ExecutionPageProps) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  return createElement(ExecutionClient, {
    projectId,
    initialDeepLink: parseExecutionDeepLink(query),
  });
}
