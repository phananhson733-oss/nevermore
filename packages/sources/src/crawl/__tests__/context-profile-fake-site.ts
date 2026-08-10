// @input  -- a path-keyed map of canned responses plus optional per-request hooks
// @output -- an offline ContextProfileFetch, a controllable clock, and request/sleep logs
// @pos    -- the single fake transport both context-profile test files drive
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Test-only. A fake at the `fetchPublicResource` seam rather than at `undici`,
 * so the tests exercise the module's own budget, pacing, robots and ranking
 * logic while the guarded transport stays the only thing production can use.
 */

import {
  crawlSiteContextProfile,
  ContextProfileError,
  type ContextProfileFetch,
  type ContextProfileResult,
} from "../context-profile.ts";
import type {
  PublicResourceFetchOptions,
  PublicResourceResult,
} from "../../public-http/index.ts";

export const ORIGIN = "https://acme.test";

export interface Route {
  readonly status?: number;
  readonly body?: string;
  /** Overrides the decoded byte count, so byte-budget tests need no real payload. */
  readonly bytes?: number;
  /** Makes the fake transport ask the caller's redirect policy about this hop. */
  readonly redirectTo?: string;
  /** Reports a different final URL without going through the redirect policy. */
  readonly finalUrl?: string;
  /** Transport-level failure instead of a response. */
  readonly error?: PublicResourceResult & { readonly kind: "error" };
}

export interface FakeSite {
  readonly fetch: ContextProfileFetch;
  readonly requested: string[];
  readonly slept: number[];
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  advance(ms: number): void;
}

/** A minimal marketing page with one heading per level and optional links. */
export function page(title: string, links: readonly string[] = []): string {
  const anchors = links.map((href) => `<a href="${href}">${href}</a>`).join("");
  return (
    `<html><head><title>${title}</title>` +
    `<meta name="description" content="${title} description"></head>` +
    `<body><h1>${title}</h1><h2>Second</h2><h3>Third</h3>` +
    `<p>${title} body copy.</p>${anchors}</body></html>`
  );
}

export function fakeSite(
  routes: Readonly<Record<string, Route>>,
  overrides: {
    /** Called before each response is built, so a test can move the world on. */
    readonly onRequest?: (url: string, site: FakeSite) => void;
  } = {},
): FakeSite {
  const requested: string[] = [];
  const slept: number[] = [];
  let clock = 1_000_000;
  const site: FakeSite = {
    requested,
    slept,
    // Waiting advances the clock, as it does in production. Without this the
    // pacing gate's reservations drift ever further ahead of a frozen `now()`
    // and every asserted delay would be an artefact of the fake.
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    now: () => clock,
    advance: (ms) => {
      clock += ms;
    },
    fetch: async (url: string, options: PublicResourceFetchOptions) => {
      requested.push(url);
      overrides.onRequest?.(url, site);
      const route = routes[new URL(url).pathname] ?? { status: 404 };
      if (route.error) return route.error;
      if (route.redirectTo) {
        const admitted = options.allowRedirect?.(url, route.redirectTo) ?? true;
        if (!admitted) return { kind: "error", code: "cross_origin" };
        return okResult(route.redirectTo, route, options);
      }
      return okResult(url, route, options);
    },
  };
  return site;
}

function okResult(
  url: string,
  route: Route,
  options: PublicResourceFetchOptions,
): PublicResourceResult {
  const body = route.body ?? "";
  const cap = options.maxBodyBytes ?? body.length;
  return {
    kind: "ok",
    requestedUrl: url,
    finalUrl: route.finalUrl ?? url,
    firstStatus: route.status ?? 200,
    finalStatus: route.status ?? 200,
    redirectChain: [],
    contentType: "text/html; charset=utf-8",
    xRobotsTag: null,
    // The real transport stops reading at maxBodyBytes, so a one-byte entry
    // probe must not be able to spend the whole crawl's byte budget.
    body: body.slice(0, cap),
    bytes: Math.min(route.bytes ?? body.length, cap),
    bodyComplete: true,
  };
}

export function run(
  site: FakeSite,
  extra: Parameters<typeof crawlSiteContextProfile>[1] = {},
): Promise<ContextProfileResult> {
  return crawlSiteContextProfile(`${ORIGIN}/`, {
    fetch: site.fetch,
    now: site.now,
    sleep: site.sleep,
    ...extra,
  });
}

/** Resolves to the error code, so a test never asserts on a message string. */
export async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ContextProfileError) return error.code;
    throw error;
  }
  throw new Error("expected a ContextProfileError");
}

export const HOMEPAGE_LINKS = [
  "/blog/why-we-built-it",
  "/pricing",
  "/about",
  "/features",
  "/careers",
  "/solutions/teams",
];

/** One ordinary site: a blog, a careers page, and four pages worth reading. */
export function marketingSite(
  extra: Readonly<Record<string, Route>> = {},
): Readonly<Record<string, Route>> {
  return {
    "/robots.txt": { body: "User-agent: *\nDisallow: /admin\n" },
    "/sitemap.xml": { status: 404 },
    "/": { body: page("Acme", HOMEPAGE_LINKS) },
    "/pricing": { body: page("Pricing") },
    "/about": { body: page("About") },
    "/features": { body: page("Features") },
    "/solutions/teams": { body: page("Teams") },
    "/blog/why-we-built-it": { body: page("Blog") },
    "/careers": { body: page("Careers") },
    ...extra,
  };
}
