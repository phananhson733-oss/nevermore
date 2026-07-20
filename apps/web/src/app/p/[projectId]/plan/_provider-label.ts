export const LOCALIZED_EVIDENCE_PROVIDERS = [
  "crawl",
  "gsc",
  "ga4",
  "csv",
  "dataforseo",
  "ahrefs",
  "semrush",
  "system",
  "llm",
] as const;

export type LocalizedEvidenceProvider =
  (typeof LOCALIZED_EVIDENCE_PROVIDERS)[number];

const LOCALIZED_EVIDENCE_PROVIDER_SET = new Set<string>(
  LOCALIZED_EVIDENCE_PROVIDERS,
);

/**
 * Localizes canonical provider values plus legacy display-only compatibility
 * labels without forwarding unknown API values to next-intl (which would log
 * a missing-message error). Unknown future values remain visible, while an
 * empty value uses the localized unavailable label.
 */
export function evidenceProviderLabel(
  provider: string,
  translate: (key: LocalizedEvidenceProvider) => string,
  unavailable: string,
): string {
  const fallback = provider.trim();
  const normalized = fallback.toLowerCase();

  return LOCALIZED_EVIDENCE_PROVIDER_SET.has(normalized)
    ? translate(normalized as LocalizedEvidenceProvider)
    : fallback || unavailable;
}
