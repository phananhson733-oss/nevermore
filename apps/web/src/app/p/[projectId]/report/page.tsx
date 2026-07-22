import { redirect } from "next/navigation";
import {
  canonicalProjectRoute,
  type ProjectRouteSearchParams,
} from "../_compatibility-route.ts";

interface ReportPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<ProjectRouteSearchParams>;
}

/** Compatibility route for pre-migration Report deep links. */
export default async function ReportPage({
  params,
  searchParams,
}: ReportPageProps) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  redirect(canonicalProjectRoute(projectId, "results", query));
}
