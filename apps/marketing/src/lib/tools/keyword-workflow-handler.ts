// @input  -- same-origin authenticated start/status POSTs and Vercel Workflow run state
// @output -- private sealed run pointers, stable polling states, a public result, or bounded errors
// @pos    -- HTTP trust boundary between the Marketing keyword client and durable Workflow runtime
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  KEYWORD_OPPORTUNITY_ERROR_CODES,
  type KeywordOpportunityErrorCode,
  type KeywordOpportunityResult,
} from "@sf/public-tools/keyword-opportunity";
import { createPublicToolError } from "@sf/public-tools/contract";
import type { GrantResolution } from "../auth/grant-cookie.ts";
import { identitySubFrom } from "../auth/grant-cookie.ts";
import { open } from "../auth/sealed-cookie.ts";
import type { KeywordContextToken } from "./keyword-opportunity-handler.ts";
import { OPPORTUNITIES_BODY_LIMIT_BYTES } from "./keyword-opportunity-handler.ts";
import type {
  KeywordOpportunityWorkflowInput,
  KeywordOpportunityWorkflowOutput,
} from "./keyword-opportunity-workflow.ts";
import {
  isSameOriginKeywordWorkflowRequest,
  keywordWorkflowDedupeKey,
  keywordWorkflowJson,
  openKeywordWorkflowRun,
  parseKeywordWorkflowStartInput,
  parseKeywordWorkflowStatusInput,
  sealKeywordWorkflowGrant,
  sealKeywordWorkflowInput,
  sealKeywordWorkflowRun,
} from "./keyword-workflow-contract.ts";
import type { GscGateResult } from "./gsc-gate.ts";
import { refuseWithoutGrant } from "./gsc-gate.ts";
import { readPublicToolJson } from "./public-tool-request.ts";

export interface KeywordWorkflowStartDependencies {
  readonly readIdentity: () => Promise<{ readonly sub: string } | null>;
  readonly openGscGate: (clientIp: string) => Promise<GscGateResult>;
  readonly resolveGrant: () => Promise<GrantResolution>;
  readonly startWorkflow: (
    input: KeywordOpportunityWorkflowInput,
  ) => Promise<{ readonly runId: string }>;
  readonly extractClientIp: (headers: Headers) => string;
  readonly now: () => number;
}

export type KeywordWorkflowRunRead =
  | { readonly kind: "missing" }
  | { readonly kind: "queued" }
  | { readonly kind: "running" }
  | {
      readonly kind: "completed";
      readonly result: KeywordOpportunityResult;
    }
  | { readonly kind: "redirect"; readonly ownerRunId: string }
  | {
      readonly kind: "typed_failure";
      readonly code: KeywordOpportunityErrorCode;
    }
  | { readonly kind: "failed" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "unavailable" };

export interface KeywordWorkflowStatusDependencies {
  readonly readIdentity: () => Promise<{ readonly sub: string } | null>;
  readonly readRun: (runId: string) => Promise<KeywordWorkflowRunRead>;
  readonly now: () => number;
}

const WORKFLOW_ERROR_STATUS: Partial<
  Readonly<Record<KeywordOpportunityErrorCode, number>>
> = {
  invalid_input: 400,
  invalid_request: 400,
  context_token_invalid: 400,
  authentication_required: 401,
  property_not_verified: 403,
  rate_limited: 429,
  scan_in_progress: 409,
  target_busy: 409,
  quota_unavailable: 503,
  gsc_revoked: 401,
  gsc_temporarily_unavailable: 503,
  keyword_generation_unavailable: 502,
  keyword_source_unavailable: 502,
  keyword_run_unavailable: 503,
  keyword_run_cancelled: 409,
};

function workflowError(
  code: KeywordOpportunityErrorCode,
  status = WORKFLOW_ERROR_STATUS[code] ?? 502,
  retryAfterSeconds?: number,
): Response {
  return keywordWorkflowJson(
    createPublicToolError(code),
    status,
    retryAfterSeconds,
  );
}

function unavailableRun(status = 404): Response {
  return workflowError("keyword_run_unavailable", status);
}

function isKeywordContextToken(value: unknown): value is KeywordContextToken {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const token = value as Partial<KeywordContextToken>;
  return (
    typeof token.siteUrl === "string" &&
    token.siteUrl !== "" &&
    typeof token.marketCode === "string" &&
    token.marketCode !== "" &&
    typeof token.languageCode === "string" &&
    token.languageCode !== "" &&
    typeof token.sub === "string" &&
    token.sub !== "" &&
    Array.isArray(token.propositions) &&
    Array.isArray(token.pages) &&
    Array.isArray(token.seeds)
  );
}

async function readJsonBody(request: Request): Promise<
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: Response }
> {
  const body = await readPublicToolJson(
    request,
    OPPORTUNITIES_BODY_LIMIT_BYTES,
  );
  if (body.ok) return body;
  return {
    ok: false,
    response: workflowError(
      body.code,
      body.code === "payload_too_large" ? 413 : 400,
    ),
  };
}

