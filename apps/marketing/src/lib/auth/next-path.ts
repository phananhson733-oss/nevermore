// @input  -- an untrusted `next` query parameter
// @output -- a same-origin path, or "/" when the input could leave the site
// @pos    -- the return-target guard for the Google authorization flow
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * True when a string contains a character that changes how a URL parses.
 *
 * C0 controls and DEL are stripped by URL parsing, so a value holding one is
 * not the path it appears to be. A backslash is promoted to a separator in
 * special schemes, which turns a leading "/" followed by it into an authority.
 */
function hasParseAlteringCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
    if (character === "\\") return true;
  }
  return false;
}

/**
 * Only same-origin, same-site paths are accepted as a return target.
 *
 * An open redirect here would let someone hand out a gengrowth.ai link that
 * lands on their own page after a real Google sign-in — the sign-in itself
 * being genuine is exactly what makes it worth doing.
 *
 * Rejecting the `//` prefix alone was not enough, because the guard and its
 * consumer disagreed about what a path is. `new URL(next, origin)` in the
 * callback follows the WHATWG rules, so `/\evil.com` and `/<TAB>/evil.com`
 * both passed a `startsWith("/")` test here and then resolved to
 * `https://evil.com/` there.
 *
 * This rejects the CHARACTERS that can change the parse rather than trying to
 * enumerate the shapes they produce, and `backTo` in the callback re-checks
 * the resolved origin. Two gates, because the value is sealed into a cookie
 * here and consumed a redirect away.
 *
 * It lives in its own module so it can be tested without pulling a route
 * handler — and therefore `next/headers` — into a unit test. A redirect guard
 * that cannot be tested is one whose next regression is silent; this one
 * shipped broken with no coverage at all.
 */
export function safeNextPath(raw: string | null): string {
  if (!raw) return "/";
  if (hasParseAlteringCharacter(raw)) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}
