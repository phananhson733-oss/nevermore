// @input  -- visitor-entered Agent target URL, market code, and language tag
// @output -- browser-safe validation shared by Profile readiness and server parsing
// @pos    -- lightweight preflight only; guarded server URL normalization remains authoritative

import { validateUrlPattern } from "../url-validation.ts";

const ISO_3166_ALPHA2_MARKET_CODES: ReadonlySet<string> = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO " +
    "FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE " +
    "JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO " +
    "MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW " +
    "PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM " +
    "TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

/** Accepts the same scheme-optional public URL shape as the SEO audit form. */
export function isAgentTargetUrlValid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (raw === "" || raw.length > 2_048) return false;
  const candidate = /^[a-z][a-z\d+.-]*:/iu.test(raw)
    ? raw
    : `https://${raw}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.username !== "" || parsed.password !== "") return false;
  } catch {
    return false;
  }

  return validateUrlPattern(candidate).valid;
}

/** Real assigned ISO 3166-1 alpha-2 codes; aliases such as UK/EU are rejected. */
export function isAgentMarketCodeValid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_3166_ALPHA2_MARKET_CODES.has(value.trim().toUpperCase())
  );
}

/** Returns a canonical BCP 47 tag, or null when the visitor input is invalid. */
export function canonicalAgentLanguageTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > 35) return null;
  try {
    return Intl.getCanonicalLocales(trimmed)[0] ?? null;
  } catch {
    return null;
  }
}

export function isAgentLanguageTagValid(value: unknown): value is string {
  return canonicalAgentLanguageTag(value) !== null;
}
