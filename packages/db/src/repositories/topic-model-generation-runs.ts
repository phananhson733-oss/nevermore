import { and, eq, sql } from "drizzle-orm";
import {
  parseTopicModelGenerationInputManifest,
  type TopicModelGenerationInputManifest,
} from "@sf/contracts";
import {
  canonicalize,
  contentHash,
  type CanonicalValue,
} from "../hash.ts";
import { topicModelGenerationRuns } from "../schema.ts";
import type { RunAttempt } from "./async-runs.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

/**
 * Frozen-input ledger for the optional Topic Model generation child. The run
 * lifecycle remains exclusively in `async_runs`; this row owns only immutable
 * input lineage and the one-shot confirmed Topic Model revision pointer.
 */
export interface TopicModelGenerationRunRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly analysis_refresh_run_id: string;
  readonly generation_version: string;
  readonly prompt_set_version: string;
  readonly input_manifest: TopicModelGenerationInputManifest;
  readonly input_hash: string;
  readonly prompt_input_hash: string | null;
  readonly result_topic_model_revision_id: string | null;
  readonly created_at: string;
}

export type TopicModelGenerationTerminalStatus =
  | "completed"
  | "failed"
  | "cancelled";

export interface TopicModelGenerationTerminalInput {
  readonly status: TopicModelGenerationTerminalStatus;
  readonly resultTopicModelRevisionId: string | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorSummary: string | null;
}

export type TopicModelGenerationTerminalizeResult =
  | {
      readonly kind: "terminalized";
      readonly run: TopicModelGenerationRunRow;
    }
  | { readonly kind: "stale" }
  | {
      readonly kind: "conflict";
      readonly run: TopicModelGenerationRunRow | null;
    };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const MAX_MANIFEST_BYTES = 262_144;
const MAX_MANIFEST_DEPTH = 20;
const MAX_MANIFEST_NODES = 20_000;
const MAX_STRING_BYTES = 16_384;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

interface PlainJsonBudget {
  nodes: number;
}

/** Refuse hooks, exotic prototypes, cycles, and unbounded JSON before hashing. */
function assertBoundedPlainJsonValue(
  value: unknown,
  path = "$",
  depth = 0,
  seen = new Set<object>(),
  budget: PlainJsonBudget = { nodes: 0 },
): void {
  budget.nodes += 1;
  if (budget.nodes > MAX_MANIFEST_NODES || depth > MAX_MANIFEST_DEPTH) {
    throw new Error("topic model generation input manifest must be bounded");
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) {
      throw new Error(`topic model generation input manifest ${path} is unbounded`);
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `topic model generation input manifest ${path} is not finite JSON`,
      );
    }
    return;
  }
  if (typeof value !== "object") {
    throw new Error(
      `topic model generation input manifest ${path} is not plain JSON`,
    );
  }
  if (seen.has(value)) {
    throw new Error(
      `topic model generation input manifest ${path} contains a cycle`,
    );
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key)) {
        throw new Error(
          `topic model generation input manifest ${path} is not plain JSON`,
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || descriptor.get || descriptor.set) {
        throw new Error(
          `topic model generation input manifest ${path}[${key}] is not plain JSON`,
        );
      }
      assertBoundedPlainJsonValue(
        descriptor.value,
        `${path}[${key}]`,
        depth + 1,
        seen,
        budget,
      );
    }
    seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(
      `topic model generation input manifest ${path} is not a plain JSON object`,
    );
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || key === "toJSON") {
      throw new Error(
        `topic model generation input manifest ${path} cannot define toJSON or symbols`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || descriptor.get || descriptor.set) {
      throw new Error(
        `topic model generation input manifest ${path}.${key} is not plain JSON`,
      );
    }
    assertBoundedPlainJsonValue(
      descriptor.value,
      `${path}.${key}`,
      depth + 1,
      seen,
      budget,
    );
  }
  seen.delete(value);
}

function parseFrozenManifest(value: unknown): Record<string, unknown> {
  assertBoundedPlainJsonValue(value);
  let detached: unknown;
  try {
    detached = structuredClone(value);
  } catch {
    throw new Error(
      "topic model generation input manifest is not stable plain JSON",
    );
  }
  if (
    typeof detached !== "object" ||
    detached === null ||
    Array.isArray(detached)
  ) {
    throw new Error("topic model generation input manifest must be an object");
  }
  const canonical = canonicalize(detached as CanonicalValue);
  if (Buffer.byteLength(canonical, "utf8") > MAX_MANIFEST_BYTES) {
    throw new Error("topic model generation input manifest must be bounded");
  }
  return JSON.parse(canonical) as Record<string, unknown>;
}

function validBoundedText(value: unknown, maximum = 200): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= maximum
  );
}

