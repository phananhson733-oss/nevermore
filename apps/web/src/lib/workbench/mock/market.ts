/**
 * Content language for a project's market (R16). `Profile.market` is an ISO
 * 3166-1 alpha-2 code, so the prototype's `market === "中文"` never matched;
 * every unmapped code (including "", US, GB) is en-US. Case-insensitive.
 */
export type MarketLanguage = "zh-CN" | "zh-TW" | "zh-HK" | "ja-JP" | "ko-KR" | "en-US";

const MARKET_LANGUAGES: ReadonlyMap<string, MarketLanguage> = new Map<string, MarketLanguage>([
  ["CN", "zh-CN"],
  ["TW", "zh-TW"],
  ["HK", "zh-HK"],
  ["JP", "ja-JP"],
  ["KR", "ko-KR"],
]);

export function marketLanguage(code: string): MarketLanguage {
  return MARKET_LANGUAGES.get(code.toUpperCase()) ?? "en-US";
}
