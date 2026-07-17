import { createDbHandle, type DbHandle } from "@sf/db";
import { getEnv } from "@/env";

/**
 * Process-wide pooled database handle for the web service. Never imported by
 * client components. Domain repositories receive `handle.db` / a transaction.
 */
let handle: DbHandle | undefined;

export function getDb(): DbHandle {
  if (!handle) {
    handle = createDbHandle(getEnv().DATABASE_URL);
  }
  return handle;
}
