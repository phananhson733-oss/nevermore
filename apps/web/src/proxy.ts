import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { isDevAuthEnabled } from "@/lib/auth/dev";
import { safePostLoginPath } from "@/lib/auth/redirect";
import { updateSession } from "@/lib/supabase/refresh";
import { buildContentSecurityPolicy } from "../security-headers.ts";

/**
 * Public page paths that never require authentication.
 *
 * `/auth/callback` has to be here: it is the leg of the OAuth flow that CREATES
 * the session, so it necessarily arrives without one. Gating it would bounce
 * every Google sign-in back to `/login` before the code could be exchanged.
 */
const PUBLIC_PAGES = ["/login", "/auth/callback"];
/** Public API prefixes (health checks) that bypass auth. */
const PUBLIC_API_PREFIXES = ["/api/mvp/health"];

function requestHeaderOverrides(nonce: string, csp: string): Headers {
  const headers = new Headers();
  headers.set("x-nonce", nonce);
  // Next parses the request CSP and automatically attaches its nonce to
  // framework/page scripts and inline style tags during dynamic rendering.
  headers.set("Content-Security-Policy", csp);
  return headers;
}

function nextWithOverrides(
  request: NextRequest,
  overrides: Headers,
): NextResponse {
  const headers = new Headers(request.headers);
  overrides.forEach((value, key) => headers.set(key, value));
  return NextResponse.next({ request: { headers } });
}

function secure(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

function loginRedirectTarget(request: NextRequest): string {
  return safePostLoginPath(
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
}

/**
 * Request boundary for session refresh, page auth gating, and nonce-based CSP.
 * Next.js 16 calls this convention `proxy`; API handlers still enforce their
 * own 401 problem responses and repositories enforce project isolation.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildContentSecurityPolicy(
    process.env["NODE_ENV"] === "development",
    nonce,
  );
  const overrides = requestHeaderOverrides(nonce, csp);
  const { pathname } = request.nextUrl;

  // Health routes are deliberately independent of Supabase Auth. Their own
  // handlers report the exact DB/queue/worker dependencies they are probing.
  if (
    PUBLIC_API_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return secure(nextWithOverrides(request, overrides), csp);
  }

  let response: NextResponse;
  let userPresent: boolean;
  if (isDevAuthEnabled()) {
    response = nextWithOverrides(request, overrides);
    userPresent = true;
  } else {
    const session = await updateSession(request, overrides);
    response = session.response;
    userPresent = session.user !== null;
  }

  if (pathname.startsWith("/api/")) {
    return secure(response, csp);
  }

  const isPublicPage = PUBLIC_PAGES.some(
    (page) => pathname === page || pathname.startsWith(`${page}/`),
  );
  if (!userPresent && !isPublicPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", loginRedirectTarget(request));
    const redirect = NextResponse.redirect(url);
    // Preserve refreshed/cleared Supabase cookies across the redirect.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return secure(redirect, csp);
  }

  return secure(response, csp);
}

export const config = {
  matcher: [
    // Run on pages and API responses, excluding immutable/static asset files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
