import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AuditRunsRepository,
  GROWTH_AUDIT_PROJECTION_VERSION,
} from "@sf/db";
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
    expect(priorRun?.projection_version).toBe(
      GROWTH_AUDIT_PROJECTION_VERSION,
    );
  });

  /**
   * The one tenant boundary on the prior rule ledger, exercised.
   *
   * `getProjectResults` reads `priorRunId` back out of
   * `async_runs.request_payload` -- jsonb, no foreign key, no shape constraint
   * -- and then hands the prior run's `diagnostic_run_id` to
   * `DiagnosticRunsRepository.listRuleResults`, whose signature takes NO scope
   * (`diagnostic-runs.ts:141`). The `AuditRunsRepository.findById(projectScope,
   * ...)` above it is the only thing standing between a repointed payload and
   * another workspace's rule ledger, and it had no test at all.
   *
   * SPEC:878 puts the cross-project and cross-workspace cases inside 404
   * `NOT_FOUND`. This used to answer 503, which is a different sentence: it
   * says the id resolves somewhere, just not here.
   */
  it("refuses a repointed prior run as absent, and reads no other tenant's ledger", async () => {
    const victim = await runAuditChain(handle, ctx, "b2b-recheck");
    const attacker = await runAuditChain(handle, ctx, "b2b-recheck");

    const accepted = await createActionRecheck(
      { workspaceId: attacker.scope.workspaceId },
      attacker.scope.projectId,
      attacker.actor,
      randomUUID(),
      {
        actionId: attacker.actionId,
        priorRunId: attacker.auditRunId,
        targetScope: attacker.targetScope,
        capabilityContractVersion: "growth-audit.0.3.0",
      },
    );
    await runDiagnostic(ctx, {
      runId: accepted.run.id,
      workspaceId: attacker.scope.workspaceId,
      projectId: attacker.scope.projectId,
    });

    // Sanity: the projection resolves before the payload is repointed, so a
    // 404 below cannot be blamed on the fixture failing to build.
    await expect(
      getProjectResults(
        { workspaceId: attacker.scope.workspaceId, uiLocale: "en" },
        attacker.scope.projectId,
      ),
    ).resolves.toMatchObject({ priorRunId: attacker.auditRunId });

    // Repoint the frozen pointer at the victim's audit run in another
    // workspace. Nothing in the schema forbids this value.
    await handle.pool.query(
      "UPDATE app.async_runs SET request_payload = jsonb_set(request_payload, '{priorRunId}', to_jsonb($2::text)) WHERE id = $1",
      [accepted.run.id, victim.auditRunId],
    );

    const rejection = await getProjectResults(
      { workspaceId: attacker.scope.workspaceId, uiLocale: "en" },
      attacker.scope.projectId,
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: { code?: string; status?: number }) => ({
        ok: false as const,
        error,
      }),
    );

    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      // 404, not 503: a distinguishable status here answers "does this id
      // exist somewhere else?" for anyone who can reach the endpoint.
      expect(rejection.error.code).toBe("NOT_FOUND");
      expect(rejection.error.status).toBe(404);
    }
  });
});

afterAll(async () => {
  await stopSharedBoss();
});
