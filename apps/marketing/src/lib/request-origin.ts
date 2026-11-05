// @input  -- a route handler's Request: its Host header and the URL Next built for it
// @output -- requestOrigin(): the origin the visitor's browser actually used
// @pos    -- shared by the route handlers' same-origin checks and absolute redirects
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

// A bare hostname with an optional port. Anything else in Host (a path,
// credentials, whitespace) is not a host, and is ignored.
const HOST_HEADER = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;

/**
 * The origin the visitor's browser used, for comparing with an `Origin` header
 * or building an absolute redirect.
 *
 * Self-hosted, Next builds `request.url` from the server's own HOSTNAME and
 * PORT, so in the gengrowth.ai container it reads https://0.0.0.0:3001/... and
 * an Origin check against it rejects every real browser. `Host` is what the
 * browser sent: pick's Caddy passes it through unchanged, and only for the
 * hosts it serves; on Vercel it already equals `request.url`'s host, so the
 * answer there is the same as before. `X-Forwarded-Host` is not read: a
 * trusting proxy keeps it from upstream, so whether a visitor can set it
 * depends on every hop before this one.
 *
 * The scheme stays `request.url`'s, which Next takes from X-Forwarded-Proto.
 * Without a usable Host this is `request.url`'s origin, so an Origin check
 * then fails closed.
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("host")?.trim();
  if (!host || !HOST_HEADER.test(host)) return url.origin;
  try {
    return new URL(`${url.protocol}//${host}`).origin;
  } catch {
    return url.origin;
  }
}
