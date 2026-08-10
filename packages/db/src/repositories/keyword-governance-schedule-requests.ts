import { sql } from "drizzle-orm";
import { canonicalUtcTimestamptz } from "../instant.ts";
import type { ProjectScope } from "./base.ts";
import { Repository } from "./base.ts";

export const KEYWORD_GOVERNANCE_SCHEDULE_REQUEST_SOURCE_KINDS = [
  "analysis_refresh",
  "csv_keyword_gap_import",
  "topic_model_confirmation_system",
  "topic_model_confirmation_manual",
  "generation_continuation",
] as const;

export type KeywordGovernanceScheduleRequestSourceKind =
  (typeof KEYWORD_GOVERNANCE_SCHEDULE_REQUEST_SOURCE_KINDS)[number];

export const KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED =
  "KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED" as const;
export type KeywordGovernanceScheduleRequestErrorCode =
  typeof KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED;

export interface KeywordGovernanceScheduleRequest {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly dispatchKey: string;
  readonly sourceKind: KeywordGovernanceScheduleRequestSourceKind;
  readonly sourceRef: string;
  readonly initiatedBy: string;
  readonly requestedAt: string;
  readonly nextAttemptAt: string;
  readonly claimToken: string | null;
  readonly claimedAt: string | null;
  readonly claimExpiresAt: string | null;
  readonly attemptCount: number;
  readonly completedAt: string | null;
  readonly lastErrorCode: KeywordGovernanceScheduleRequestErrorCode | null;
}

export type ClaimedKeywordGovernanceScheduleRequest = Omit<
  KeywordGovernanceScheduleRequest,
  "claimToken" | "claimedAt" | "claimExpiresAt" | "completedAt"
> & {
  readonly claimToken: string;
  readonly claimedAt: string;
  readonly claimExpiresAt: string;
  readonly completedAt: null;
};

export interface InsertKeywordGovernanceScheduleRequestInput {
  readonly sourceKind: KeywordGovernanceScheduleRequestSourceKind;
  readonly sourceRef: string;
  readonly initiatedBy: string;
}

export interface ClaimKeywordGovernanceScheduleRequestInput {
  readonly requestId: string;
  readonly leaseSeconds: number;
}

export interface ClaimKeywordGovernanceScheduleRequestBySourceInput {
  readonly sourceKind: KeywordGovernanceScheduleRequestSourceKind;
  readonly sourceRef: string;
  readonly leaseSeconds: number;
}

export interface ClaimDueKeywordGovernanceScheduleRequestsInput {
  readonly limit: number;
  readonly leaseSeconds: number;
}

export interface SettleKeywordGovernanceScheduleRequestInput {
  readonly requestId: string;
  readonly claimToken: string;
}

export interface ReleaseKeywordGovernanceScheduleRequestInput
  extends SettleKeywordGovernanceScheduleRequestInput {
  readonly errorCode: KeywordGovernanceScheduleRequestErrorCode;
}

export type InsertKeywordGovernanceScheduleRequestResult = {
  readonly kind: "inserted" | "existing";
  readonly request: KeywordGovernanceScheduleRequest;
};

export type ClaimKeywordGovernanceScheduleRequestResult =
  | {
      readonly kind: "claimed";
      readonly request: ClaimedKeywordGovernanceScheduleRequest;
    }
  | { readonly kind: "unavailable" };

export type CompleteKeywordGovernanceScheduleRequestResult =
  | {
      readonly kind: "completed";
      readonly request: KeywordGovernanceScheduleRequest;
    }
  | { readonly kind: "stale" };

export type ReleaseKeywordGovernanceScheduleRequestResult =
  | {
      readonly kind: "released";
      readonly request: KeywordGovernanceScheduleRequest;
    }
  | { readonly kind: "stale" };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SOURCE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$/u;
