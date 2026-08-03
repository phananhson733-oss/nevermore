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
 * A missing snapshot starts Crawl for the initial attempt, an explicit customer
 * attempt, or the continuation after competitor discovery finished.
 *
 * Discovery runs before any Crawl on a new product, and the banner shown when
 * it ends promises the system will carry on from website evidence. Refusing to
 * start Crawl here made that promise false and left the onboarding with no
 * evidence at all. Only `after_crawl` still stops: a retry immediately after a
 * finished Crawl that still lacks usable evidence would be a loop.
 */
export function shouldStartCrawlForMissingSnapshot(
  origin: ProductProfileSynthesisOrigin,
): boolean {
  return origin !== "after_crawl";
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

/**
 * A rejected synthesis *request* also deserves specific copy.
 *
 * `productProfileSynthesisFailureKind` classifies a terminal run. The command
 * that queues the run can be refused before any run exists, and in production
 * every such refusal rendered the same "try again later" fallback — including
 * the workspace rate limit, which is neither a broken service nor something a
 * further click can fix.
 */
/**
 * Whether this origin may start Crawl without the customer asking.
 *
 * Only an explicit customer attempt is exempt from the once-per-project claim
 * above it. Two automatic origins can both find no snapshot — the mount attempt
 * and the continuation after competitor discovery — and a customer's site must
 * not be crawled twice because the two raced.
 */
export function isAutomaticCrawlOrigin(
  origin: ProductProfileSynthesisOrigin,
): boolean {
  return origin !== "manual";
}

export type ProductProfileSynthesisRequestFailureKind =
  | ProductProfileSynthesisFailureKind
  | "rate_limited";

export function productProfileSynthesisRequestFailureKind(
  code: string | null,
): ProductProfileSynthesisRequestFailureKind {
  const normalized = code?.trim().toUpperCase() ?? "";
  if (normalized === "RATE_LIMITED") return "rate_limited";
  return productProfileSynthesisFailureKind({
    // A request carries no run status; only the code is meaningful here.
    status: null,
    lastError: normalized === "" ? null : { code: normalized, summary: "" },
  });
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
