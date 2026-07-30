export type ProductProfileSynthesisOrigin =
  | "initial"
  | "after_crawl"
  | "manual";

export interface AutomaticSynthesisInput {
  readonly rowId: string | null;
  readonly version: number | null;
  readonly status: "draft" | "complete" | null;
  readonly generatedAt: string | null;
  readonly activeSynthesisRunId: string | null;
  readonly crawlRunId: string;
}

/**
 * A draft gets one automatic generation attempt per immutable version. Active
 * Crawl/synthesis work suppresses the mount effect; callers claim the returned
 * key before starting an async request.
 */
export function automaticSynthesisKey(
  input: AutomaticSynthesisInput,
): string | null {
  if (
    input.rowId === null ||
    input.version === null ||
    input.status !== "draft" ||
    input.generatedAt !== null ||
    input.activeSynthesisRunId !== null ||
    input.crawlRunId.length > 0
  ) {
    return null;
  }
  return `${input.rowId}:${input.version}`;
}

/** Atomically claim one UI-side orchestration attempt before crossing the API. */
export function claimOnce(claimed: Set<string>, key: string): boolean {
  if (claimed.has(key)) return false;
  claimed.add(key);
  return true;
}

/**
 * A missing snapshot starts Crawl for the initial or explicit customer
 * attempt. If the retry immediately after a finished Crawl still lacks usable
 * evidence, stop and ask the customer to retry instead of creating a loop.
 */
export function shouldStartCrawlForMissingSnapshot(
  origin: ProductProfileSynthesisOrigin,
): boolean {
  return origin !== "after_crawl";
}

export type CustomerProfileFieldKey =
  | "businessHint"
  | "productName"
  | "customerModel"
  | "growthObjectives"
  | "oneLiner"
  | "category"
  | "productType"
  | "businessModels"
  | "valueProposition"
  | "coreFeatures"
  | "primaryMarket"
  | "primaryIcp"
  | "competitors"
  | "other";

const CUSTOMER_FIELD_KEYS = new Map<string, CustomerProfileFieldKey>([
  ["businessHint", "businessHint"],
  ["productName", "productName"],
  ["customerModel", "customerModel"],
  ["growthObjectives", "growthObjectives"],
  ["oneLiner", "oneLiner"],
  ["category", "category"],
  ["productType", "productType"],
  ["businessModels", "businessModels"],
  ["valueProposition", "valueProposition"],
  ["coreFeatures", "coreFeatures"],
  ["targetMarkets", "primaryMarket"],
  ["targetAudiences", "primaryIcp"],
  ["competitorCandidates", "competitors"],
]);

/** Convert internal JSON pointers to stable customer vocabulary. */
export function customerProfileFieldKey(
  pointer: string,
): CustomerProfileFieldKey {
  const root = pointer.split("/").filter(Boolean)[0] ?? "";
  return CUSTOMER_FIELD_KEYS.get(root) ?? "other";
}
