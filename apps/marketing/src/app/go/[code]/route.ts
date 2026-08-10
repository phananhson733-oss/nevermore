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
 * Whether this deployment serves short links at all.
 *
 * Declared, never inferred. The earlier version read "no credentials" and
 * "no such table" as proof that no short link could exist, which conflates two
 * different facts: whether the data exists, and whether this particular
 * instance can currently reach it. A rotated key, a half-populated environment, or a
 * migration mid-flight would then have answered a stable 404 for links that
 * are real and published — the one answer a crawler acts on irreversibly.
 *
 * Off by default, which is the truth today: `link_redirects` is one of the
 * marketing tables that exist only in the suspended Agents project and have
 * never been created in production (docs/INFRASTRUCTURE.md), and the only
 * writer has no callers. Off also means unknown paths never touch the database
 * at all, which matters because the proxy routes the site's whole root
 * namespace through here.
 */
function shortLinksEnabled(): boolean {
  return process.env.MARKETING_SHORT_LINKS_ENABLED === "true";
}

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
 * Once short links ARE enabled, 404 narrows to one meaning: the code is not
 * registered. Everything else that can go wrong — an unreachable database, a
 * missing table, a row pointing somewhere we will not send anyone, a status we
 * cannot act on — answers 503, because a code somebody published must never be
 * reported gone over a fault on our side.
 */
export async function GET(_request: Request, context: RouteContext) {
  const params = await Promise.resolve(context.params);
  const code = normalizeShortLinkCode(params.code);

  if (!code) {
    return missing();
  }

  // No short-link feature here: nothing to look up, so nothing exists.
  if (!shortLinksEnabled()) {
    return missing();
  }

  let record: Awaited<ReturnType<typeof findShortLink>>;
  try {
    record = await findShortLink(code);
  } catch {
    // Enabled but unreachable. The link may be real; say "try again", not "gone".
    return unavailable();
  }

  if (!record) {
    return missing();
  }

  const destination = normalizeOwnedDestination(record.destination_url);
  if (!destination) {
    // The row exists but points somewhere we will not send anyone: a bad
    // import, an edited record, or a host that stopped being ours. That is a
    // broken row, which is the same class of problem as an unusable status
    // below — not evidence that the link was never registered. Answering 404
    // would retire a code somebody deliberately published.
    return unavailable();
  }

  const status = REDIRECT_STATUSES.has(record.redirect_status)
    ? record.redirect_status
    : null;
  if (status === null) {
    // NextResponse.redirect throws on anything outside the redirect range, and
    // an uncaught throw here is a 500 on a published link. A row we cannot act
    // on is an operational problem, so report one.
    return unavailable();
  }

  return NextResponse.redirect(destination, status);
}

/** The only statuses NextResponse.redirect accepts. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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
