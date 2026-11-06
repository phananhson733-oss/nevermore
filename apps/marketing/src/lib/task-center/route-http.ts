// @input  -- task center API requests, getTaskDb(), readR2Config(), checkTaskAdmin()
// @output -- the database, R2 config and admin identity a route needs, or the private error response to return
// @pos    -- shared HTTP policy for /api/tasks/* and /api/admin/tasks/*
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  privateError,
  privateJson,
  readAccountMutationJson,
} from "../account-websites/route-http.ts";
import { checkTaskAdmin } from "./admin.ts";
import { getTaskDb, type TaskDb } from "./db.ts";
import { readR2Config, type R2Config } from "./r2.ts";

export {
  authenticateAccountRequest,
  privateError,
  privateJson,
  readAccountMutationJson,
} from "../account-websites/route-http.ts";

export type Required<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly response: Response };

export function requireTaskDb(): Required<TaskDb> {
  const db = getTaskDb();
  return db === null
    ? { ok: false, response: privateError("tasks_unavailable", 503) }
    : { ok: true, value: db };
}

export function requireR2(): Required<R2Config> {
  const config = readR2Config();
  return config === null
    ? { ok: false, response: privateError("storage_unavailable", 503) }
    : { ok: true, value: config };
}

/**
 * 404 for anyone who is not an admin, signed in or not, so the admin API
 * looks the same as a path that does not exist.
 */
export async function requireTaskAdmin(): Promise<Required<{ readonly email: string }>> {
  const admin = await checkTaskAdmin();
  if (admin.status === "unavailable") {
    return { ok: false, response: privateError("auth_unavailable", 503) };
  }
  if (admin.status === "denied") {
    return { ok: false, response: privateError("not_found", 404) };
  }
  return { ok: true, value: { email: admin.email } };
}

/**
 * The opening of every admin write: admin first, so nobody else can tell a
 * malformed body from a missing endpoint; then the same-origin JSON body; then
 * the database.
 */
export async function readAdminMutation(
  request: Request,
  maxBytes: number,
): Promise<Required<{ readonly email: string; readonly body: unknown; readonly db: TaskDb }>> {
  const admin = await requireTaskAdmin();
  if (!admin.ok) return admin;
  const body = await readAccountMutationJson(request, maxBytes);
  if (!body.ok) return body;
  const db = requireTaskDb();
  if (!db.ok) return db;
  return { ok: true, value: { email: admin.value.email, body: body.value, db: db.value } };
}

/** Field errors from a zod parse, as `path: message` codes the admin form shows. */
export function invalidInput(issues: readonly { path: PropertyKey[]; message: string }[]): Response {
  return privateJson(
    {
      error: {
        code: "invalid_input",
        fields: issues.map((issue) => `${issue.path.map(String).join(".") || "body"}: ${issue.message}`),
      },
    },
    400,
  );
}
