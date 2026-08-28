// @input  -- unknown start/status bodies plus workflow-owned sealed snapshots
// @output -- exact async contracts, private responses, dedupe keys, and caller-bound run tokens
// @pos    -- trust boundary shared by keyword Workflow routes, steps, and client parsing
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createHash } from "node:crypto";

import type { KeywordOpportunityResult } from "@sf/public-tools";
import { open, seal } from "../auth/sealed-cookie.ts";

export const KEYWORD_WORKFLOW_VERSION = "keyword_workflow.v1";
export const KEYWORD_WORKFLOW_TTL_SECONDS = 24 * 60 * 60;

const MAX_CONTEXT_TOKEN_LENGTH = 22_528;
const MAX_RUN_TOKEN_LENGTH = 8_192;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface KeywordWorkflowStartInput {
  readonly contextToken: string;
  readonly requestId: string;
}

export interface KeywordWorkflowStatusInput {
  readonly runToken: string;
}

export interface KeywordWorkflowStartResponse {
  readonly data: {
    readonly status: "running";
    readonly runToken: string;
  };
}

export type KeywordWorkflowStatusResponse =
  | {
      readonly data: {
        readonly status: "queued" | "running";
        readonly runToken: string;
      };
    }
  | {
      readonly data: {
        readonly status: "redirect";
        readonly runToken: string;
      };
    }
  | {
      readonly data: {
        readonly status: "completed";
        readonly result: KeywordOpportunityResult;
      };
    };

export interface KeywordWorkflowGrantSnapshot {
  readonly accessToken: string;
  readonly properties: readonly string[];
}

interface VersionedOwnedSnapshot<T> {
  readonly version: typeof KEYWORD_WORKFLOW_VERSION;
  readonly sub: string;
  readonly data: T;
}

interface OwnedWorkflowSnapshot<T> {
  readonly sub: string;
  readonly data: T;
}

interface KeywordWorkflowRunSnapshot {
  readonly version: typeof KEYWORD_WORKFLOW_VERSION;
  readonly runId: string;
  readonly sub: string;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const present = Object.keys(record).sort();
  const expected = [...keys].sort();
  return present.length === expected.length &&
    present.every((key, index) => key === expected[index])
    ? record
    : null;
}

export function parseKeywordWorkflowStartInput(
  value: unknown,
): KeywordWorkflowStartInput | null {
  const record = exactRecord(value, ["contextToken", "requestId"]);
  if (record === null) return null;
  const contextToken = record["contextToken"];
  const requestId = record["requestId"];
  return typeof contextToken === "string" &&
    contextToken.length > 0 &&
    contextToken.length <= MAX_CONTEXT_TOKEN_LENGTH &&
    typeof requestId === "string" &&
    UUID_PATTERN.test(requestId)
    ? { contextToken, requestId: requestId.toLowerCase() }
    : null;
}

export function parseKeywordWorkflowStatusInput(
  value: unknown,
): KeywordWorkflowStatusInput | null {
  const record = exactRecord(value, ["runToken"]);
  if (record === null) return null;
  const runToken = record["runToken"];
  return typeof runToken === "string" &&
    runToken.length > 0 &&
    runToken.length <= MAX_RUN_TOKEN_LENGTH
    ? { runToken }
    : null;
}

