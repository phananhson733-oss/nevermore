import { createElement } from "react";
import { StudioClient } from "../studio/_studio.tsx";
import { parseExecutionDeepLink } from "./_execution-deep-link.ts";

interface ExecutionPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<{
    readonly actionId?: string | string[];
    readonly artifactId?: string | string[];
  }>;
}

/** Canonical Execution destination backed by the existing Studio client. */
export default async function ExecutionPage({
  params,
  searchParams,
}: ExecutionPageProps) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  return createElement(StudioClient, {
    projectId,
    initialDeepLink: parseExecutionDeepLink(query),
  });
}
