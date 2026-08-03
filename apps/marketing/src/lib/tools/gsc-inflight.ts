// @input  -- a client IP
// @output -- the single in-flight key every Search Console tool contends on
// @pos    -- one key for one shared upstream budget
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  acquirePublicToolSlot,
  type PublicToolSlot,
} from "./public-tool-request.ts";

/**
 * One Search Console read at a time per client, ACROSS the connected tools.
 *
 * Search Console quota is counted per GCP PROJECT, not per visitor. A key
 * scoped to one tool lets a single caller hold two connections at once by
 * running the other tool alongside it, and spend twice the quota every other
 * visitor needs. Both connected tools import this rather than writing their
 * own literal, so the two cannot drift apart again.
 *
 * The underlying slot is a per-isolate best-effort gate (see
 * `public-tool-request.ts`), not a strict global lock. It bounds one visitor's
 * simultaneity within an isolate; it is not a volume cap, and no copy should
 * describe it as one.
 */
export function gscInflightKey(clientIp: string): string {
  return `tools:gsc:inflight:${clientIp}`;
}

export function acquireGscSlot(clientIp: string): PublicToolSlot {
  return acquirePublicToolSlot(gscInflightKey(clientIp));
}
