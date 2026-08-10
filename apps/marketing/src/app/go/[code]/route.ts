// @input  -- GET /go/[code] requests and Supabase link_redirects mappings
// @output -- 302 redirect to a stored owned destination, 404 when no link exists
// @pos    -- Public clean short-link entrypoint for GenGrowth attribution
// once this file is updated, update header comments and _DIR.md in this folder
import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
// Relative import, not the `@/` alias: the shared Vitest config maps `@/` to
// apps/web only, so an aliased import here would not resolve in route.test.ts.
import { createAdminSupabaseClient } from "../../../lib/supabase/admin";
import {
  findShortLink,
  normalizeOwnedDestination,
  normalizeShortLinkCode,
} from "../../../lib/link-attribution/short-links";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ code?: string }> | { code?: string };
};

/**
 * A code that resolves to nothing is a page that does not exist.
 *
 * The proxy rewrites every unreserved single-segment path of 6+ characters
 * here, so this handler answers for far more than deliberate short links:
 * every mistyped inbound link and every path a crawler guesses lands on it.
 * Redirecting those to the homepage made each one a soft 404 — Google keeps
 * the requested URL, recrawls it, and spends budget on a page that was never
 * ours. A 404 spends the same request once and ends it.
 *
 * The two ways a lookup can fail are deliberately NOT the same answer:
 *
 * - No credentials configured. This deployment has no short-link storage at
 *   all, so no short link can exist and every code is genuinely absent. It is
 *   also a standing state, not a blip — answering "try again later" forever
 *   would be a lie a crawler keeps acting on. 404.
 * - The query itself failed. Storage exists and is momentarily unreachable,
 *   so the link may well be real. Telling a crawler "gone" here would drop
 *   URLs we deliberately published. 503, with a retry hint.
 */
export async function GET(_request: Request, context: RouteContext) {
  const params = await Promise.resolve(context.params);
  const code = normalizeShortLinkCode(params.code);

  if (!code) {
    notFound();
  }

  let admin: ReturnType<typeof createAdminSupabaseClient>;
  try {
    admin = createAdminSupabaseClient();
  } catch {
    notFound();
  }

  let record: Awaited<ReturnType<typeof findShortLink>>;
  try {
    record = await findShortLink(code, admin);
  } catch {
    return unavailable();
  }

  const destination = normalizeOwnedDestination(record?.destination_url);
  if (!destination) {
    // Either no row, or a row whose destination is no longer one of ours. Both
    // mean there is nothing here to send anyone to.
    notFound();
  }

  return NextResponse.redirect(destination, record?.redirect_status ?? 302);
}

function unavailable(): NextResponse {
  return new NextResponse(null, {
    status: 503,
    headers: { "cache-control": "no-store", "retry-after": "60" },
  });
}
