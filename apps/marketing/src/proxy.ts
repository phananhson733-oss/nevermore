import { NextResponse, type NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);
const localeGoPath = /^\/(?:en|zh)\/go(?:\/|$)/;
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
 * Public boundary for the marketing app. Marketing pages use locale routing;
 * API and short-link routes remain unprefixed and intentionally unauthenticated.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/") || pathname === "/go" || pathname.startsWith("/go/") || localeGoPath.test(pathname)) {
    return NextResponse.next();
  }

  const code = rootShortCode(pathname);
  if (code) {
    const rewritten = request.nextUrl.clone();
    rewritten.pathname = `/go/${code}`;
    return NextResponse.rewrite(rewritten);
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};
