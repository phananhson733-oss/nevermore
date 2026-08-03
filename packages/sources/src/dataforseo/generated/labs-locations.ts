// GENERATED FILE — do not edit by hand.
// Source: GET https://api.dataforseo.com/v3/dataforseo_labs/locations_and_languages
// Captured: 2026-08-03 (92 countries served by DataForSEO Labs)
// Regenerate: node scripts/generate-dataforseo-labs-locations.mjs
//
// `languageCodes` is ordered by provider database size, descending, so index 0
// is the richest database for that country.

/** One country served by DataForSEO Labs, with its closed set of languages. */
export interface DataForSeoLabsLocation {
  readonly locationCode: number;
  readonly locationName: string;
  readonly languageCodes: readonly string[];
}

/** Catalogue capture identity. Bump by regenerating, never by hand. */
export const DATAFORSEO_LABS_LOCATIONS_CAPTURED_AT = "2026-08-03";

/** ISO 3166-1 alpha-2 market code to the provider's own location identity. */
export const DATAFORSEO_LABS_LOCATIONS: Readonly<
  Record<string, DataForSeoLabsLocation>
> = {
  AE: {
    locationCode: 2784,
    locationName: "United Arab Emirates",
    languageCodes: ["en", "ar"],
  },
  AL: {
    locationCode: 2008,
    locationName: "Albania",
    languageCodes: ["sq"],
  },
  AM: {
    locationCode: 2051,
    locationName: "Armenia",
    languageCodes: ["hy"],
  },
  AO: {
    locationCode: 2024,
    locationName: "Angola",
    languageCodes: ["pt"],
  },
  AR: {
    locationCode: 2032,
    locationName: "Argentina",
    languageCodes: ["es"],
  },
  AT: {
    locationCode: 2040,
    locationName: "Austria",
    languageCodes: ["de"],
  },
  AU: {
    locationCode: 2036,
    locationName: "Australia",
    languageCodes: ["en"],
  },
  AZ: {
    locationCode: 2031,
    locationName: "Azerbaijan",
    languageCodes: ["az"],
  },
  BA: {
    locationCode: 2070,
    locationName: "Bosnia and Herzegovina",
    languageCodes: ["bs"],
  },
  BD: {
    locationCode: 2050,
    locationName: "Bangladesh",
    languageCodes: ["bn"],
  },
  BE: {
    locationCode: 2056,
    locationName: "Belgium",
    languageCodes: ["nl", "fr", "de"],
  },
  BF: {
    locationCode: 2854,
    locationName: "Burkina Faso",
    languageCodes: ["fr"],
  },
  BG: {
    locationCode: 2100,
    locationName: "Bulgaria",
    languageCodes: ["bg"],
  },
  BH: {
    locationCode: 2048,
    locationName: "Bahrain",
    languageCodes: ["ar"],
  },
  BO: {
    locationCode: 2068,
    locationName: "Bolivia",
    languageCodes: ["es"],
  },
  BR: {
    locationCode: 2076,
    locationName: "Brazil",
    languageCodes: ["pt"],
  },
  CA: {
    locationCode: 2124,
    locationName: "Canada",
    languageCodes: ["en", "fr"],
  },
  CH: {
    locationCode: 2756,
    locationName: "Switzerland",
    languageCodes: ["de", "fr", "it"],
  },
  CI: {
    locationCode: 2384,
    locationName: "Cote d'Ivoire",
    languageCodes: ["fr"],
  },
  CL: {
    locationCode: 2152,
    locationName: "Chile",
    languageCodes: ["es"],
  },
  CM: {
    locationCode: 2120,
    locationName: "Cameroon",
    languageCodes: ["fr"],
  },
  CO: {
    locationCode: 2170,
    locationName: "Colombia",
    languageCodes: ["es"],
  },
  CR: {
    locationCode: 2188,
    locationName: "Costa Rica",
    languageCodes: ["es"],
  },
  CY: {
    locationCode: 2196,
    locationName: "Cyprus",
    languageCodes: ["el", "en"],
  },
  CZ: {
    locationCode: 2203,
    locationName: "Czechia",
    languageCodes: ["cs"],
  },
  DE: {
    locationCode: 2276,
    locationName: "Germany",
    languageCodes: ["de"],
  },
  DK: {
    locationCode: 2208,
    locationName: "Denmark",
    languageCodes: ["da"],
  },
  DZ: {
    locationCode: 2012,
    locationName: "Algeria",
    languageCodes: ["fr", "ar"],
  },
  EC: {
    locationCode: 2218,
    locationName: "Ecuador",
    languageCodes: ["es"],
  },
  EE: {
    locationCode: 2233,
    locationName: "Estonia",
    languageCodes: ["et"],
  },
  EG: {
    locationCode: 2818,
    locationName: "Egypt",
    languageCodes: ["ar", "en"],
  },
  ES: {
    locationCode: 2724,
    locationName: "Spain",
    languageCodes: ["es"],
  },
  FI: {
    locationCode: 2246,
    locationName: "Finland",
    languageCodes: ["fi"],
  },
  FR: {
    locationCode: 2250,
    locationName: "France",
    languageCodes: ["fr"],
  },
  GB: {
    locationCode: 2826,
    locationName: "United Kingdom",
    languageCodes: ["en"],
  },
  GH: {
    locationCode: 2288,
    locationName: "Ghana",
    languageCodes: ["en"],
  },
  GR: {
    locationCode: 2300,
    locationName: "Greece",
    languageCodes: ["el", "en"],
  },
  GT: {
    locationCode: 2320,
    locationName: "Guatemala",
    languageCodes: ["es"],
  },
  HR: {
    locationCode: 2191,
    locationName: "Croatia",
    languageCodes: ["hr"],
  },
  HU: {
    locationCode: 2348,
    locationName: "Hungary",
    languageCodes: ["hu"],
  },
  ID: {
    locationCode: 2360,
    locationName: "Indonesia",
    languageCodes: ["id", "en"],
  },
  IE: {
    locationCode: 2372,
    locationName: "Ireland",
    languageCodes: ["en"],
  },
  IL: {
    locationCode: 2376,
    locationName: "Israel",
    languageCodes: ["he", "ar"],
  },
  IN: {
    locationCode: 2356,
    locationName: "India",
    languageCodes: ["en", "hi"],
  },
  IT: {
    locationCode: 2380,
    locationName: "Italy",
    languageCodes: ["it"],
  },
  JO: {
    locationCode: 2400,
    locationName: "Jordan",
    languageCodes: ["ar"],
  },
  JP: {
    locationCode: 2392,
    locationName: "Japan",
    languageCodes: ["ja"],
  },
  KE: {
    locationCode: 2404,
    locationName: "Kenya",
    languageCodes: ["en"],
  },
  KH: {
    locationCode: 2116,
    locationName: "Cambodia",
    languageCodes: ["en"],
  },
  KR: {
    locationCode: 2410,
    locationName: "South Korea",
    languageCodes: ["ko"],
  },
  KZ: {
    locationCode: 2398,
    locationName: "Kazakhstan",
    languageCodes: ["ru"],
  },
  LK: {
    locationCode: 2144,
    locationName: "Sri Lanka",
    languageCodes: ["en"],
  },
  LT: {
    locationCode: 2440,
    locationName: "Lithuania",
    languageCodes: ["lt"],
  },
  LV: {
    locationCode: 2428,
    locationName: "Latvia",
    languageCodes: ["lv"],
  },
  MA: {
    locationCode: 2504,
    locationName: "Morocco",
    languageCodes: ["ar", "fr"],
  },
  MC: {
    locationCode: 2492,
    locationName: "Monaco",
    languageCodes: ["fr"],
  },
  MD: {
    locationCode: 2498,
    locationName: "Moldova",
    languageCodes: ["ro"],
  },
  MK: {
    locationCode: 2807,
    locationName: "North Macedonia",
    languageCodes: ["mk"],
  },
  MM: {
    locationCode: 2104,
    locationName: "Myanmar (Burma)",
    languageCodes: ["en"],
  },
  MT: {
    locationCode: 2470,
    locationName: "Malta",
    languageCodes: ["en"],
  },
  MX: {
    locationCode: 2484,
    locationName: "Mexico",
    languageCodes: ["es"],
  },
  MY: {
    locationCode: 2458,
    locationName: "Malaysia",
    languageCodes: ["en", "ms"],
  },
  NG: {
    locationCode: 2566,
    locationName: "Nigeria",
    languageCodes: ["en"],
  },
  NI: {
    locationCode: 2558,
    locationName: "Nicaragua",
    languageCodes: ["es"],
  },
  NL: {
    locationCode: 2528,
    locationName: "Netherlands",
    languageCodes: ["nl"],
  },
  NO: {
    locationCode: 2578,
    locationName: "Norway",
    languageCodes: ["nb"],
  },
  NZ: {
    locationCode: 2554,
    locationName: "New Zealand",
    languageCodes: ["en"],
  },
  PA: {
    locationCode: 2591,
    locationName: "Panama",
    languageCodes: ["es"],
  },
  PE: {
    locationCode: 2604,
    locationName: "Peru",
    languageCodes: ["es"],
  },
  PH: {
    locationCode: 2608,
    locationName: "Philippines",
    languageCodes: ["en", "tl"],
  },
  PK: {
    locationCode: 2586,
    locationName: "Pakistan",
    languageCodes: ["en", "ur"],
  },
  PL: {
    locationCode: 2616,
    locationName: "Poland",
    languageCodes: ["pl"],
  },
  PT: {
    locationCode: 2620,
    locationName: "Portugal",
    languageCodes: ["pt"],
  },
  PY: {
    locationCode: 2600,
    locationName: "Paraguay",
    languageCodes: ["es"],
  },
  RO: {
    locationCode: 2642,
    locationName: "Romania",
    languageCodes: ["ro"],
  },
  RS: {
    locationCode: 2688,
    locationName: "Serbia",
    languageCodes: ["sr"],
  },
  SA: {
    locationCode: 2682,
    locationName: "Saudi Arabia",
    languageCodes: ["ar"],
  },
  SE: {
    locationCode: 2752,
    locationName: "Sweden",
    languageCodes: ["sv"],
  },
  SG: {
    locationCode: 2702,
    locationName: "Singapore",
    languageCodes: ["en", "zh-cn"],
  },
  SI: {
    locationCode: 2705,
    locationName: "Slovenia",
    languageCodes: ["sl"],
  },
  SK: {
    locationCode: 2703,
    locationName: "Slovakia",
    languageCodes: ["sk"],
  },
  SN: {
    locationCode: 2686,
    locationName: "Senegal",
    languageCodes: ["fr"],
  },
  SV: {
    locationCode: 2222,
    locationName: "El Salvador",
    languageCodes: ["es"],
  },
  TH: {
    locationCode: 2764,
    locationName: "Thailand",
    languageCodes: ["th"],
  },
  TN: {
    locationCode: 2788,
    locationName: "Tunisia",
    languageCodes: ["ar"],
  },
  TR: {
    locationCode: 2792,
    locationName: "Turkiye",
    languageCodes: ["tr"],
  },
  UA: {
    locationCode: 2804,
    locationName: "Ukraine",
    languageCodes: ["uk", "ru"],
  },
  US: {
    locationCode: 2840,
    locationName: "United States",
    languageCodes: ["en", "es"],
  },
  UY: {
    locationCode: 2858,
    locationName: "Uruguay",
    languageCodes: ["es"],
  },
  VE: {
    locationCode: 2862,
    locationName: "Venezuela",
    languageCodes: ["es"],
  },
  VN: {
    locationCode: 2704,
    locationName: "Vietnam",
    languageCodes: ["vi", "en"],
  },
  ZA: {
    locationCode: 2710,
    locationName: "South Africa",
    languageCodes: ["en"],
  },
};
