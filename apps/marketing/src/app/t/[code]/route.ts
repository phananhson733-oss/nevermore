// @input  -- GET /t/<code> from anyone who followed a promoter's link
// @output -- one recorded click and a 302 to the drama's page on our site, /watch/<drama id>?ref=<code>; 404 for an unclaimed code, 503 when the task database is unavailable
// @pos    -- the public end of every promo link the task center hands out
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { followPromoCode } from "../../../lib/task-center/claims-store.ts";
import { normalizePromoCode } from "../../../lib/task-center/contracts.ts";
import { getTaskDb } from "../../../lib/task-center/db.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A cached redirect would stop counting clicks, and none of this is for crawlers.
const HEADERS = { "cache-control": "no-store", "x-robots-tag": "noindex" } as const;

export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ code: string }> },
): Promise<Response> {
  const { code: raw } = await context.params;
  const code = normalizePromoCode(raw);
  if (code === null) return new Response("Not found", { status: 404, headers: HEADERS });
  const db = getTaskDb();
  // A link somebody published must never be reported gone over a fault on our side.
  if (db === null) return new Response("Unavailable", { status: 503, headers: HEADERS });
  try {
    const followed = await followPromoCode(db, code);
    if (followed === null) return new Response("Not found", { status: 404, headers: HEADERS });
    // Relative, so it stays on whichever host served the link. The page is in
    // the default language; the reader can switch from there.
    return new Response(null, {
      status: 302,
      headers: { ...HEADERS, location: `/watch/${followed.dramaId}?ref=${code}` },
    });
  } catch (error) {
    console.error("[tasks] promo redirect failed", error);
    return new Response("Unavailable", { status: 503, headers: HEADERS });
  }
}