const SOURCE_KINDS = new Set<KeywordGovernanceScheduleRequestSourceKind>(
  KEYWORD_GOVERNANCE_SCHEDULE_REQUEST_SOURCE_KINDS,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSourceKind(
  value: unknown,
): value is KeywordGovernanceScheduleRequestSourceKind {
  return (
    typeof value === "string" &&
    SOURCE_KINDS.has(value as KeywordGovernanceScheduleRequestSourceKind)
  );
}

function requireUuid(value: string, label: string): void {
  if (!UUID.test(value)) throw new RangeError(`${label} must be a UUID`);
}

function requireScope(scope: ProjectScope): void {
  requireUuid(scope.workspaceId, "scope.workspaceId");
  requireUuid(scope.projectId, "scope.projectId");
}

function requireSource(
  sourceKind: KeywordGovernanceScheduleRequestSourceKind,
  sourceRef: string,
): void {
  if (!validSourceKind(sourceKind)) {
    throw new RangeError("sourceKind is not supported");
  }
  if (!SOURCE_REF.test(sourceRef)) {
    throw new RangeError("sourceRef must be a safe 1..500 character key");
  }
}

function requireLeaseSeconds(value: number): void {
  if (!Number.isSafeInteger(value) || value < 5 || value > 300) {
    throw new RangeError("leaseSeconds must be an integer from 5 through 300");
  }
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return canonicalUtcTimestamptz(value);
  } catch {
    return null;
  }
}

function nullableTimestamp(value: unknown): string | null | undefined {
  return value === null ? null : timestamp(value) ?? undefined;
}

function parseRequest(value: unknown): KeywordGovernanceScheduleRequest | null {
  if (!isRecord(value)) return null;
  const id = value["id"];
  const workspaceId = value["workspace_id"];
  const projectId = value["project_id"];
  const dispatchKey = value["dispatch_key"];
  const sourceKind = value["source_kind"];
  const sourceRef = value["source_ref"];
  const initiatedBy = value["initiated_by"];
  const requestedAt = timestamp(value["requested_at"]);
  const nextAttemptAt = timestamp(value["next_attempt_at"]);
  const claimToken = value["claim_token"];
  const claimedAt = nullableTimestamp(value["claimed_at"]);
  const claimExpiresAt = nullableTimestamp(value["claim_expires_at"]);
  const attemptCount = value["attempt_count"];
  const completedAt = nullableTimestamp(value["completed_at"]);
  const lastErrorCode = value["last_error_code"];
  if (
    typeof id !== "string" ||
    !UUID.test(id) ||
    typeof workspaceId !== "string" ||
    !UUID.test(workspaceId) ||
    typeof projectId !== "string" ||
    !UUID.test(projectId) ||
    !validSourceKind(sourceKind) ||
    typeof sourceRef !== "string" ||
    !SOURCE_REF.test(sourceRef) ||
    typeof initiatedBy !== "string" ||
    !UUID.test(initiatedBy) ||
    typeof dispatchKey !== "string" ||
    dispatchKey !==
      `keyword-governance-schedule.v1:${workspaceId}:${projectId}:${sourceKind}:${sourceRef}` ||
    requestedAt === null ||
    nextAttemptAt === null ||
    claimedAt === undefined ||
    claimExpiresAt === undefined ||
    completedAt === undefined ||
    !Number.isSafeInteger(attemptCount) ||
    Number(attemptCount) < 0 ||
    Number(attemptCount) > 2_147_483_647 ||
    (claimToken !== null &&
      (typeof claimToken !== "string" || !UUID.test(claimToken))) ||
    (lastErrorCode !== null &&
      lastErrorCode !== KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED)
  ) {
    return null;
  }
  const hasToken = claimToken !== null;
  const hasClaimedAt = claimedAt !== null;
  const hasClaimExpiresAt = claimExpiresAt !== null;
  if (
    hasToken !== hasClaimedAt ||
    hasToken !== hasClaimExpiresAt ||
    (hasToken && lastErrorCode !== null) ||
    (completedAt !== null && (!hasToken || lastErrorCode !== null))
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    projectId,
    dispatchKey,
    sourceKind,
    sourceRef,
    initiatedBy,
    requestedAt,
    nextAttemptAt,
    claimToken,
    claimedAt,
    claimExpiresAt,
    attemptCount: Number(attemptCount),
    completedAt,
    lastErrorCode,
  };
}