export async function handleKeywordWorkflowStartRequest(
  request: Request,
  dependencies: KeywordWorkflowStartDependencies,
): Promise<Response> {
  if (!isSameOriginKeywordWorkflowRequest(request)) {
    return workflowError("invalid_request", 403);
  }
  const identity = await dependencies.readIdentity();
  if (identity === null) return workflowError("authentication_required", 401);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = parseKeywordWorkflowStartInput(body.value);
  if (input === null) return workflowError("invalid_input", 400);

  let context: KeywordContextToken | null = null;
  try {
    const opened = open<KeywordContextToken>(
      "gg_kw_context",
      input.contextToken,
      dependencies.now,
    );
    context = isKeywordContextToken(opened) ? opened : null;
  } catch {
    return workflowError("keyword_run_unavailable", 503, 10);
  }
  if (context === null || context.sub !== identity.sub) {
    return workflowError("context_token_invalid", 400);
  }

  const gate = await dependencies.openGscGate(
    dependencies.extractClientIp(request.headers),
  );
  if (!gate.ok) return gate.response;

  try {
    const grant = await dependencies.resolveGrant();
    if (grant.kind !== "grant") return refuseWithoutGrant(grant);

    const workflowInput: KeywordOpportunityWorkflowInput = {
      inputToken: sealKeywordWorkflowInput(
        { sub: identity.sub, data: context },
        dependencies.now,
      ),
      grantToken: sealKeywordWorkflowGrant(
        {
          sub: identity.sub,
          data: {
            accessToken: grant.accessToken,
            properties: grant.properties,
          },
        },
        dependencies.now,
      ),
      dedupeKey: keywordWorkflowDedupeKey(identity.sub, input.requestId),
    };
    const run = await dependencies.startWorkflow(workflowInput);
    const runToken = sealKeywordWorkflowRun(
      { runId: run.runId, sub: identity.sub },
      dependencies.now,
    );
    return keywordWorkflowJson(
      { data: { status: "running", runToken } },
      202,
      2,
    );
  } catch {
    console.error(
      JSON.stringify({
        tool: "keyword_opportunity",
        stage: "workflow_start",
        reason: "start_unavailable",
      }),
    );
    return workflowError("keyword_run_unavailable", 503, 10);
  } finally {
    gate.release();
  }
}

export async function handleKeywordWorkflowStatusRequest(
  request: Request,
  dependencies: KeywordWorkflowStatusDependencies,
): Promise<Response> {
  if (!isSameOriginKeywordWorkflowRequest(request)) {
    return workflowError("invalid_request", 403);
  }
  const identity = await dependencies.readIdentity();
  if (identity === null) return workflowError("authentication_required", 401);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = parseKeywordWorkflowStatusInput(body.value);
  if (input === null) return unavailableRun();

  let run: { readonly runId: string } | null = null;
  try {
    run = openKeywordWorkflowRun(
      input.runToken,
      identity.sub,
      dependencies.now,
    );
  } catch {
    return unavailableRun();
  }
  if (run === null) return unavailableRun();

  let read: KeywordWorkflowRunRead;
  try {
    read = await dependencies.readRun(run.runId);
  } catch {
    return workflowError("keyword_run_unavailable", 503, 10);
  }
  switch (read.kind) {
    case "missing":
      return unavailableRun();
    case "queued":
    case "running":
      return keywordWorkflowJson(
        { data: { status: read.kind, runToken: input.runToken } },
        200,
        2,
      );
    case "completed":
      return keywordWorkflowJson(
        { data: { status: "completed", result: read.result } },
        200,
      );
    case "redirect": {
      const runToken = sealKeywordWorkflowRun(
        { runId: read.ownerRunId, sub: identity.sub },
        dependencies.now,
      );
      return keywordWorkflowJson(
        { data: { status: "redirect", runToken } },
        200,
      );
    }
    case "typed_failure":
      return workflowError(read.code);
    case "failed":
      return workflowError("keyword_run_unavailable", 502);
    case "cancelled":
      return workflowError("keyword_run_cancelled", 409);
    case "unavailable":
      return workflowError("keyword_run_unavailable", 503, 10);
  }
}

function isWorkflowOutput(
  value: unknown,
): value is KeywordOpportunityWorkflowOutput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const output = value as Readonly<Record<string, unknown>>;
  if (output["kind"] === "redirect") {
    return typeof output["ownerRunId"] === "string" && output["ownerRunId"] !== "";
  }
  if (output["kind"] === "failed") {
    return (KEYWORD_OPPORTUNITY_ERROR_CODES as readonly unknown[]).includes(
      output["code"],
    );
  }
  if (output["kind"] !== "completed") return false;
  const payload = output["payload"];
  return typeof payload === "object" && payload !== null && "result" in payload;
}

export async function readKeywordWorkflowRun(
  runId: string,
): Promise<KeywordWorkflowRunRead> {
  try {
    const { getRun } = await import("workflow/api");
    const run = getRun<KeywordOpportunityWorkflowOutput>(runId);
    if (!(await run.exists)) return { kind: "missing" };
    const status = await run.status;
    if (status === "pending") return { kind: "queued" };
    if (status === "running") return { kind: "running" };
    if (status === "cancelled") return { kind: "cancelled" };
    if (status === "failed") return { kind: "failed" };

    const output = await run.returnValue;
    if (!isWorkflowOutput(output)) return { kind: "unavailable" };
    if (output.kind === "completed") {
      return { kind: "completed", result: output.payload.result };
    }
    if (output.kind === "redirect") {
      return { kind: "redirect", ownerRunId: output.ownerRunId };
    }
    return { kind: "typed_failure", code: output.code };
  } catch (error) {
    const errors = await import("workflow/internal/errors");
    if (errors.WorkflowRunNotFoundError.is(error)) return { kind: "missing" };
    if (errors.WorkflowRunCancelledError.is(error)) {
      return { kind: "cancelled" };
    }
    if (errors.WorkflowRunFailedError.is(error)) return { kind: "failed" };
    return { kind: "unavailable" };
  }
}

export async function readKeywordIdentity(): Promise<{
  readonly sub: string;
} | null> {
  const { cookies } = await import("next/headers");
  const sub = identitySubFrom((await cookies()).get("gg_id")?.value);
  return sub === null ? null : { sub };
}
