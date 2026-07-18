/**
 * Deterministic string helpers shared by the artifact templates. No clock and
 * no randomness: identical input always yields byte-identical output, which is
 * what makes the generated content hashable and reproducible (spec §10.3).
 */

/** zh-CN (or any `zh-*`) locale selects Chinese headings/body; else English. */
export function isZh(locale: string): boolean {
  return locale.toLowerCase().startsWith("zh");
}

/** Locale-select helper: pick the Chinese or English variant. */
export function pick(zh: boolean, zhText: string, enText: string): string {
  return zh ? zhText : enText;
}

/**
 * Neutralize an allowlisted input value for safe inline markdown interpolation:
 * escape angle brackets (spec §14.4 — no raw HTML/script survives) and collapse
 * whitespace so a value can never inject a spurious `## ` heading. Idempotent.
 */
export function clean(value: string): string {
  return value
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/\s+/gu, " ")
    .trim();
}

/** First non-empty cleaned value, or the fallback. */
export function firstNonEmpty(values: readonly string[], fallback: string): string {
  for (const value of values) {
    const c = clean(value);
    if (c.length > 0) {
      return c;
    }
  }
  return clean(fallback);
}

/** Deterministic truncation with an ellipsis marker, for title/description caps. */
export function truncate(value: string, max: number): string {
  const v = value.trim();
  if (v.length <= max) {
    return v;
  }
  return `${v.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Dedupe + clean a list, dropping empties, preserving first-seen order. */
export function uniqueClean(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const c = clean(value);
    if (c.length > 0 && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/**
 * Derive target queries from the strongest available allowlisted source:
 * evidence subject refs first, then the finding subject refs, then ICP use
 * cases. Never fabricates — returns [] only when all sources are empty.
 */
export function deriveTargetQueries(input: {
  readonly evidence: readonly { readonly subjectRefs: readonly string[] }[];
  readonly finding: { readonly subjectRefs: readonly string[] };
  readonly icp: { readonly useCases: readonly string[] };
}): string[] {
  const fromEvidence = input.evidence.flatMap((e) => e.subjectRefs);
  if (fromEvidence.length > 0) {
    return uniqueClean(fromEvidence);
  }
  if (input.finding.subjectRefs.length > 0) {
    return uniqueClean(input.finding.subjectRefs);
  }
  return uniqueClean(input.icp.useCases);
}

/** Render a markdown bullet list; an empty list collapses to the fallback line. */
export function bullets(items: readonly string[], fallback: string): string {
  const rendered = uniqueClean(items);
  if (rendered.length === 0) {
    return `- ${clean(fallback)}`;
  }
  return rendered.map((i) => `- ${i}`).join("\n");
}

/** Render an unchecked markdown checklist. */
export function checklist(items: readonly string[]): string {
  return items.map((i) => `- [ ] ${clean(i)}`).join("\n");
}

/** Render a numbered list; an empty list collapses to the fallback line. */
export function numbered(items: readonly string[], fallback: string): string {
  const rendered = items.map(clean).filter((i) => i.length > 0);
  const list = rendered.length === 0 ? [clean(fallback)] : rendered;
  return list.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

export interface RenderedSection {
  readonly heading: string;
  readonly body: string;
}

/** Join sections into a markdown document with `## ` headings. */
export function renderMarkdown(sections: readonly RenderedSection[]): string {
  return `${sections.map((s) => `## ${s.heading}\n\n${s.body.trim()}`).join("\n\n")}\n`;
}