function parseClaimedRequest(
  value: unknown,
): ClaimedKeywordGovernanceScheduleRequest | null {
  const request = parseRequest(value);
  return request?.completedAt === null &&
      request.claimToken !== null &&
      request.claimedAt !== null &&
      request.claimExpiresAt !== null
    ? (request as ClaimedKeywordGovernanceScheduleRequest)
    : null;
}

function firstResult(raw: unknown): unknown {
  if (!isRecord(raw) || !Array.isArray(raw["rows"])) {
    throw new Error("invalid Keyword governance schedule database response");
  }
  const first = raw["rows"][0];
  if (!isRecord(first) || !("result" in first)) {
    throw new Error("missing Keyword governance schedule database result");
  }
  return first["result"];
}

function requireRequestScope(
  request: KeywordGovernanceScheduleRequest,
  scope: ProjectScope,
): void {
  if (
    request.workspaceId !== scope.workspaceId ||
    request.projectId !== scope.projectId
  ) {
    throw new Error("invalid Keyword governance schedule request scope");
  }
}

function parseClaimResult(
  value: unknown,
  scope: ProjectScope,
): ClaimKeywordGovernanceScheduleRequestResult {
  if (!isRecord(value)) {
    throw new Error("invalid Keyword governance schedule claim result");
  }
  if (value["kind"] === "unavailable") return { kind: "unavailable" };
  if (value["kind"] === "claimed") {
    const request = parseClaimedRequest(value["request"]);
    if (request) {
      requireRequestScope(request, scope);
      return { kind: "claimed", request };
    }
  }
  throw new Error("invalid claimed Keyword governance schedule request");
}

export class KeywordGovernanceScheduleRequestsRepository extends Repository {
  async insertRequest(
    scope: ProjectScope,
    input: InsertKeywordGovernanceScheduleRequestInput,
  ): Promise<InsertKeywordGovernanceScheduleRequestResult> {
    requireScope(scope);
    requireSource(input.sourceKind, input.sourceRef);
    requireUuid(input.initiatedBy, "initiatedBy");
    const raw = await this.exec.execute(sql`
      SELECT app.insert_keyword_governance_schedule_request(
        ${scope.workspaceId}::uuid,
        ${scope.projectId}::uuid,
        ${input.sourceKind}::text,
        ${input.sourceRef}::text,
        ${input.initiatedBy}::uuid
      ) AS result
    `);
    const result = firstResult(raw);
    if (
      !isRecord(result) ||
      (result["kind"] !== "inserted" && result["kind"] !== "existing")
    ) {
      throw new Error("invalid Keyword governance schedule insert result");
    }
    const request = parseRequest(result["request"]);
    if (
      !request ||
      request.sourceKind !== input.sourceKind ||
      request.sourceRef !== input.sourceRef ||
      request.initiatedBy !== input.initiatedBy
    ) {
      throw new Error("invalid Keyword governance schedule request");
    }
    requireRequestScope(request, scope);
    return { kind: result["kind"], request };
  }

  async claimRequest(
    scope: ProjectScope,
    input: ClaimKeywordGovernanceScheduleRequestInput,
  ): Promise<ClaimKeywordGovernanceScheduleRequestResult> {
    requireScope(scope);
    requireUuid(input.requestId, "requestId");
    requireLeaseSeconds(input.leaseSeconds);
    const raw = await this.exec.execute(sql`
      SELECT app.claim_keyword_governance_schedule_request(
        ${scope.workspaceId}::uuid,
        ${scope.projectId}::uuid,
        ${input.requestId}::uuid,
        ${input.leaseSeconds}::integer
      ) AS result
    `);
    const result = parseClaimResult(firstResult(raw), scope);
    if (result.kind === "claimed" && result.request.id !== input.requestId) {
      throw new Error("invalid claimed Keyword governance schedule request");
    }
    return result;
  }

