// @input  -- GET /watch/<id>/go?ref=<promo code> from the 去看全集 button on a drama's page
// @output -- a 302 to the drama's platform link, with the code as the platform's sub-channel parameter only when it was claimed for this drama; back to the drama's page when it has no platform link; 404 for a malformed id, 503 when the task database is unavailable
// @pos    -- the only way a platform's own URL reaches a reader: a Location header, never page HTML
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { getPlatformLink, promoRedirectUrl } from "../../../../../lib/task-center/claims-store.ts";
import { isUuid, normalizePromoCode } from "../../../../../lib/task-center/contracts.ts";
import { getTaskDb } from "../../../../../lib/task-center/db.ts";
import { localePath } from "../../../../../lib/locale-path.ts";
import { routing } from "../../../../../i18n/routing.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The platform link can change from one minute to the next, and none of this is for crawlers.
const HEADERS = { "cache-control": "no-store", "x-robots-tag": "noindex" } as const;

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ locale: string; id: string }> },
): Promise<Response> {
  const params = await context.params;
  const { id } = params;
  // Only ever en or zh behind the proxy; checked anyway, since it goes into a Location.
  const locale = (routing.locales as readonly string[]).includes(params.locale) ? params.locale : routing.defaultLocale;
  if (!isUuid(id)) return new Response("Not found", { status: 404, headers: HEADERS });
  const code = normalizePromoCode(new URL(request.url).searchParams.get("ref") ?? undefined);
  const db = getTaskDb();
  if (db === null) return new Response("Unavailable", { status: 503, headers: HEADERS });
  try {
    const link = await getPlatformLink(db, id, code);
    // Taken away since the page was rendered: the page itself says what there is.
    const location = link === null ? localePath(locale, `/watch/${id}`) : promoRedirectUrl(link.target, link.code);
    return new Response(null, { status: 302, headers: { ...HEADERS, location } });
  } catch (error) {
    console.error("[tasks] platform redirect failed", error);
    return new Response("Unavailable", { status: 503, headers: HEADERS });
  }
}
