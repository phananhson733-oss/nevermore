// @input -- a website URL and its declared product name
// @output -- bounded, reviewable KB aliases; never a saved-state synchronization
// @pos -- KB-specific split-name/domain proposals, leaving GEO Agent history unchanged
import { isMatchableGeoName, normalizeAliasForMatch } from "../agents/geo-alias-match.ts";
import { proposeGeoAliasCandidates } from "../agents/geo-context.ts";
import { normalizeGeoHost } from "../agents/geo-url.ts";
import { GEO_KB_LIMITS } from "./kb-contract.ts";

export function proposeGeoKbAliases(targetUrl: string, productName: string): readonly string[] {
  const existing = proposeGeoAliasCandidates(targetUrl, productName);
  const output: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string): void => {
    const value = raw.normalize("NFC").trim();
    const key = normalizeAliasForMatch(value);
    if (value.length > GEO_KB_LIMITS.listItem || !isMatchableGeoName(value) || seen.has(key)) return;
    seen.add(key); output.push(value);
  };
  const name = productName.normalize("NFC").trim();
  const declared = existing.find(candidate => candidate.source === "profile_product_name");
  // The older Agent proposer has a character-count floor. Use the actual
  // matcher for short no-space-script names, without relaxing Latin names.
  if (declared || (name.length < 3 && isMatchableGeoName(name))) push(name);
  const split = name.replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2").replace(/([a-z])([A-Z])/gu, "$1 $2");
  if (declared && split !== name && split.split(/\s+/u).every(word => word.length >= 2)) push(split);
  for (const candidate of existing) push(candidate.alias);
  const host = normalizeGeoHost(targetUrl);
  if (host !== null) push(host);
  return output.slice(0, GEO_KB_LIMITS.aliases);
}