  async claimBySource(
    scope: ProjectScope,
    input: ClaimKeywordGovernanceScheduleRequestBySourceInput,
  ): Promise<ClaimKeywordGovernanceScheduleRequestResult> {
    requireScope(scope);
    requireSource(input.sourceKind, input.sourceRef);
    requireLeaseSeconds(input.leaseSeconds);
    const raw = await this.exec.execute(sql`
      SELECT app.claim_keyword_governance_schedule_request_by_source(
        ${scope.workspaceId}::uuid,
        ${scope.projectId}::uuid,
        ${input.sourceKind}::text,
        ${input.sourceRef}::text,
        ${input.leaseSeconds}::integer
      ) AS result
    `);
    const result = parseClaimResult(firstResult(raw), scope);
    if (
      result.kind === "claimed" &&
      (result.request.sourceKind !== input.sourceKind ||
        result.request.sourceRef !== input.sourceRef)
    ) {
      throw new Error("invalid claimed Keyword governance schedule request");
    }
    return result;
  }

  async claimDue(
    input: ClaimDueKeywordGovernanceScheduleRequestsInput,
  ): Promise<readonly ClaimedKeywordGovernanceScheduleRequest[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new RangeError("limit must be an integer from 1 through 100");
    }
    requireLeaseSeconds(input.leaseSeconds);
    const raw = await this.exec.execute(sql`
      SELECT app.claim_due_keyword_governance_schedule_requests(
        ${input.limit}::integer,
        ${input.leaseSeconds}::integer
      ) AS result
    `);
    const result = firstResult(raw);
    if (!Array.isArray(result) || result.length > input.limit) {
      throw new Error("invalid Keyword governance schedule due claim result");
    }
    const requests = result.map(parseClaimedRequest);
    if (requests.some((request) => request === null)) {
      throw new Error("invalid claimed Keyword governance schedule request");
    }
    const claimed = requests as ClaimedKeywordGovernanceScheduleRequest[];
    if (new Set(claimed.map((request) => request.id)).size !== claimed.length) {
      throw new Error("duplicate Keyword governance schedule due claim");
    }
    return claimed;
  }

  async complete(
    scope: ProjectScope,
    input: SettleKeywordGovernanceScheduleRequestInput,
  ): Promise<CompleteKeywordGovernanceScheduleRequestResult> {
    requireScope(scope);
    requireUuid(input.requestId, "requestId");
    requireUuid(input.claimToken, "claimToken");
    const raw = await this.exec.execute(sql`
      SELECT app.complete_keyword_governance_schedule_request(
        ${scope.workspaceId}::uuid,
        ${scope.projectId}::uuid,
        ${input.requestId}::uuid,
        ${input.claimToken}::uuid
      ) AS result
    `);
    const result = firstResult(raw);
    if (!isRecord(result)) {
      throw new Error("invalid Keyword governance schedule completion result");
    }
    if (result["kind"] === "stale") return { kind: "stale" };
    if (result["kind"] === "completed") {
      const request = parseRequest(result["request"]);
      if (
        request?.id === input.requestId &&
        request.claimToken === input.claimToken &&
        request.completedAt !== null
      ) {
        requireRequestScope(request, scope);
        return { kind: "completed", request };
      }
    }
    throw new Error("invalid Keyword governance schedule completion result");
  }

  async release(
    scope: ProjectScope,
    input: ReleaseKeywordGovernanceScheduleRequestInput,
  ): Promise<ReleaseKeywordGovernanceScheduleRequestResult> {
    requireScope(scope);
    requireUuid(input.requestId, "requestId");
    requireUuid(input.claimToken, "claimToken");
    if (input.errorCode !== KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED) {
      throw new RangeError("errorCode must be the fixed safe dispatch code");
    }
    const raw = await this.exec.execute(sql`
      SELECT app.release_keyword_governance_schedule_request(
        ${scope.workspaceId}::uuid,
        ${scope.projectId}::uuid,
        ${input.requestId}::uuid,
        ${input.claimToken}::uuid,
        ${input.errorCode}::text
      ) AS result
    `);
    const result = firstResult(raw);
    if (!isRecord(result)) {
      throw new Error("invalid Keyword governance schedule release result");
    }
    if (result["kind"] === "stale") return { kind: "stale" };
    if (result["kind"] === "released") {
      const request = parseRequest(result["request"]);
      if (
        request?.id === input.requestId &&
        request.claimToken === null &&
        request.completedAt === null &&
        request.lastErrorCode === input.errorCode
      ) {
        requireRequestScope(request, scope);
        return { kind: "released", request };
      }
    }
    throw new Error("invalid Keyword governance schedule release result");
  }
}
