import { redirect } from "next/navigation";
import { getOperatorContext } from "@/lib/auth/session";
import { listProjects } from "@/lib/services/projects";

/**
 * Root entry (spec §4.1): anonymous → /login (also enforced by middleware);
 * authenticated → most recent project's overview, or /new-project when the
 * workspace has no projects yet.
 */
export default async function HomePage() {
  const operator = await getOperatorContext();
  if (!operator) redirect("/login");

  const { data } = await listProjects(
    { workspaceId: operator.workspaceId },
    { limit: 1, cursor: null, archived: false },
  );
  if (data.length > 0 && data[0]) {
    redirect(`/p/${data[0].id}/overview`);
  }
  redirect("/new-project");
}

export const dynamic = "force-dynamic";
