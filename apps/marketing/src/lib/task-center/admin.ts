// @input  -- TASK_ADMIN_EMAILS (comma separated) and the verified Supabase session
// @output -- whether the signed-in visitor may use /admin/tasks and the admin APIs
// @pos    -- the task center's only admin check; pages answer 404 and APIs 404 JSON to everyone else
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { getServerAuthenticatedUser } from "../auth/server-auth-user.ts";

export function taskAdminEmails(env: Readonly<Record<string, string | undefined>> = process.env): ReadonlySet<string> {
  return new Set(
    (env.TASK_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.includes("@")),
  );
}

/** A session without an email is never an admin, however the list is written. */
export function isTaskAdminEmail(
  email: string | null,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (email === null) return false;
  const normalized = email.trim().toLowerCase();
  return normalized !== "" && taskAdminEmails(env).has(normalized);
}

export type TaskAdminCheck =
  | { readonly status: "admin"; readonly userId: string; readonly email: string }
  | { readonly status: "denied" }
  | { readonly status: "unavailable" };

export async function checkTaskAdmin(): Promise<TaskAdminCheck> {
  const user = await getServerAuthenticatedUser().catch(() => ({ status: "unavailable" as const }));
  if (user.status === "unavailable") return { status: "unavailable" };
  if (user.status !== "authenticated" || !isTaskAdminEmail(user.email)) {
    return { status: "denied" };
  }
  return { status: "admin", userId: user.userId, email: user.email!.trim().toLowerCase() };
}
