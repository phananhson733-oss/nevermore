// @input  -- a Search Console property id
// @output -- the site as a person would write it
// @pos    -- display-only helper; the id itself is what every request carries
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Turn a Search Console property id into the site it refers to.
 *
 * `sc-domain:example.com` and `https://example.com/` are how the API names a
 * property, not how anyone thinks about their own site. The id keeps travelling
 * with every request — this is only what the reader sees.
 *
 * Deliberately conservative: anything that does not match a known shape is
 * returned untouched, because a label that quietly drops part of a property is
 * worse than one that looks technical.
 */
export function formatPropertyLabel(property: string): string {
  const trimmed = property.trim();

  if (trimmed.startsWith("sc-domain:")) {
    return trimmed.slice("sc-domain:".length) || trimmed;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const url = new URL(trimmed);
      // Keep a path prefix: `example.com/blog` and `example.com` are different
      // properties, and collapsing them would make the picker ambiguous.
      const path = url.pathname.replace(/\/+$/, "");
      return `${url.host}${path}`;
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}
