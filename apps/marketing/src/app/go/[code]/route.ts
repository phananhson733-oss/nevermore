// @input  -- GET /go/[code] requests and Supabase link_redirects mappings
// @output -- 302 redirect to a stored owned destination, 404 when no link exists
// @pos    -- Public clean short-link entrypoint for GenGrowth attribution
// once this file is updated, update header comments and _DIR.md in this folder
import { NextResponse } from "next/server";
// Relative import, not the `@/` alias: the shared Vitest config maps `@/` to
// apps/web only, so an aliased import here would not resolve in route.test.ts.
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
 * A failed lookup is deliberately NOT a 404: the link may well exist and the
 * database is simply unreachable. Telling a crawler "gone" during an outage
 * would drop URLs that are real, so those answer 503 and invite a retry.
 */
export async function GET(_request: Request, context: RouteContext) {
  const params = await Promise.resolve(context.params);
  const code = normalizeShortLinkCode(params.code);

  if (!code) {
    return notFound();
  }

  let record: Awaited<ReturnType<typeof findShortLink>>;
  try {
    record = await findShortLink(code);
  } catch {
    return unavailable();
  }

  const destination = normalizeOwnedDestination(record?.destination_url);
  if (!destination) {
    // Either no row, or a row whose destination is no longer one of ours. Both
    // mean there is nothing here to send anyone to.
    return notFound();
  }

  return NextResponse.redirect(destination, record?.redirect_status ?? 302);
}

function notFound(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

function unavailable(): NextResponse {
  return new NextResponse(null, {
    status: 503,
    headers: { "cache-control": "no-store", "retry-after": "60" },
  });
}
