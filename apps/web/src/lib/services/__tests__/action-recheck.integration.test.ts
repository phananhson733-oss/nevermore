import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditRunsRepository } from "@sf/db";
import { createActionRecheck } from "@/lib/services/action-recheck";
import { getProjectResults } from "@/lib/services/recheck-results";
import { getProjectAudit } from "@/lib/services/audit-projection";
import {
  DATABASE_URL,
  DB_AVAILABLE,
  buildCtx,
  createDbHandle,
  runAuditChain,
  runDiagnostic,
  stopSharedBoss,
  type DbHandle,
  type WorkerContext,
} from "./full-chain-harness.ts";

/**
 * Task 8 recheck vertical: build a real prior full audit (createGrowthAuditRun →
 * runDiagnostic → confirm TECH-HTTP-001), queue a recheck (createActionRecheck),
 * run the recheck worker, then compare the two immutable runs via
 * getProjectResults. Also proves the projection isolation: the recheck run is a
 * NEW immutable run, the prior run is preserved, and the Overview audit
 * projection still resolves the full audit — never the recheck.
 */

const describeDb = DB_AVAILABLE ? describe : describe.skip;

describeDb("createActionRecheck → runDiagnostic → getProjectResults", () => {
  let handle: DbHandle;
  let ctx: WorkerContext;

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    ctx = buildCtx(handle);
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("rechecks a confirmed Action on a new immutable run and compares the two", async () => {
    const chain = await runAuditChain(handle, ctx, "b2b-recheck");
    expect(chain.targetScope).toEqual({ kind: "http_status", ref: "404" });

    const accepted = await createActionRecheck(
      { workspaceId: chain.scope.workspaceId },
      chain.scope.projectId,
      chain.actor,
      randomUUID(),
      {
        actionId: chain.actionId,
        priorRunId: chain.auditRunId,
        targetScope: chain.targetScope,
        capabilityContractVersion: "growth-audit.0.3.0",
      },
    );

    expect(accepted.status).toBe(202);
    expect(accepted.resourceRef.type).toBe("audit_run");
    // The recheck is a brand-new immutable run: a fresh run id and audit run id.
    expect(accepted.run.id).not.toBe(chain.diagRunId);
    expect(accepted.resourceRef.id).not.toBe(chain.auditRunId);

    const recheckAuditRun = await new AuditRunsRepository(handle.db).findById(
      chain.scope,
      accepted.resourceRef.id,
    );
    expect(recheckAuditRun?.projection_version).toBe(
      "growth-audit-recheck.0.3.0",
    );

    // Run the recheck's diagnostic worker (reused, unchanged).
    await runDiagnostic(ctx, {
      runId: accepted.run.id,
      workspaceId: chain.scope.workspaceId,
      projectId: chain.scope.projectId,
    });

    const results = await getProjectResults(
      { workspaceId: chain.scope.workspaceId, uiLocale: "en" },
      chain.scope.projectId,
    );

    expect(results.priorRunId).toBe(chain.auditRunId);
    expect(results.currentRunId).toBe(accepted.resourceRef.id);
    expect(results.rules).toHaveLength(1);
    const comparison = results.rules[0]!;
    expect(comparison.ruleId).toBe("TECH-HTTP-001");
    // One of the three technical states (裁决 1). The same golden 404 crawl is
    // re-run, so the technical condition is still observed (unchanged).
    expect(["verified", "observed", "insufficient_data"]).toContain(
      comparison.state,
    );
    expect(comparison.priorStatus).toBe("candidate");
    expect(comparison.state).toBe("observed");
    expect(comparison.disposition).toBe("unchanged");
    expect(comparison.label).toBe("Technical condition still observed");

    // Projection isolation: the Overview audit projection resolves the FULL
    // audit, never the newer recheck run.
    const audit = await getProjectAudit(
      { workspaceId: chain.scope.workspaceId, uiLocale: "en" },
      chain.scope.projectId,
    );
    expect(audit.auditRunId).toBe(chain.auditRunId);
    expect(audit.auditRunId).not.toBe(accepted.resourceRef.id);

    // The prior run is preserved unchanged.
    const priorRun = await new AuditRunsRepository(handle.db).findById(
      chain.scope,
      chain.auditRunId,
    );
    expect(priorRun?.projection_version).toBe("growth-audit.0.3.0");
  });
});

afterAll(async () => {
  await stopSharedBoss();
});
