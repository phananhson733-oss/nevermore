import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { asyncRuns, capabilityRuns } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

function sameHash(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

/**
 * Typed extension of one canonical `async_runs` row. Lifecycle state remains on
 * the async run; this row only freezes the capability contract and input hash.
 */
export interface CapabilityRunRow {
  readonly async_run_id: string;
  readonly capability_id: string;
  readonly capability_version: string;
  readonly input_manifest_hash: string;
  readonly mode: string;
  readonly side_effect_class: string;
  readonly created_at: string;
}

export class CapabilityRunsRepository extends Repository {
  async create(values: {
    workspaceId: string;
    projectId: string;
    asyncRunId: string;
    capabilityId: string;
    capabilityVersion: string;
    inputManifestHash: string;
    mode: "production" | "shadow" | "simulation";
    sideEffectClass: "read_only" | "internal_write" | "external_write";
  }): Promise<CapabilityRunRow> {
    const scope = {
      workspaceId: values.workspaceId,
      projectId: values.projectId,
    };
    const canonicalRun = await this.exec
      .select({ id: asyncRuns.id })
      .from(asyncRuns)
      .where(
        and(
          projectPredicate(asyncRuns, scope),
          eq(asyncRuns.id, values.asyncRunId),
        ),
      )
      .limit(1);
    if (!canonicalRun[0]) {
      throw new Error("capability run canonical scope mismatch");
    }

    const [inserted] = await this.exec
      .insert(capabilityRuns)
      .values({
        async_run_id: values.asyncRunId,
        capability_id: values.capabilityId,
        capability_version: values.capabilityVersion,
        input_manifest_hash: values.inputManifestHash,
        mode: values.mode,
        side_effect_class: values.sideEffectClass,
      })
      .onConflictDoNothing({ target: capabilityRuns.async_run_id })
      .returning();
    if (inserted) return inserted as CapabilityRunRow;

    const existing = await this.findByAsyncRunIdScoped(
      scope,
      values.asyncRunId,
    );
    if (
      existing &&
      existing.capability_id === values.capabilityId &&
      existing.capability_version === values.capabilityVersion &&
      sameHash(existing.input_manifest_hash, values.inputManifestHash) &&
      existing.mode === values.mode &&
      existing.side_effect_class === values.sideEffectClass
    ) {
      return existing;
    }
    throw new Error("capability run replay conflicts with immutable values");
  }

  private async findByAsyncRunIdScoped(
    scope: ProjectScope,
    asyncRunId: string,
  ): Promise<CapabilityRunRow | null> {
    const rows = await this.exec
      .select({
        async_run_id: capabilityRuns.async_run_id,
        capability_id: capabilityRuns.capability_id,
        capability_version: capabilityRuns.capability_version,
        input_manifest_hash: capabilityRuns.input_manifest_hash,
        mode: capabilityRuns.mode,
        side_effect_class: capabilityRuns.side_effect_class,
        created_at: capabilityRuns.created_at,
      })
      .from(capabilityRuns)
      .innerJoin(asyncRuns, eq(asyncRuns.id, capabilityRuns.async_run_id))
      .where(
        and(
          projectPredicate(asyncRuns, scope),
          eq(capabilityRuns.async_run_id, asyncRunId),
        ),
      )
      .limit(1);
    return (rows[0] as CapabilityRunRow | undefined) ?? null;
  }

  /** Worker/internal lookup; customer-facing audit reads use AuditRunsRepository. */
  async findByAsyncRunId(
    asyncRunId: string,
  ): Promise<CapabilityRunRow | null> {
    const rows = await this.exec
      .select()
      .from(capabilityRuns)
      .where(eq(capabilityRuns.async_run_id, asyncRunId))
      .limit(1);
    return (rows[0] as CapabilityRunRow | undefined) ?? null;
  }
}
