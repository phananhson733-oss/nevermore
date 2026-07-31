// @input  -- POST from the signed-in visitor
// @output -- cleared identity and grant cookies
// @pos    -- lets a visitor drop the session and grant this site holds
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { cookies } from "next/headers";

export const runtime = "nodejs";

/**
 * POST, not GET: clearing someone's session from a cross-site image tag would
 * be a nuisance rather than an attack, but it is still not something a link
 * should be able to do.
 */
export async function POST(): Promise<Response> {
  const jar = await cookies();
  jar.delete("gg_id");
  jar.delete("gg_gsc");
  jar.delete("gg_oauth_tx");
  return Response.json({ data: { signedOut: true } }, {
    headers: { "Cache-Control": "no-store" },
  });
}
