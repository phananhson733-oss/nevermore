import { redirect } from "next/navigation";
import {
  canonicalProjectRoute,
  type ProjectRouteSearchParams,
} from "../_compatibility-route.ts";

interface PlanPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<ProjectRouteSearchParams>;
}

/** Compatibility route for pre-migration Plan deep links. */
export default async function PlanPage({ params, searchParams }: PlanPageProps) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  redirect(canonicalProjectRoute(projectId, "execution", query));
}
