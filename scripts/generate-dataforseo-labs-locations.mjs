#!/usr/bin/env node
/**
 * Regenerate the frozen DataForSEO Labs location/language table.
 *
 * DataForSEO Labs does not serve every country, and each country it does serve
 * exposes its own closed set of language databases. Guessing either value from
 * `Intl` produces requests the provider rejects with task status 40501
 * ("Invalid Field"), which the collection layer classifies as a permanent
 * INVALID_CONFIGURATION failure. The only honest source for both values is the
 * provider's own free catalogue endpoint, so the table is fetched once and
 * committed as machine-generated evidence.
 *
 * Usage:
 *   DATAFORSEO_LOGIN=... DATAFORSEO_PASSWORD=... \
 *     node scripts/generate-dataforseo-labs-locations.mjs
 *
 * The endpoint is free; regenerating costs nothing.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CATALOGUE_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/locations_and_languages";
const OUTPUT = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  "packages/sources/src/dataforseo/generated/labs-locations.ts",
);

const login = process.env["DATAFORSEO_LOGIN"];
const password = process.env["DATAFORSEO_PASSWORD"];
if (!login || !password) {
  console.error(
    "DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required to regenerate.",
  );
  process.exit(1);
}

const response = await fetch(CATALOGUE_URL, {
  headers: {
    Authorization: `Basic ${Buffer.from(`${login}:${password}`, "utf8").toString("base64")}`,
  },
});
if (!response.ok) {
  console.error(`Catalogue request failed with HTTP ${response.status}.`);
  process.exit(1);
}
const payload = await response.json();
if (payload.status_code !== 20000) {
  console.error(
    `Catalogue request failed with provider status ${payload.status_code}.`,
  );
  process.exit(1);
}

const rows = payload.tasks?.[0]?.result ?? [];
const countries = rows
  .filter(
    (row) =>
      row.location_type === "Country" &&
      typeof row.country_iso_code === "string" &&
      /^[A-Z]{2}$/.test(row.country_iso_code) &&
      Number.isSafeInteger(row.location_code),
  )
  .sort((left, right) =>
    left.country_iso_code.localeCompare(right.country_iso_code, "en"),
  );

if (countries.length === 0) {
  console.error("Catalogue returned no usable country rows; refusing to write.");
  process.exit(1);
}

/**
 * Order each country's languages by database size, descending. Index 0 is then
 * the language with the most provider coverage, which is the only defensible
 * deterministic fallback when a market's own language is unavailable.
 */
function languageCodes(row) {
  return (row.available_languages ?? [])
    .filter(
      (language) =>
        typeof language.language_code === "string" &&
        language.language_code.trim() !== "",
    )
    .map((language) => ({
      code: language.language_code.trim().toLowerCase(),
      keywords: Number.isFinite(language.keywords) ? language.keywords : 0,
    }))
    .sort((left, right) =>
      right.keywords === left.keywords
        ? left.code.localeCompare(right.code, "en")
        : right.keywords - left.keywords,
    )
    .map((language) => language.code);
}

const entries = countries
  .map((row) => {
    const codes = languageCodes(row);
    if (codes.length === 0) return null;
    const languages = codes.map((code) => JSON.stringify(code)).join(", ");
    return `  ${row.country_iso_code}: {\n    locationCode: ${row.location_code},\n    locationName: ${JSON.stringify(row.location_name)},\n    languageCodes: [${languages}],\n  },`;
  })
  .filter((entry) => entry !== null);

const capturedAt = new Date().toISOString().slice(0, 10);
const file = `// GENERATED FILE — do not edit by hand.
// Source: GET ${CATALOGUE_URL}
// Captured: ${capturedAt} (${entries.length} countries served by DataForSEO Labs)
// Regenerate: node scripts/generate-dataforseo-labs-locations.mjs
//
// \`languageCodes\` is ordered by provider database size, descending, so index 0
// is the richest database for that country.

/** One country served by DataForSEO Labs, with its closed set of languages. */
export interface DataForSeoLabsLocation {
  readonly locationCode: number;
  readonly locationName: string;
  readonly languageCodes: readonly string[];
}

/** Catalogue capture identity. Bump by regenerating, never by hand. */
export const DATAFORSEO_LABS_LOCATIONS_CAPTURED_AT = "${capturedAt}";

/** ISO 3166-1 alpha-2 market code to the provider's own location identity. */
export const DATAFORSEO_LABS_LOCATIONS: Readonly<
  Record<string, DataForSeoLabsLocation>
> = {
${entries.join("\n")}
};
`;

await writeFile(OUTPUT, file, "utf8");
console.log(`Wrote ${entries.length} countries to ${OUTPUT}`);
