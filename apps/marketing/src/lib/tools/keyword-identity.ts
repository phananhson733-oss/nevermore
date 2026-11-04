// @input  -- the request's `gg_id` identity cookie
// @output -- the visitor's sealed identity subject, or null when the cookie is absent or unreadable
// @pos    -- shared cookie read for the content brief and knowledge-base enrichment handlers
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { identitySubFrom } from "../auth/grant-cookie.ts";

export async function readKeywordIdentity(): Promise<{
  readonly sub: string;
} | null> {
  const { cookies } = await import("next/headers");
  const sub = identitySubFrom((await cookies()).get("gg_id")?.value);
  return sub === null ? null : { sub };
}
