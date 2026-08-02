export type ProductProfileSynthesisOrigin =
  | "initial"
  | "after_crawl"
  | "after_discovery"
  | "manual";

export interface AutomaticSynthesisInput {
  readonly rowId: string | null;
  readonly version: number | null;
  readonly status: "draft" | "complete" | null;
  readonly generatedAt: string | null;
  readonly hasSynthesisAttemptForCurrentDraft: boolean;
  readonly activeSynthesisRunId: string | null;
  readonly crawlRunId: string;
  readonly discoveryRunId: string;
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
    input.hasSynthesisAttemptForCurrentDraft ||
    input.activeSynthesisRunId !== null ||
    input.crawlRunId.length > 0 ||
    input.discoveryRunId.length > 0
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
  return origin === "initial" || origin === "manual";
}

export type ProductProfileSynthesisFailureKind =
  | "configuration"
  | "temporary_provider"
  | "input_or_evidence"
  | "operator_review"
  | "superseded"
  | "cancelled"
  | "unknown";

export interface ProductProfileSynthesisFailureInput {
  readonly status: string | null;
  readonly lastError: {
    readonly code: string;
    readonly summary: string;
  } | null;
}

const SYNTHESIS_SUPERSEDED_CODES = new Set([
  "PRODUCT_PROFILE_SYNTHESIS_SUPERSEDED",
]);
const SYNTHESIS_CANCELLED_CODES = new Set(["QUEUE_JOB_CANCELLED"]);
const SYNTHESIS_CONFIGURATION_CODES = new Set([
  "AUTH_FAILED",
  "CONFIG_INVALID",
  "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_CONFIGURATION_MISMATCH",
]);
const SYNTHESIS_EVIDENCE_CODES = new Set([
  "CRAWL_SNAPSHOT_REQUIRED",
  "PRODUCT_PROFILE_SYNTHESIS_INPUT_INVALID",
  "PRODUCT_PROFILE_SYNTHESIS_RUN_INVALID",
]);
const SYNTHESIS_REVIEW_CODES = new Set([
  "INVALID_RESPONSE",
  "REFERENCE_INTEGRITY",
  "SAFETY_VIOLATION",
  "SCHEMA_INVALID",
  "PRODUCT_PROFILE_SYNTHESIS_COMMIT_FAILED",
  "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_BUDGET_EXHAUSTED",
  "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_OUTCOME_UNKNOWN",
  "PRODUCT_PROFILE_SYNTHESIS_RESULT_INVALID",
]);
const SYNTHESIS_TEMPORARY_PROVIDER_CODES = new Set([
  "NETWORK_ERROR",
  "QUEUE_JOB_FAILED",
  "QUEUE_RETRY_EXHAUSTED",
  "RATE_LIMITED",
  "SERVER_ERROR",
  "TIMEOUT",
]);

// Legacy canonical rows predate stable terminal codes. Keep only a small exact
// compatibility map: provider text is never trustworthy enough for a broad
// substring classification and is never rendered to the customer.
const LEGACY_SYNTHESIS_FAILURE_SUMMARY_KIND = new Map<
  string,
  ProductProfileSynthesisFailureKind
>([
  [
    "Queue retries exhausted before the run completed.",
    "temporary_provider",
  ],
  [
    "The provider timed out while serving the request.",
    "temporary_provider",
  ],
]);

/**
 * Reduce terminal run diagnostics to a small, customer-safe category.
 *
 * Stable error codes are authoritative. A raw summary is considered only for
 * a narrow legacy compatibility map; callers render approved i18n copy and
 * never echo the provider summary.
 */
export function productProfileSynthesisFailureKind(
  input: ProductProfileSynthesisFailureInput,
): ProductProfileSynthesisFailureKind {
  const code = input.lastError?.code.trim().toUpperCase() ?? "";
  if (SYNTHESIS_SUPERSEDED_CODES.has(code)) {
    return "superseded";
  }

  if (input.status === "cancelled" || SYNTHESIS_CANCELLED_CODES.has(code)) {
    return "cancelled";
  }

  if (SYNTHESIS_CONFIGURATION_CODES.has(code)) {
    return "configuration";
  }

  if (SYNTHESIS_EVIDENCE_CODES.has(code)) {
    return "input_or_evidence";
  }

  if (SYNTHESIS_REVIEW_CODES.has(code)) {
    return "operator_review";
  }

  if (SYNTHESIS_TEMPORARY_PROVIDER_CODES.has(code)) {
    return "temporary_provider";
  }

  return (
    LEGACY_SYNTHESIS_FAILURE_SUMMARY_KIND.get(
      input.lastError?.summary.trim() ?? "",
    ) ?? "unknown"
  );
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
