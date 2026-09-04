import type { InternalLinkAuditLocale } from "./internal-link-audit-content";

export function retryAfterMessage(
  retryAfterHeader: string | null,
  locale: InternalLinkAuditLocale,
): string | null {
  if (!retryAfterHeader || !/^\d+$/.test(retryAfterHeader.trim())) return null;
  const seconds = Number(retryAfterHeader);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
  return locale === "zh"
    ? `请在 ${seconds} 秒后重试。`
    : `Try again in ${seconds} seconds.`;
}
