import {
  ProductProfileSynthesisInputManifest,
  type ProductProfileSynthesisInputManifest as ProductProfileSynthesisInputManifestValue,
} from "@sf/contracts";
import { and, eq, isNull, or } from "drizzle-orm";
import {
  canonicalize,
  contentHash,
  type CanonicalValue,
} from "../hash.ts";
import { productProfileRuns } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

/**
 * Frozen-input ledger for one Product Profile synthesis command. Canonical
 * Product Profile versions remain append-only `icp_profiles` rows; this ledger
 * only records the exact base/profile source and its optional result pointer.
 */
export interface ProductProfileRunRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly base_icp_profile_id: string;
  readonly base_icp_profile_version: number;
  readonly base_icp_profile_content_hash: string;
  readonly source_snapshot_id: string;
  readonly synthesis_version: string;
  readonly prompt_set_version: string;
  readonly input_manifest: Record<string, unknown>;
  readonly input_hash: string;
  readonly prompt_input_hash: string | null;
  readonly result_icp_profile_id: string | null;
  readonly created_at: string;
}

const SHA256_HEX = /^[a-f0-9]{64}$/u;

/**
 * Refuse value hooks/accessors and exotic prototypes before Zod reads the
 * caller's object. This makes the frozen hash independent from `toJSON`,
 * getters, proxies over class instances, or hidden non-JSON properties.
 */
function assertPlainJsonValue(value: unknown, path = "$", seen = new Set<object>()): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`product profile input manifest ${path} is not finite JSON`);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new Error(`product profile input manifest ${path} is not plain JSON`);
  }
  if (seen.has(value)) {
    throw new Error(`product profile input manifest ${path} contains a cycle`);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key)) {
        throw new Error(`product profile input manifest ${path} is not plain JSON`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || descriptor.get || descriptor.set) {
        throw new Error(`product profile input manifest ${path}[${key}] is not plain JSON`);
      }
      assertPlainJsonValue(descriptor.value, `${path}[${key}]`, seen);
    }
    seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`product profile input manifest ${path} is not a plain JSON object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || key === "toJSON") {
      throw new Error(`product profile input manifest ${path} cannot define toJSON or symbols`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || descriptor.get || descriptor.set) {
      throw new Error(`product profile input manifest ${path}.${key} is not plain JSON`);
    }
    assertPlainJsonValue(descriptor.value, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function parseFrozenManifest(
  value: unknown,
): ProductProfileSynthesisInputManifestValue {
  assertPlainJsonValue(value);
  let detached: unknown;
  try {
    // `structuredClone` fails closed for Proxy wrappers and other exotic
    // objects that can change observable values while validation is running.
    detached = structuredClone(value);
  } catch {
    throw new Error("product profile input manifest is not stable plain JSON");
  }
  const parsed = ProductProfileSynthesisInputManifest.parse(detached);
  // Zod has already discarded the caller's references. The canonical JSON
  // round-trip additionally guarantees an ordinary, hook-free persisted tree.
  return JSON.parse(
    canonicalize(parsed as CanonicalValue),
  ) as ProductProfileSynthesisInputManifestValue;
}

export class ProductProfileRunsRepository extends Repository {
  /** Insert the unfinished typed placeholder in the atomic enqueue tx. */
  async insertPlaceholder(values: {
    runId: string;
    workspaceId: string;
    projectId: string;
    siteId: string;
    baseIcpProfileId: string;
    baseIcpProfileVersion: number;
    baseIcpProfileContentHash: string;
    sourceSnapshotId: string;
    synthesisVersion: string;
    promptSetVersion: string;
    inputManifest: unknown;
    inputHash: string;
  }): Promise<ProductProfileRunRow> {
    const frozenManifest = parseFrozenManifest(values.inputManifest);
    const derivedInputHash = contentHash(frozenManifest as CanonicalValue);
    if (derivedInputHash !== values.inputHash) {
      throw new Error(
        "product profile input hash does not match its frozen manifest",
      );
    }

    const [row] = await this.exec
      .insert(productProfileRuns)
      .values({
        id: values.runId,
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        base_icp_profile_id: values.baseIcpProfileId,
        base_icp_profile_version: values.baseIcpProfileVersion,
        base_icp_profile_content_hash: values.baseIcpProfileContentHash,
        source_snapshot_id: values.sourceSnapshotId,
        synthesis_version: values.synthesisVersion,
        prompt_set_version: values.promptSetVersion,
        input_manifest: frozenManifest,
        input_hash: values.inputHash,
      })
      .returning();
    return row as ProductProfileRunRow;
  }

  /**
   * Bind the hash of the exact allowlisted provider prompt once. This is
   * deliberately distinct from `input_hash`, which addresses the durable
   * frozen source manifest rather than the redacted prompt projection.
   */
  async setPromptInputHash(
    scope: ProjectScope,
    id: string,
    promptInputHash: string,
  ): Promise<boolean> {
    if (!SHA256_HEX.test(promptInputHash)) {
      throw new Error("product profile prompt input hash must be sha256 hex");
    }
    const rows = await this.exec
      .update(productProfileRuns)
      .set({ prompt_input_hash: promptInputHash })
      .where(
        and(
          projectPredicate(productProfileRuns, scope),
          eq(productProfileRuns.id, id),
          or(
            isNull(productProfileRuns.prompt_input_hash),
            eq(productProfileRuns.prompt_input_hash, promptInputHash),
          ),
        ),
      )
      .returning({ id: productProfileRuns.id });
    return rows.length === 1;
  }

  async findById(
    scope: ProjectScope,
    id: string,
  ): Promise<ProductProfileRunRow | null> {
    const rows = await this.exec
      .select()
      .from(productProfileRuns)
      .where(
        and(
          projectPredicate(productProfileRuns, scope),
          eq(productProfileRuns.id, id),
        ),
      )
      .limit(1);
    return (rows[0] as ProductProfileRunRow | undefined) ?? null;
  }

  /**
   * Bind the generated immutable draft once. SQL re-validates the result's
   * Site/Snapshot/AnalysisInvocation lineage in the same statement.
   */
  async setResult(
    scope: ProjectScope,
    id: string,
    resultIcpProfileId: string,
  ): Promise<boolean> {
    const rows = await this.exec
      .update(productProfileRuns)
      .set({ result_icp_profile_id: resultIcpProfileId })
      .where(
        and(
          projectPredicate(productProfileRuns, scope),
          eq(productProfileRuns.id, id),
          isNull(productProfileRuns.result_icp_profile_id),
        ),
      )
      .returning({ id: productProfileRuns.id });
    return rows.length === 1;
  }
}
