import { NextResponse, type NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);
const localeGoPath = /^\/(?:en|zh)\/go(?:\/|$)/;
/** Matches the legacy default-locale prefix only as a whole segment: /en, /en/x — never /english. */
const legacyDefaultLocalePrefix = /^\/en(?=\/|$)/;
/** Header next-intl stamps on the request when it rewrites to the internal locale route. */
const resolvedLocaleHeader = "x-next-intl-locale";
const rootShortCodePath = /^\/([a-z0-9][a-z0-9-]{5,79})$/i;
const reservedRootPaths = new Set([
  "api",
  "about",
  "blog",
  "compare",
  "contact",
  "cookies",
  "copyright",
  "en",
  "features",
  "feed.xml",
  "glossary",
  "go",
  "playbooks",
  "pricing",
  "privacy",
  "robots.txt",
  "sitemap.xml",
  "templates",
  "terms",
  "tools",
  "use-cases",
  "zh",
]);

function rootShortCode(pathname: string): string | null {
  const match = pathname.match(rootShortCodePath);
  if (!match) return null;
  const code = match[1].toLowerCase();
  return reservedRootPaths.has(code) ? null : code;
}

/**
 * Public boundary for the marketing app. Marketing pages use locale routing
 * with the default locale unprefixed; API and short-link routes remain
 * unprefixed and intentionally unauthenticated.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/api/") ||
    pathname === "/go" ||
    pathname.startsWith("/go/") ||
    localeGoPath.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Next 16 re-runs the proxy against next-intl's internal rewrite target, so a
  // request for /pricing comes back around as /en/pricing. Running next-intl
  // again there would send that resolved path straight back out as a redirect
  // to /pricing — an endless loop. next-intl stamps the resolved locale on the
  // rewritten request, which is what distinguishes it from a real visit to a
  // legacy /en URL, so let it through untouched.
  if (request.headers.get(resolvedLocaleHeader)) {
    return NextResponse.next();
  }

  const code = rootShortCode(pathname);
  if (code) {
    const rewritten = request.nextUrl.clone();
    rewritten.pathname = `/go/${code}`;
    return NextResponse.rewrite(rewritten);
  }

  const response = intlMiddleware(request);

  // A genuine visit to a legacy /en URL gets canonicalized by next-intl, but
  // only with a temporary 307. Indexed URLs are moving permanently, so upgrade
  // it to a 308 and let search engines transfer the old URLs' equity.
  if (response.status === 307 && legacyDefaultLocalePrefix.test(pathname)) {
    return new NextResponse(null, { status: 308, headers: response.headers });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};
