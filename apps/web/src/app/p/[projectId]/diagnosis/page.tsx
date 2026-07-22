import { redirect } from "next/navigation";
import {
  growthMapCompatibilityRoute,
  type ProjectRouteSearchParams,
} from "../_compatibility-route.ts";

interface DiagnosisPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<ProjectRouteSearchParams>;
}

/** Compatibility route: Diagnosis is now the selected-object Growth Map view. */
export default async function DiagnosisPage({
  params,
  searchParams,
}: DiagnosisPageProps) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  redirect(growthMapCompatibilityRoute(projectId, query));
}