export function isSameOriginKeywordWorkflowRequest(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function keywordWorkflowDedupeKey(
  sub: string,
  requestId: string,
): string {
  return createHash("sha256")
    .update(sub)
    .update("\0")
    .update(requestId)
    .digest("hex");
}

export function sealKeywordWorkflowInput<T>(
  snapshot: OwnedWorkflowSnapshot<T>,
  now: () => number = Date.now,
): string {
  return seal(
    "gg_kw_workflow_input",
    {
      version: KEYWORD_WORKFLOW_VERSION,
      ...snapshot,
    } satisfies VersionedOwnedSnapshot<T>,
    KEYWORD_WORKFLOW_TTL_SECONDS,
    now,
  );
}

function openKeywordWorkflowInput<T>(
  value: string,
  now: () => number = Date.now,
): OwnedWorkflowSnapshot<T> | null {
  const snapshot = open<VersionedOwnedSnapshot<T>>(
    "gg_kw_workflow_input",
    value,
    now,
  );
  return snapshot?.version === KEYWORD_WORKFLOW_VERSION &&
    typeof snapshot.sub === "string" &&
    snapshot.sub !== ""
    ? { sub: snapshot.sub, data: snapshot.data }
    : null;
}

export function sealKeywordWorkflowGrant(
  snapshot: OwnedWorkflowSnapshot<KeywordWorkflowGrantSnapshot>,
  now: () => number = Date.now,
): string {
  return seal(
    "gg_kw_workflow_grant",
    {
      version: KEYWORD_WORKFLOW_VERSION,
      ...snapshot,
    } satisfies VersionedOwnedSnapshot<KeywordWorkflowGrantSnapshot>,
    KEYWORD_WORKFLOW_TTL_SECONDS,
    now,
  );
}

function openKeywordWorkflowGrant(
  value: string,
  now: () => number = Date.now,
): OwnedWorkflowSnapshot<KeywordWorkflowGrantSnapshot> | null {
  const snapshot = open<VersionedOwnedSnapshot<KeywordWorkflowGrantSnapshot>>(
    "gg_kw_workflow_grant",
    value,
    now,
  );
  const data = snapshot?.data;
  return snapshot?.version === KEYWORD_WORKFLOW_VERSION &&
    typeof snapshot.sub === "string" &&
    snapshot.sub !== "" &&
    typeof data?.accessToken === "string" &&
    data.accessToken !== "" &&
    Array.isArray(data.properties) &&
    data.properties.every(
      (property) => typeof property === "string" && property !== "",
    )
    ? {
        sub: snapshot.sub,
        data: {
          accessToken: data.accessToken,
          properties: [...data.properties],
        },
      }
    : null;
}

export function openKeywordWorkflowSnapshots<T>(
  inputValue: string,
  grantValue: string,
  now: () => number = Date.now,
): {
  readonly sub: string;
  readonly input: T;
  readonly grant: KeywordWorkflowGrantSnapshot;
} | null {
  const input = openKeywordWorkflowInput<T>(inputValue, now);
  const grant = openKeywordWorkflowGrant(grantValue, now);
  return input !== null && grant !== null && input.sub === grant.sub
    ? { sub: input.sub, input: input.data, grant: grant.data }
    : null;
}

export function sealKeywordWorkflowRun(
  input: { readonly runId: string; readonly sub: string },
  now: () => number = Date.now,
): string {
  return seal(
    "gg_kw_workflow_run",
    {
      version: KEYWORD_WORKFLOW_VERSION,
      runId: input.runId,
      sub: input.sub,
    } satisfies KeywordWorkflowRunSnapshot,
    KEYWORD_WORKFLOW_TTL_SECONDS,
    now,
  );
}

export function openKeywordWorkflowRun(
  value: string,
  expectedSub: string,
  now: () => number = Date.now,
): { readonly runId: string } | null {
  const snapshot = open<KeywordWorkflowRunSnapshot>(
    "gg_kw_workflow_run",
    value,
    now,
  );
  return snapshot?.version === KEYWORD_WORKFLOW_VERSION &&
    typeof snapshot.runId === "string" &&
    snapshot.runId !== "" &&
    typeof snapshot.sub === "string" &&
    snapshot.sub !== "" &&
    snapshot.sub === expectedSub
    ? { runId: snapshot.runId }
    : null;
}

export function keywordWorkflowJson(
  body: unknown,
  status: number,
  retryAfterSeconds?: number,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      ...(retryAfterSeconds === undefined
        ? {}
        : { "Retry-After": String(retryAfterSeconds) }),
    },
  });
}
