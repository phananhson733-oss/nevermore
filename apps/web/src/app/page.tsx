import { redirect } from "next/navigation";
import { getOperatorContext } from "@/lib/auth/session";

/**
 * Root entry (spec §4.1). Anonymous users are sent to /login (also enforced by
 * middleware). Authenticated routing to the most recent project / new-project
 * lands in WP1; for now authenticated users are directed to /login until the
 * project shell exists.
 */
export default async function HomePage() {
  const operator = await getOperatorContext();
  if (!operator) redirect("/login");
  // WP1: redirect to most recent project overview or /new-project.
  redirect("/login");
}
