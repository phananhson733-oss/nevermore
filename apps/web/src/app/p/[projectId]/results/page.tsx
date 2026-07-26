import { createElement } from "react";
import { ResultsClient } from "./_results.tsx";

interface ResultsPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<{
    readonly outputLocale?: string | string[];
  }>;
}

function firstQueryValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? (value[0] ?? undefined) : value;
}

/**
 * Canonical Results destination (R3 blueprint D1/D4). Server component:
 * unwrap the async `params`/`searchParams` (Next 16) and hand the project id
 * plus the requested `outputLocale` deep link to the client view. The screen
 * renders the read-only recheck comparison and the client report + export
 * rail; a malformed locale is normalized (and the URL self-healed) by the
 * client, mirroring the retired /report page's semantics.
 */
export default async function ResultsPage({
  params,
  searchParams,
}: ResultsPageProps) {
  const [{ projectId }, { outputLocale }] = await Promise.all([
    params,
    searchParams,
  ]);
  return createElement(ResultsClient, {
    projectId,
    initialOutputLocale: firstQueryValue(outputLocale),
  });
}
