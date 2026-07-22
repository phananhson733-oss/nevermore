import { redirect } from "next/navigation";
import {
  canonicalProjectRoute,
  type ProjectRouteSearchParams,
} from "../_compatibility-route.ts";

interface StudioPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<ProjectRouteSearchParams>;
}

/** Compatibility route for pre-migration Studio deep links. */
export default async function StudioPage({
  params,
  searchParams,
}: StudioPageProps) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  redirect(canonicalProjectRoute(projectId, "execution", query));
}
