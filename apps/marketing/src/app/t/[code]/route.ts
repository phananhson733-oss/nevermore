// @input  -- GET /t/<code> from anyone who followed a promoter's link
// @output -- one recorded click and a 302 to the drama's promo target (with the code when the platform takes one); 404 for an unclaimed code
// @pos    -- the public end of every promo link the task center hands out
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { followPromoCode, promoRedirectUrl } from "../../../lib/task-center/claims-store.ts";
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
    const target = await followPromoCode(db, code);
    if (target === null) return new Response("Not found", { status: 404, headers: HEADERS });
    return new Response(null, {
      status: 302,
      headers: { ...HEADERS, location: promoRedirectUrl(target, code) },
    });
  } catch (error) {
    console.error("[tasks] promo redirect failed", error);
    return new Response("Unavailable", { status: 503, headers: HEADERS });
  }
}