function validAttempt(attempt: RunAttempt): boolean {
  return (
    UUID.test(attempt.workspaceId) &&
    UUID.test(attempt.projectId) &&
    UUID.test(attempt.runId) &&
    Number.isSafeInteger(attempt.attemptCount) &&
    attempt.attemptCount >= 1 &&
    attempt.attemptCount <= MAX_POSTGRES_INTEGER
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTimestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function parseRun(value: unknown): TopicModelGenerationRunRow | null {
  if (!isRecord(value)) return null;
  const rawManifest = value["input_manifest"];
  if (
    !UUID.test(String(value["id"])) ||
    !UUID.test(String(value["workspace_id"])) ||
    !UUID.test(String(value["project_id"])) ||
    !UUID.test(String(value["analysis_refresh_run_id"])) ||
    !validBoundedText(value["generation_version"]) ||
    !validBoundedText(value["prompt_set_version"]) ||
    !isRecord(rawManifest) ||
    !SHA256_HEX.test(String(value["input_hash"])) ||
    (value["prompt_input_hash"] !== null &&
      !SHA256_HEX.test(String(value["prompt_input_hash"]))) ||
    (value["result_topic_model_revision_id"] !== null &&
      !UUID.test(String(value["result_topic_model_revision_id"]))) ||
    parseTimestamp(value["created_at"]) === null
  ) {
    return null;
  }
  try {
    const manifest = parseTopicModelGenerationInputManifest(rawManifest);
    if (
      manifest.projectId !== value["project_id"] ||
      manifest.analysisRefreshRunId !== value["analysis_refresh_run_id"] ||
      contentHash(manifest as CanonicalValue) !== value["input_hash"]
    ) {
      return null;
    }
    return {
      ...(value as unknown as TopicModelGenerationRunRow),
      input_manifest: manifest,
    };
  } catch {
    return null;
  }
}

function firstFunctionResult(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw) || !Array.isArray(raw["rows"])) {
    throw new Error("invalid Topic Model generation database response");
  }
  const first = raw["rows"][0];
  if (!isRecord(first) || !isRecord(first["result"])) {
    throw new Error("missing Topic Model generation database result");
  }
  return first["result"];
}

function parseTerminalizeResult(
  value: Record<string, unknown>,
): TopicModelGenerationTerminalizeResult {
  if (value["kind"] === "stale") return { kind: "stale" };
  if (value["kind"] === "conflict") {
    const run = value["run"] == null ? null : parseRun(value["run"]);
    if (run !== null || value["run"] == null) return { kind: "conflict", run };
  }
  if (value["kind"] === "terminalized") {
    const run = parseRun(value["run"]);
    if (run !== null) return { kind: "terminalized", run };
  }
  throw new Error("invalid Topic Model generation terminalization result");
}

function validTerminalInput(input: TopicModelGenerationTerminalInput): boolean {
  if (input.status === "completed") {
    return (
      input.resultTopicModelRevisionId !== null &&
      UUID.test(input.resultTopicModelRevisionId) &&
      input.lastErrorCode === null &&
      input.lastErrorSummary === null
    );
  }
  return (
    input.resultTopicModelRevisionId === null &&
    input.lastErrorCode !== null &&
    ERROR_CODE.test(input.lastErrorCode) &&
    validBoundedText(input.lastErrorSummary, 2_000)
  );
}

export class TopicModelGenerationRunsRepository extends Repository {
  async insertPlaceholder(values: {
    readonly runId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly analysisRefreshRunId: string;
    readonly generationVersion: string;
    readonly promptSetVersion: string;
    readonly inputManifest: unknown;
    readonly inputHash: string;
  }): Promise<TopicModelGenerationRunRow> {
    const frozenManifest = parseTopicModelGenerationInputManifest(
      parseFrozenManifest(values.inputManifest),
    );
    if (
      frozenManifest["schemaVersion"] !==
        "topic-model-generation-input.v1" ||
      frozenManifest["analysisRefreshRunId"] !== values.analysisRefreshRunId ||
      frozenManifest["projectId"] !== values.projectId
    ) {
      throw new Error(
        "topic model generation input manifest does not match its frozen scope",
      );
    }
    const derivedInputHash = contentHash(frozenManifest as CanonicalValue);
    if (derivedInputHash !== values.inputHash) {
      throw new Error(
        "topic model generation input hash does not match its frozen manifest",
      );
    }
    if (
      !UUID.test(values.runId) ||
      !UUID.test(values.workspaceId) ||
      !UUID.test(values.projectId) ||
      !UUID.test(values.analysisRefreshRunId) ||
      !validBoundedText(values.generationVersion) ||
      !validBoundedText(values.promptSetVersion)
    ) {
      throw new Error("invalid Topic Model generation run metadata");
    }

    const [inserted] = await this.exec
      .insert(topicModelGenerationRuns)
      .values({
        id: values.runId,
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        analysis_refresh_run_id: values.analysisRefreshRunId,
        generation_version: values.generationVersion,
        prompt_set_version: values.promptSetVersion,
        input_manifest: frozenManifest,
        input_hash: values.inputHash,
      })
      .returning();
    const row = parseRun(inserted);
    if (row === null) {
      throw new Error("invalid Topic Model generation run row");
    }
    return row;
  }

  async findById(
    scope: ProjectScope,
    id: string,
  ): Promise<TopicModelGenerationRunRow | null> {
    const rows = await this.exec
      .select()
      .from(topicModelGenerationRuns)
      .where(
        and(
          projectPredicate(topicModelGenerationRuns, scope),
          eq(topicModelGenerationRuns.id, id),
        ),
      )
      .limit(1);
    if (rows[0] === undefined) return null;
    const row = parseRun(rows[0]);
    if (row === null) {
      throw new Error("invalid Topic Model generation run row");
    }
    return row;
  }

  async terminalize(
    attempt: RunAttempt,
    input: TopicModelGenerationTerminalInput,
  ): Promise<TopicModelGenerationTerminalizeResult> {
    if (!validAttempt(attempt)) return { kind: "stale" };
    if (!validTerminalInput(input)) return { kind: "conflict", run: null };
    const raw = await this.exec.execute(sql`
      select app.terminalize_topic_model_generation_run(
        ${attempt.workspaceId}::uuid,
        ${attempt.projectId}::uuid,
        ${attempt.runId}::uuid,
        ${attempt.attemptCount}::integer,
        ${input.status}::text,
        ${input.resultTopicModelRevisionId}::uuid,
        ${input.lastErrorCode}::text,
        ${input.lastErrorSummary}::text
      ) as result
    `);
    return parseTerminalizeResult(firstFunctionResult(raw));
  }
}
