// @input  -- GET /go/[code] requests and Supabase link_redirects mappings
// @output -- 302 redirect to a stored owned destination, 404 when no link exists
// @pos    -- Public clean short-link entrypoint for GenGrowth attribution
// once this file is updated, update header comments and _DIR.md in this folder
import { NextResponse } from "next/server";
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
    return missing();
  }

  let admin: ReturnType<typeof createAdminSupabaseClient>;
  try {
    admin = createAdminSupabaseClient();
  } catch {
    return missing();
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
    return missing();
  }

  return NextResponse.redirect(destination, record?.redirect_status ?? 302);
}

/**
 * A 404 with a page on it, built by hand rather than through `notFound()`.
 *
 * `notFound()` looks like the idiomatic call, but a Route Handler has no
 * render boundary above it: Next answers the thrown signal with a bare
 * `Response(null, { status })`, so the visitor gets a blank window with the
 * mistyped URL still in the address bar. The proxy sends every unreserved
 * single-segment path of 6+ characters here, which makes that blank page the
 * answer to every typo in the site's entire root namespace.
 *
 * Inlined rather than sharing `[locale]/not-found.tsx`, which is a client
 * component a Route Handler cannot render. Kept deliberately small; it is a
 * dead end, not a page to maintain.
 */
const NOT_FOUND_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Page Not Found</title>
<style>
html{color-scheme:dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#0A0F14;color:#E6EDF3;text-align:center;padding:0 24px;
font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
p.code{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
font-size:64px;line-height:1;letter-spacing:.04em;color:#3DDC97}
h1{margin:24px 0 0;font-size:26px;font-weight:600}
p.msg{margin:12px auto 0;max-width:28rem;font-size:15.5px;line-height:1.65;color:#9FB0C0}
a{display:inline-flex;align-items:center;height:48px;margin-top:32px;padding:0 26px;
border-radius:10px;background:linear-gradient(90deg,#3DDC97,#4CC3FA);color:#06231A;
font-size:14.5px;font-weight:600;text-decoration:none}
</style></head><body><div>
<p class="code">404</p>
<h1>Page Not Found</h1>
<p class="msg">The page you are looking for does not exist or has been moved.</p>
<a href="/">Back to Home</a>
</div></body></html>
`;

function missing(): NextResponse {
  return new NextResponse(NOT_FOUND_HTML, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function unavailable(): NextResponse {
  return new NextResponse(null, {
    status: 503,
    headers: { "cache-control": "no-store", "retry-after": "60" },
  });
}
