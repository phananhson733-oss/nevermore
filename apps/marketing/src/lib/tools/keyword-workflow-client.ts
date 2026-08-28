// @input  -- unknown async API bodies plus a tab-scoped sessionStorage pointer
// @output -- validated recovery state, exact protocol outcomes, and bounded poll timing
// @pos    -- browser-only contract for the durable keyword run; never a server authority
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type {
  KeywordOpportunityContextSelection,
  KeywordOpportunityProposition,
  KeywordOpportunityResult,
} from "@sf/public-tools/keyword-opportunity";

export const KEYWORD_WORKFLOW_POINTER_VERSION =
  "keyword_workflow_pointer.v1" as const;
export const KEYWORD_WORKFLOW_API_VERSION = "keyword_workflow.v1" as const;
export const KEYWORD_WORKFLOW_STORAGE_KEY =
  "gengrowth.keyword-workflow.pointer.v1";
export const KEYWORD_WORKFLOW_POINTER_TTL_MS = 24 * 60 * 60 * 1_000;

const MAX_TOKEN_LENGTH = 22_528;
const MAX_RUN_TOKEN_LENGTH = 8_192;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface KeywordWorkflowContextState {
  readonly token: string;
  readonly propositions: readonly KeywordOpportunityProposition[];
  readonly pagesFetched: number;
  readonly productPagesFetched: number;
  readonly selection?: KeywordOpportunityContextSelection;
  readonly contextSufficient: boolean;
}

export interface KeywordWorkflowPointerV1 {
  readonly version: typeof KEYWORD_WORKFLOW_POINTER_VERSION;
  readonly requestId: string;
  readonly property: string;
  readonly siteUrl: string;
  readonly marketCode: string;
  readonly languageCode: string;
  readonly seedInput: string;
  readonly context: KeywordWorkflowContextState;
  readonly createdAt: number;
  readonly runToken: string | null;
}

export interface KeywordWorkflowStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface KeywordWorkflowPointerBinding {
  readonly properties: readonly string[];
  readonly markets: readonly string[];
}

type StartOutcome =
  | { readonly kind: "completed"; readonly result: KeywordOpportunityResult }
  | { readonly kind: "accepted"; readonly runToken: string }
  | { readonly kind: "error"; readonly code: string }
  | { readonly kind: "invalid" };

type StatusOutcome =
  | {
      readonly kind: "tracking";
      readonly status: "queued" | "running";
      readonly runToken: string;
    }
  | { readonly kind: "redirect"; readonly runToken: string }
  | { readonly kind: "completed"; readonly result: KeywordOpportunityResult }
  | { readonly kind: "error"; readonly code: string }
  | { readonly kind: "invalid" };

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function selection(
  value: unknown,
): KeywordOpportunityContextSelection | undefined | null {
  if (value === undefined) return undefined;
  const input = record(value);
  if (input === null) return null;
  const fields = [
    input["eligibleCandidates"],
    input["excludedCandidates"],
    input["attemptedCandidates"],
    input["truncatedCandidates"],
  ];
  return fields.every(finiteNonNegative)
    ? {
        eligibleCandidates: fields[0] as number,
        excludedCandidates: fields[1] as number,
        attemptedCandidates: fields[2] as number,
        truncatedCandidates: fields[3] as number,
      }
    : null;
}

function contextState(value: unknown): KeywordWorkflowContextState | null {
  const input = record(value);
  if (input === null) return null;
  const token = input["token"];
  const propositions = input["propositions"];
  const parsedSelection = selection(input["selection"]);
  if (
    typeof token !== "string" ||
    token === "" ||
    token.length > MAX_TOKEN_LENGTH ||
    !Array.isArray(propositions) ||
    !propositions.every((proposition) => {
      const item = record(proposition);
      return (
        typeof item?.["statement"] === "string" &&
        typeof item["sourceUrl"] === "string"
      );
    }) ||
    !finiteNonNegative(input["pagesFetched"]) ||
    !finiteNonNegative(input["productPagesFetched"]) ||
    typeof input["contextSufficient"] !== "boolean" ||
    parsedSelection === null
  ) {
    return null;
  }
  return {
    token,
    propositions: propositions as unknown as readonly KeywordOpportunityProposition[],
    pagesFetched: input["pagesFetched"],
    productPagesFetched: input["productPagesFetched"],
    ...(parsedSelection === undefined ? {} : { selection: parsedSelection }),
    contextSufficient: input["contextSufficient"],
  };
}

function parsePointer(
  value: unknown,
  binding: KeywordWorkflowPointerBinding,
  now: number,
): KeywordWorkflowPointerV1 | null {
  const input = record(value);
  if (input === null) return null;
  const context = contextState(input["context"]);
  const createdAt = input["createdAt"];
  const runToken = input["runToken"];
  if (
    input["version"] !== KEYWORD_WORKFLOW_POINTER_VERSION ||
    typeof input["requestId"] !== "string" ||
    !UUID_PATTERN.test(input["requestId"]) ||
    typeof input["property"] !== "string" ||
    !binding.properties.includes(input["property"]) ||
    typeof input["siteUrl"] !== "string" ||
    input["siteUrl"] === "" ||
    typeof input["marketCode"] !== "string" ||
    !binding.markets.includes(input["marketCode"]) ||
    typeof input["languageCode"] !== "string" ||
    input["languageCode"] === "" ||
    typeof input["seedInput"] !== "string" ||
    context === null ||
    !finiteNonNegative(createdAt) ||
    createdAt > now + MAX_CLOCK_SKEW_MS ||
    now - createdAt > KEYWORD_WORKFLOW_POINTER_TTL_MS ||
    !(
      runToken === null ||
      (typeof runToken === "string" &&
        runToken !== "" &&
        runToken.length <= MAX_RUN_TOKEN_LENGTH)
    )
  ) {
    return null;
  }
  return {
    version: KEYWORD_WORKFLOW_POINTER_VERSION,
    requestId: input["requestId"],
    property: input["property"],
    siteUrl: input["siteUrl"],
    marketCode: input["marketCode"],
    languageCode: input["languageCode"],
    seedInput: input["seedInput"],
    context,
    createdAt,
    runToken,
  };
}

