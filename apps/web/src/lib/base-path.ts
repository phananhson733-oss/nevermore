/**
 * Optional deployment base path for generic self-hosting. When the app is mounted
 * under a host sub-path, every same-origin URL the app
 * MINTS by hand (the OAuth redirect URI, the async status/Location URLs, the client
 * `fetch` base, the OAuth callback 303 target) must carry that prefix. Next's own
 * `basePath` config auto-prefixes `<Link>`, `redirect()` and static assets, but NOT
 * hand-built strings passed to `fetch`, `new URL()`, or a raw `Location` header.
 *
 * Single source of truth: `NEXT_PUBLIC_BASE_PATH` (build-time, available on both the
 * server and — inlined — the client). Unset (including approved app.gengrowth.ai
 * production, local dev and tests) → `""`, so the app serves at the origin root.
 * A self-hosted sub-path deployment must register its matching Google OAuth redirect URI.
 */

/** Normalize a raw base-path env value to "" (root) or a leading-slash path like
 *  "/app". Accepts "app", "/app", "/app/" and "" / "/" (all handled), trimming
 *  surrounding slashes so the result never double-slashes when concatenated. */
export function normalizeBasePath(raw: string | undefined): string {
  const trimmed = (raw ?? "").replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
}

/** Normalized base path: "" (root) or a single leading-slash segment like "/app". */
export const BASE_PATH: string = normalizeBasePath(
  process.env["NEXT_PUBLIC_BASE_PATH"],
);

/** Prefix a same-origin absolute path (leading "/") with the deployment base path. */
export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}
