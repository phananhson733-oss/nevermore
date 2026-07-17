import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/refresh";
import { isDevAuthEnabled } from "@/lib/auth/dev";

/** Public page paths that never require authentication. */
const PUBLIC_PAGES = ["/login"];
/** Public API prefixes (health checks) that bypass auth. */
const PUBLIC_API_PREFIXES = ["/api/mvp/health"];

/**
 * Edge middleware: refresh the Supabase session on every request, gate page
 * routes (redirect anonymous users to /login), and let `/api/mvp` handlers
 * enforce their own 401 problem+json (spec §14.1). Project isolation itself is
 * enforced in repositories, not here.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  // Local dev only (double-gated): skip Supabase session refresh and gating so the
  // app is reachable without a running GoTrue instance (spec §14.1). Never in prod.
  if (isDevAuthEnabled()) {
    return NextResponse.next({ request });
  }

  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_API_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    )
  ) {
    return response;
  }
  // API auth is enforced by operatorRoute in the handlers; only refresh here.
  if (pathname.startsWith("/api/")) {
    return response;
  }

  const isPublicPage = PUBLIC_PAGES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!user && !isPublicPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: [
    // Run on everything except Next internals and static asset files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