export function readKeywordWorkflowPointer(
  storage: KeywordWorkflowStorage,
  binding: KeywordWorkflowPointerBinding,
  now: () => number = Date.now,
): KeywordWorkflowPointerV1 | null {
  try {
    const raw = storage.getItem(KEYWORD_WORKFLOW_STORAGE_KEY);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      storage.removeItem(KEYWORD_WORKFLOW_STORAGE_KEY);
      return null;
    }
    const pointer = parsePointer(parsed, binding, now());
    if (pointer === null) storage.removeItem(KEYWORD_WORKFLOW_STORAGE_KEY);
    return pointer;
  } catch {
    return null;
  }
}

export function writeKeywordWorkflowPointer(
  storage: KeywordWorkflowStorage,
  pointer: KeywordWorkflowPointerV1,
): boolean {
  try {
    storage.setItem(KEYWORD_WORKFLOW_STORAGE_KEY, JSON.stringify(pointer));
    return true;
  } catch {
    return false;
  }
}

export function clearKeywordWorkflowPointer(
  storage: KeywordWorkflowStorage,
): boolean {
  try {
    storage.removeItem(KEYWORD_WORKFLOW_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

type NewPointerInput = Omit<
  KeywordWorkflowPointerV1,
  "version" | "requestId" | "createdAt" | "runToken"
>;

export function keywordWorkflowPointerForContext(
  current: KeywordWorkflowPointerV1 | null,
  input: NewPointerInput,
  now: () => number = Date.now,
  randomUuid: () => string = () => crypto.randomUUID(),
): KeywordWorkflowPointerV1 {
  const sameAttempt =
    current !== null &&
    current.runToken === null &&
    current.property === input.property &&
    current.siteUrl === input.siteUrl &&
    current.marketCode === input.marketCode &&
    current.languageCode === input.languageCode &&
    current.seedInput === input.seedInput &&
    current.context.token === input.context.token &&
    now() - current.createdAt <= KEYWORD_WORKFLOW_POINTER_TTL_MS;
  if (sameAttempt) return current;

  const requestId = randomUuid().toLowerCase();
  if (!UUID_PATTERN.test(requestId)) {
    throw new Error("keyword Workflow request id is not a UUID");
  }
  return {
    version: KEYWORD_WORKFLOW_POINTER_VERSION,
    requestId,
    ...input,
    createdAt: now(),
    runToken: null,
  };
}

function errorCode(value: unknown): string | null {
  const root = record(value);
  const error = record(root?.["error"]);
  return typeof error?.["code"] === "string" && error["code"] !== ""
    ? error["code"]
    : null;
}

function resultOf(value: unknown): KeywordOpportunityResult | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as KeywordOpportunityResult)
    : null;
}

export function normalizeKeywordWorkflowStartResponse(
  status: number,
  value: unknown,
): StartOutcome {
  const root = record(value);
  const data = record(root?.["data"]);
  const result = resultOf(data?.["result"]);
  if (status === 200 && result !== null) return { kind: "completed", result };
  if (
    status === 202 &&
    data?.["status"] === "running" &&
    typeof data["runToken"] === "string" &&
    data["runToken"] !== ""
  ) {
    return { kind: "accepted", runToken: data["runToken"] };
  }
  const code = errorCode(value);
  return status >= 400 && code !== null
    ? { kind: "error", code }
    : { kind: "invalid" };
}

export function normalizeKeywordWorkflowStatusResponse(
  status: number,
  value: unknown,
): StatusOutcome {
  const root = record(value);
  const data = record(root?.["data"]);
  const runToken = data?.["runToken"];
  if (
    status === 200 &&
    (data?.["status"] === "queued" || data?.["status"] === "running") &&
    typeof runToken === "string" &&
    runToken !== ""
  ) {
    return {
      kind: "tracking",
      status: data["status"],
      runToken,
    };
  }
  if (
    status === 200 &&
    data?.["status"] === "redirect" &&
    typeof runToken === "string" &&
    runToken !== ""
  ) {
    return { kind: "redirect", runToken };
  }
  const result = resultOf(data?.["result"]);
  if (status === 200 && data?.["status"] === "completed" && result !== null) {
    return { kind: "completed", result };
  }
  const code = errorCode(value);
  return status >= 400 && code !== null
    ? { kind: "error", code }
    : { kind: "invalid" };
}

export function keywordWorkflowPollDelayMs(
  retryAfter: string | null,
): number {
  const seconds = retryAfter === null ? Number.NaN : Number.parseInt(retryAfter, 10);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(5_000, seconds * 1_000)
    : 2_000;
}
