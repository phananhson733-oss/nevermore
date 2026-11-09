// @input  -- GET /t/<code>/go from anyone who followed a promoter's 资源推广链接
// @output -- one recorded click and a 302 straight to the drama on its platform, with the code as the platform's sub-channel parameter when the drama has one; a drama with no platform link yet goes to its page on our site, /watch/<drama id>?ref=<code>, like /t/<code>; 404 for an unclaimed code, 503 when the task database is unavailable
// @pos    -- the public end of the 资源推广链接, the second link a promoter gets for each drama beside /t/<code>
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { followPromoCode, getPlatformLink, promoRedirectUrl } from "../../../../lib/task-center/claims-store.ts";
import { normalizePromoCode } from "../../../../lib/task-center/contracts.ts";
import { getTaskDb } from "../../../../lib/task-center/db.ts";

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
    // Looked up at click time, so a link posted before the platform link was
    // filled in starts going straight to the platform once it is.
    const platform = await getPlatformLink(db, followed.dramaId, code);
    const location =
      platform === null
        ? `/watch/${followed.dramaId}?ref=${code}`
        : promoRedirectUrl(platform.target, platform.code);
    return new Response(null, { status: 302, headers: { ...HEADERS, location } });
  } catch (error) {
    console.error("[tasks] resource redirect failed", error);
    return new Response("Unavailable", { status: 503, headers: HEADERS });
  }
}
