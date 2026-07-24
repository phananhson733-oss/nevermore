import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditModuleId, RULE_OPPORTUNITY_PROJECTION } from "@sf/contracts";
import {
  AuditRunsRepository,
  CapabilityRunsRepository,
  DiagnosticRunsRepository,
  contentHash,
  type ProjectScope,
} from "@sf/db";
import {
  getProjectAudit,
  getProjectAuditModule,
} from "@/lib/services/audit-projection";
import {
  getProjectOpportunity,
  listProjectOpportunities,
} from "@/lib/services/opportunities";
import {
  buildCtx,
  createDbHandle,
  DATABASE_URL,
  DB_AVAILABLE,
  runCommonChain,
  stopSharedBoss,
  type ChainResult,
  type DbHandle,
} from "./full-chain-harness.ts";

const describeDb = DB_AVAILABLE ? describe : describe.skip;

const READ_SCOPE = (scope: ProjectScope) => ({
  workspaceId: scope.workspaceId,
  uiLocale: "en" as const,
});

function observedModuleSummary() {
  return {
    moduleId: "technical_search",
    coverageState: "available" as const,
    summary: {
      moduleId: "technical_search",
      coverageState: "available",
      evidenceCount: 2,
      findingCount: 1,
      sourceProviders: ["crawl"],
      latestObservedAt: "2026-07-21T08:00:00.000Z",
      limitations: [],
    },
  };
}

function noDataModuleSummary(moduleId: string) {
  return {
    moduleId,
    coverageState: "no_data" as const,
    summary: {
      moduleId,
      coverageState: "no_data",
      evidenceCount: 0,
      findingCount: 0,
      sourceProviders: [],
      latestObservedAt: null,
      limitations: ["This module is outside the current audit's data scope."],
    },
  };
}

describeDb("growth audit + opportunity decision surfaces", () => {
  let handle: DbHandle;
  let chain: ChainResult;
  let auditRunId: string;

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const ctx = buildCtx(handle);
    chain = await runCommonChain(handle, ctx, "audit-b2b");

    const diagnosticRun = await new DiagnosticRunsRepository(handle.db).findById(
      chain.scope,
      chain.diagRunId,
    );
    if (!diagnosticRun) throw new Error("diagnostic run missing after chain");

    await new CapabilityRunsRepository(handle.db).create({
      workspaceId: chain.scope.workspaceId,
      projectId: chain.scope.projectId,
      asyncRunId: chain.diagRunId,
      capabilityId: "growth-audit",
      capabilityVersion: "0.3.0",
      inputManifestHash: contentHash({ capability: chain.diagRunId }),
      mode: "production",
      sideEffectClass: "read_only",
    });
    const auditRun = await new AuditRunsRepository(handle.db).create({
      workspaceId: chain.scope.workspaceId,
      projectId: chain.scope.projectId,
      diagnosticRunId: chain.diagRunId,
      capabilityRunId: chain.diagRunId,
      scopeKind: "site",
      scopeKey: diagnosticRun.site_id,
      projectionVersion: "growth-audit.0.3.0",
    });
    auditRunId = auditRun.id;

    const results = AuditModuleId.options.map((moduleId) =>
      moduleId === "technical_search"
        ? observedModuleSummary()
        : noDataModuleSummary(moduleId),
    );
    await new AuditRunsRepository(handle.db).insertModuleResults(
      {
        auditRunId,
        workspaceId: chain.scope.workspaceId,
        projectId: chain.scope.projectId,
      },
      results,
    );
  }, 120_000);

  afterAll(async () => {
    await stopSharedBoss();
    await handle?.end();
  });

  it("projects a complete, contract-valid growth audit with derived lenses", async () => {
    const audit = await getProjectAudit(
      READ_SCOPE(chain.scope),
      chain.scope.projectId,
      handle.db,
    );

    expect(audit.auditRunId).toBe(auditRunId);
    expect(audit.modules).toHaveLength(AuditModuleId.options.length);
    expect(audit.lenses).toHaveLength(3);
    expect(["completed", "partial"]).toContain(audit.status);
    expect(audit.completedAt).not.toBeNull();

    const technical = audit.modules.find(
      (module) => module.moduleId === "technical_search",
    );
    expect(technical?.coverageState).toBe("available");

    // The golden crawl trips site_health rules with evidence, so that lens is
    // observed rather than no_data — derived from Findings, not module rows.
    const siteHealth = audit.lenses.find(
      (lens) => lens.lensId === "site_health",
    );
    expect(siteHealth?.coverageState).not.toBe("no_data");
    expect(siteHealth?.evidenceCount).toBeGreaterThan(0);
  });

  it("returns one module summary and honors no_data modules", async () => {
    const technical = await getProjectAuditModule(
      READ_SCOPE(chain.scope),
      chain.scope.projectId,
      "technical_search",
      handle.db,
    );
    expect(technical.coverageState).toBe("available");

    const performance = await getProjectAuditModule(
      READ_SCOPE(chain.scope),
      chain.scope.projectId,
      "performance",
      handle.db,
    );
    expect(performance.coverageState).toBe("no_data");
    expect(performance.limitations.length).toBeGreaterThan(0);
  });

  it("projects a confirmed opportunity over the Finding-owned Action", async () => {
    const page = await listProjectOpportunities(
      READ_SCOPE(chain.scope),
      chain.scope.projectId,
      { limit: 100, cursor: null },
      handle.db,
    );

    expect(page.data.length).toBeGreaterThan(0);
    const confirmed = page.data.find(
      (opportunity) => opportunity.readiness === "confirmed",
    );
    expect(confirmed).toBeDefined();
    if (confirmed && confirmed.readiness === "confirmed") {
      expect(confirmed.primaryFindingId).toBe(chain.httpFindingId);
      expect(confirmed.actionId).toBe(chain.actionId);
      expect(confirmed.action.findingId).toBe(chain.httpFindingId);
      expect(confirmed.action.artifactType).toBe(
        RULE_OPPORTUNITY_PROJECTION[confirmed.primaryRule.ruleId].artifactType,
      );
    }

    // At least one other Finding is still reviewable (never shares the Action).
    expect(
      page.data.some((opportunity) => opportunity.readiness === "reviewable"),
    ).toBe(true);
  });

  it("resolves one opportunity keyed by its primary Finding id", async () => {
    const detail = await getProjectOpportunity(
      READ_SCOPE(chain.scope),
      chain.scope.projectId,
      chain.httpFindingId,
      handle.db,
    );
    expect(detail.data.readiness).toBe("confirmed");
    if (detail.data.readiness === "confirmed") {
      expect(detail.data.primaryFindingId).toBe(chain.httpFindingId);
    }
    expect(detail.projectId).toBe(chain.scope.projectId);
  });
});
