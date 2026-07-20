const FALLBACK_PATH = "/";
const VALIDATION_ORIGIN = "https://signalframe.invalid";
const MAX_REDIRECT_PATH_LENGTH = 2_048;

function hasAmbiguousUrlSeparator(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (character === "\\" || codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Return a normalized same-origin path suitable for a post-authentication
 * redirect. Browsers treat backslashes and ASCII controls as URL separators in
 * surprising ways, so a `startsWith("/")` check alone is not an origin fence.
 */
export function safePostLoginPath(raw: unknown): string {
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    raw.length > MAX_REDIRECT_PATH_LENGTH ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    hasAmbiguousUrlSeparator(raw)
  ) {
    return FALLBACK_PATH;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw, VALIDATION_ORIGIN);
  } catch {
    return FALLBACK_PATH;
  }
  if (parsed.origin !== VALIDATION_ORIGIN) return FALLBACK_PATH;

  // Return the URL parser's normalized path, never the attacker-controlled raw
  // string. This keeps the eventual Location header unambiguously path-relative.
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
