/**
 * Defensive renderer boundary for customer-visible research source links.
 *
 * The API contract already rejects non-HTTP(S) URLs and embedded credentials,
 * but persisted data can drift. Returning null keeps a corrupt source readable
 * as unavailable instead of ever assigning it to an anchor `href`.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

export function safeResearchSourceHref(
  value: string | null,
): string | null {
  if (
    value === null ||
    value.length === 0 ||
    value.length > 2048 ||
    value !== value.trim() ||
    hasControlCharacter(value)
  ) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}
