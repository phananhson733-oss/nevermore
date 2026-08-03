/**
 * Brand-term CANDIDATES derived from a property, for the visitor to confirm.
 *
 * Nothing here is evidence. The output is a starting list for a form, and the
 * split refuses to run until someone has actually looked at it — see
 * `brandTermsConfirmed` in `brand-split.ts`.
 *
 * The reason for the ceremony is that domain-derived guesses fail in both
 * directions, and both failures are silent:
 *
 * - Too narrow: a label like `astrologywiki` never matches the way people
 *   actually type the brand, which is two words. Token-boundary matching (the
 *   correct choice everywhere else) makes this worse, not better.
 * - Too wide: splitting that same label into `astrology` would classify every
 *   generic query in the niche as brand, quietly emptying the non-brand group
 *   of exactly the queries the comparison exists to measure.
 *
 * There is no way to tell those two cases apart from the domain alone, so the
 * module does not try. It emits the mechanical variants and stops.
 */

/** Public-suffix-ish labels never worth proposing as a brand term. */
const IGNORED_LABELS: ReadonlySet<string> = new Set([
  "com",
  "net",
  "org",
  "io",
  "ai",
  "co",
  "app",
  "dev",
  "www",
  "site",
  "shop",
  "blog",
  "online",
  "store",
  "xyz",
  "me",
  "info",
  "biz",
]);

/**
 * The registrable-ish label of a Search Console property.
 *
 * Handles both property forms: `sc-domain:example.com` and a URL prefix like
 * `https://www.example.com/`. Returns null when nothing usable is left, which
 * is a real outcome for a property whose whole name is a public suffix.
 */
export function propertyLabel(property: string): string | null {
  const trimmed = property.trim();
  if (trimmed === "") return null;

  const host = trimmed.startsWith("sc-domain:")
    ? trimmed.slice("sc-domain:".length)
    : hostOfUrl(trimmed);
  if (host === null) return null;

  const labels = host
    .toLowerCase()
    .split(".")
    .filter(
      (label) =>
        label !== "" &&
        !IGNORED_LABELS.has(label) &&
        // Any label of two characters or fewer is a country code or a
        // second-level registry label, never a brand. Without this rule
        // `blog.example.co.uk` proposed "uk" as the brand term: `co` was on
        // the list but `uk` was not, and the last surviving label won.
        // Enumerating every ccTLD would be a public-suffix list, which is far
        // more machinery than a form's default value is worth.
        label.length > 2,
    );
  // The last surviving label is the closest thing to a brand: for
  // `shop.blog.example.co.uk` everything but `blog` and `example` is dropped,
  // and the rightmost of those is the registrable one.
  return labels[labels.length - 1] ?? null;
}

function hostOfUrl(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    // Not a URL. A bare host is still usable; anything with a slash is not.
    return value.includes("/") ? null : value;
  }
}

/**
 * Mechanical variants of the label, in the order they should be offered.
 *
 * Only transformations that cannot invent a word boundary: a hyphen is a
 * boundary the domain owner wrote down, so splitting on it is reading rather
 * than guessing. Concatenated labels are offered as-is and left for the
 * visitor to split, because `astrologywiki` and `gengrowth` look identical to
 * a program and completely different to a person.
 */
export function brandTermCandidates(property: string): readonly string[] {
  const label = propertyLabel(property);
  if (label === null) return [];

  const candidates = [label];
  if (label.includes("-")) {
    const spaced = label.split("-").filter(Boolean).join(" ");
    const joined = label.split("-").filter(Boolean).join("");
    if (spaced !== "" && !candidates.includes(spaced)) candidates.push(spaced);
    if (joined !== "" && !candidates.includes(joined)) candidates.push(joined);
  }
  return candidates;
}
