/**
 * The brand as sample content names it. Deliberately import-free: the store
 * selectors reach this module through `kb.ts` and ship it to the browser, and
 * `profile.ts` (which re-exports these) imports the audit rule library.
 */

export const BRAND_PLACEHOLDER = "[品牌]";

/** The brand as typed, or `[品牌]` when it is blank. */
export function brandOrPlaceholder(brand: string): string {
  return brand.trim() === "" ? BRAND_PLACEHOLDER : brand;
}
