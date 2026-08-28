// @input  -- temporary browser Product Profile values and field-level provenance
// @output -- bounded canonical search seeds and a cosmetic-change-stable identity
// @pos    -- browser-safe seam between live Product Profile refresh and competitor discovery

export interface ProfileSearchSeedInput {
  readonly productName: string;
  readonly categories: readonly string[];
  readonly oneLinePositioning: string;
  readonly coreFeatures: readonly string[];
  readonly fieldProvenance: readonly {
    readonly path: string;
    readonly source: string;
  }[];
}

type SearchSeedField =
  | "productName"
  | "categories"
  | "oneLinePositioning"
  | "coreFeatures";

const APPROVED_SEARCH_SEED_SOURCES = new Set<string>([
  "public_page",
  "supplied_product_information",
  "user_edit",
]);

const MAX_SEARCH_SEEDS = 5;
const MAX_SEARCH_SEED_LENGTH = 200;

function canonicalSearchSeed(value: string): string | null {
  const canonical = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!canonical || canonical.length > MAX_SEARCH_SEED_LENGTH) return null;

  const lower = canonical.toLocaleLowerCase("en-US");
  if (
    /^unknown(?: website)?$/u.test(lower) ||
    /^unknown\s*[—-]\s*confirm\b/u.test(lower) ||
    (/^public website at\b/u.test(lower) &&
      /not yet confirmed\.?$/u.test(lower)) ||
    /^未知(?:网站|\s*[—-]\s*.*确认)/u.test(canonical) ||
    (/上的公开网站/u.test(canonical) && /尚未确认。?$/u.test(canonical))
  ) {
    return null;
  }

  return canonical;
}

function fieldHasApprovedSource(
  profile: ProfileSearchSeedInput,
  field: SearchSeedField,
): boolean {
  const provenance = profile.fieldProvenance.find(
    (entry) => entry.path === `/${field}`,
  );
  return (
    provenance !== undefined &&
    APPROVED_SEARCH_SEED_SOURCES.has(provenance.source)
  );
}

export function deriveProfileSearchSeeds(
  profile: ProfileSearchSeedInput,
): readonly string[] {
  const candidates: string[] = [];
  if (fieldHasApprovedSource(profile, "productName")) {
    candidates.push(profile.productName);
  }
  if (fieldHasApprovedSource(profile, "categories")) {
    candidates.push(...profile.categories.slice(0, 2));
  }
  if (fieldHasApprovedSource(profile, "oneLinePositioning")) {
    candidates.push(profile.oneLinePositioning);
  }
  if (fieldHasApprovedSource(profile, "coreFeatures")) {
    candidates.push(...profile.coreFeatures);
  }

  const seeds: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const canonical = canonicalSearchSeed(candidate);
    if (!canonical) continue;
    const identity = canonical.toLocaleLowerCase("en-US");
    if (seen.has(identity)) continue;
    seen.add(identity);
    seeds.push(canonical);
    if (seeds.length === MAX_SEARCH_SEEDS) break;
  }
  return seeds;
}

export function deriveProductProfileSearchSeeds(
  profile: ProfileSearchSeedInput,
): readonly string[] {
  return deriveProfileSearchSeeds(profile);
}

export function productProfileSearchSeedsIdentity(
  seeds: readonly string[],
): string {
  return JSON.stringify(
    seeds.map(
      (seed) =>
        canonicalSearchSeed(seed)?.toLocaleLowerCase("en-US") ?? "",
    ),
  );
}
