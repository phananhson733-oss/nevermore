import { createElement } from "react";
import { ReportClient } from "../report/_report.tsx";

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

/** Canonical Results destination backed by the existing Report client. */
export default async function ResultsPage({
  params,
  searchParams,
}: ResultsPageProps) {
  const { projectId } = await params;
  const { outputLocale } = await searchParams;
  return createElement(ReportClient, {
    projectId,
    initialOutputLocale: firstQueryValue(outputLocale),
  });
}
