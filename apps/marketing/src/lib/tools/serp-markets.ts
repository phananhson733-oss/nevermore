// @input  -- nothing; the markets and languages the results-page lookup accepts
// @output -- the provider ids, and the ordered options a selector is drawn from
// @pos    -- the one list the form offers and the paid lookup enforces
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Why this is its own module rather than part of the lookup.
 *
 * The lookup builds a DataForSEO client, so it imports `@sf/sources`, and a
 * browser bundle that reached that barrel would pull `node:net` into a client
 * chunk. The form has to offer exactly the codes the lookup accepts, so the
 * codes live here — no imports at all — and both sides read them from here.
 *
 * Keeping them in two places is the failure this shape exists to prevent: a
 * selector offering a market the lookup refuses spends nothing and reports
 * `market_not_supported`, which reads to the visitor as a broken tool.
 */

/**
 * Markets this tool will look up, mapped to the provider's location ids.
 *
 * An allow-list, not a passthrough: the provider bills per task and answers an
 * unknown location with an error only after the call is made, so an unmapped
 * code would be a paid round trip to learn the visitor typed something wrong.
 *
 * Wider than the keyword tool's list on purpose. That one is scoped to markets
 * whose copy and coverage window were reasoned about; this one only reads a
 * results page back, and refusing a Chinese-language market on a Chinese-first
 * product would have been the tool telling most of its own audience that their
 * market does not exist.
 */
export const SERP_LOCATIONS: Readonly<Record<string, number>> = {
  US: 2840,
  GB: 2826,
  CA: 2124,
  AU: 2036,
  IE: 2372,
  NZ: 2554,
  DE: 2276,
  FR: 2250,
  ES: 2724,
  IT: 2380,
  NL: 2528,
  SE: 2752,
  NO: 2578,
  DK: 2208,
  FI: 2246,
  PL: 2616,
  PT: 2620,
  BR: 2076,
  MX: 2484,
  IN: 2356,
  JP: 2392,
  KR: 2410,
  SG: 2702,
  HK: 2344,
  TW: 2158,
  MY: 2458,
  TH: 2764,
  ID: 2360,
  VN: 2704,
  PH: 2608,
  AE: 2784,
  ZA: 2710,
  CN: 2156,
};

/**
 * Languages this tool will ask the provider for.
 *
 * An allow-list for the same reason the market list is one: the provider bills
 * per task and rejects an unknown language only after the call is made. The
 * market was allow-listed and the language was not, so `language: "zz"` passed
 * both the request validator and this lookup and bought a provider error.
 */
export const SERP_LANGUAGES: ReadonlySet<string> = new Set([
  "en", "zh", "ja", "ko", "de", "fr", "es", "it", "pt", "nl", "sv", "no", "da",
  "fi", "pl", "ru", "tr", "ar", "hi", "th", "vi", "id", "ms", "he", "cs", "el",
  "hu", "ro", "uk",
]);

/** What the form starts on, and what the lookup gets when nothing is chosen. */
export const DEFAULT_SERP_MARKET = "US";
export const DEFAULT_SERP_LANGUAGE = "en";

export interface SerpOption {
  readonly code: string;
  /** English, in both locales: the codes and their English names are what every
   * other tool in this category prints, and a translated country list would be
   * 124 strings whose only job is to say the same thing twice. */
  readonly label: string;
}

/**
 * The market names, in the order the codes were authored.
 *
 * Not alphabetical: the grouping (English-speaking, Europe, the Americas, Asia,
 * the rest) is how someone scans for their own market, and sorting by name
 * scatters it.
 */
const MARKET_LABELS: Readonly<Record<string, string>> = {
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  IE: "Ireland",
  NZ: "New Zealand",
  DE: "Germany",
  FR: "France",
  ES: "Spain",
  IT: "Italy",
  NL: "Netherlands",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  PL: "Poland",
  PT: "Portugal",
  BR: "Brazil",
  MX: "Mexico",
  IN: "India",
  JP: "Japan",
  KR: "South Korea",
  SG: "Singapore",
  HK: "Hong Kong SAR",
  TW: "Taiwan",
  MY: "Malaysia",
  TH: "Thailand",
  ID: "Indonesia",
  VN: "Vietnam",
  PH: "Philippines",
  AE: "United Arab Emirates",
  ZA: "South Africa",
  CN: "Chinese mainland",
};

const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  en: "English",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  de: "German",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  sv: "Swedish",
  no: "Norwegian",
  da: "Danish",
  fi: "Finnish",
  pl: "Polish",
  ru: "Russian",
  tr: "Turkish",
  ar: "Arabic",
  hi: "Hindi",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
  ms: "Malay",
  he: "Hebrew",
  cs: "Czech",
  el: "Greek",
  hu: "Hungarian",
  ro: "Romanian",
  uk: "Ukrainian",
};

/**
 * Derived from the allow-lists, not written beside them.
 *
 * A hand-kept second list is how a selector comes to offer a market the lookup
 * refuses; deriving the options means a code added above appears in the form or
 * fails the build, and never silently goes missing from one of the two.
 */
export const SERP_MARKET_OPTIONS: readonly SerpOption[] = Object.keys(
  SERP_LOCATIONS,
).map((code) => ({ code, label: MARKET_LABELS[code] ?? code }));

export const SERP_LANGUAGE_OPTIONS: readonly SerpOption[] = [
  ...SERP_LANGUAGES,
].map((code) => ({ code, label: LANGUAGE_LABELS[code] ?? code }));
