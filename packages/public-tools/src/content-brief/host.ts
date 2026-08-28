// @input  -- a URL or bare host a SERP row carried
// @output -- the canonical host key crawl planning and the parser agree on
// @pos    -- the only host normalisation the content brief uses (mirrors serp-landscape.hostKey)
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Same rule as `apps/marketing/src/lib/tools/serp-landscape.ts#hostKey`,
 * duplicated here on purpose: the parser rebuilds the crawl plan from the
 * SERP ledger to prove a `same_host` skip was real, and a package cannot
 * import the app. Lowercased host with a leading `www.` removed; null when
 * neither the value nor `https://` + value parses.
 */
export function hostKey(value: string): string | null {
  for (const candidate of [value, `https://${value}`]) {
    try {
      return new URL(candidate).host.toLowerCase().replace(/^www\./u, "");
    } catch {
      // Try the next spelling.
    }
  }
  return null;
}
