// @input  -- the category a visitor typed
// @output -- the modifier left once their own product noun is removed
// @pos    -- a leaf both the confirm gate and the question generator import

/**
 * Why this lives alone in a file of its own.
 *
 * The generator needs it to build "{stem} tools", and the confirm gate needs it
 * to refuse a category that leaves nothing behind. The generator already
 * imports the confirmed context, so the gate cannot import the generator
 * without a cycle, and a second copy of the noun list is how the two come to
 * disagree about what counts as a category. A leaf both sides import is the
 * only arrangement where neither owns the other — the same reason
 * `geo-asset-type.ts` exists.
 */

/**
 * The product nouns the templates supply themselves.
 *
 * A visitor who answers "what do you sell" with "SEO tools" would otherwise be
 * asked about "SEO tools tools", and one who answers "software" about "software
 * software". Stripped repeatedly, because "SEO tools software" carries two.
 */
const PRODUCT_NOUN = /\s*\b(tool|tools|software|platform|platforms|app|apps)$/iu;

/**
 * What is left of a category once the template's own noun is removed.
 *
 * Empty when the visitor typed nothing but a product noun. That is not a
 * spelling problem: every question this tool sends is built as "{stem} tools",
 * so an empty stem produces "What are the top tools right now?" — a question
 * with no subject, which measures visibility in no market at all. The confirm
 * gate refuses it rather than spending eighteen provider calls on it.
 */
export function geoCategoryStem(value: string): string {
  let stem = value.replace(/\s+/gu, " ").trim();
  let previous = "";
  while (stem !== previous) {
    previous = stem;
    stem = stem.replace(PRODUCT_NOUN, "").trim();
  }
  return stem;
}

/** Whether this category names something, rather than only a kind of product. */
export function hasGeoCategorySubject(value: string): boolean {
  return geoCategoryStem(value).length > 0;
}
