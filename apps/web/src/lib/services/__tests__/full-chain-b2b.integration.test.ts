import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DATABASE_URL,
  DB_AVAILABLE,
  DEGRADATION_LIMITATIONS,
  MANIFEST_SCHEMA,
  buildCtx,
  createDbHandle,
  ExecutionArtifactsRepository,
  listProjectActions,
  listProjectFindings,
  manifestFilePaths,
  manifestItemCount,
  runCommonChain,
  runExportChain,
  stopSharedBoss,
  validateManifest,
  type ChainResult,
  type DbHandle,
  type ExportChainResult,
  type WorkerContext,
} from "./full-chain-harness.ts";

/**
 * AC-044 — B2B full vertical: createProject → seed complete ICP + golden crawl →
 * createDiagnosticRun (service) → runDiagnostic (worker) → confirm the top
 * finding → createActionArtifact (TEMPLATE) → runArtifact (worker) →
 * createProjectExport({kind:"service_bundle"}) → runExport (worker), asserting the
 * bundle finalizes, its manifest validates against
 * schemas/service-bundle-manifest.schema.json, and the service_bundle carries the
 * internal diagnostic detail. AC-022 degradation is asserted on the same run.
 */

const describeDb = DB_AVAILABLE ? describe : describe.skip;

describeDb(
  "AC-044 B2B full vertical → service_bundle export (spec §8–§10.5)",
  () => {
    let handle: DbHandle;
    let ctx: WorkerContext;
    let chain: ChainResult;
    let findings: Awaited<ReturnType<typeof listProjectFindings>>;
    let actions: Awaited<ReturnType<typeof listProjectActions>>;
    let serviceBundle: ExportChainResult;

    beforeAll(async () => {
      handle = createDbHandle(DATABASE_URL);
      ctx = buildCtx(handle);
      chain = await runCommonChain(handle, ctx, "b2b");
      findings = await listProjectFindings(
        { workspaceId: chain.scope.workspaceId },
        chain.scope.projectId,
        { limit: 100, cursor: null, activeOnly: false },
      );
      actions = await listProjectActions(
        { workspaceId: chain.scope.workspaceId },
        chain.scope.projectId,
        { limit: 100, cursor: null },
      );
      serviceBundle = await runExportChain(
        handle,
        ctx,
        chain.scope,
        chain.actor,
        "service_bundle",
      );
    });
    afterAll(async () => {
      await handle?.end();
    });

    it("the golden crawl trips findings across MULTIPLE rule domains with honest evidence axes", () => {
      const byRule = new Map(findings.data.map((f) => [f.ruleId, f]));
      // Deterministic golden triggers across two+ domains (spec §8.3, §8.4).
      expect(byRule.has("TECH-HTTP-001")).toBe(true); // technical_seo
      expect(byRule.has("TECH-CANONICAL-002")).toBe(true); // technical_seo
      expect(byRule.has("TECH-LINKGRAPH-005")).toBe(true); // technical_seo
      expect(byRule.has("CONTENT-COVERAGE-001")).toBe(true); // content_intent
      const domains = new Set(findings.data.map((f) => f.domain));
      expect(domains.has("technical_seo")).toBe(true);
      expect(domains.has("content_intent")).toBe(true);
      expect(domains.size).toBeGreaterThan(1);

      // Every finding carries a full, honest evidence-axis set (spec §1.3): a real
      // origin/method/grade/availability/support and a non-empty limitation — never
      // a bare number pretending to be observed.
      for (const finding of findings.data) {
        expect(finding.evidence.length).toBeGreaterThan(0);
        for (const e of finding.evidence) {
          expect(["A", "B", "C"]).toContain(e.grade);
          expect(e.origin.length).toBeGreaterThan(0);
          expect(e.method.length).toBeGreaterThan(0);
          expect(e.availability.length).toBeGreaterThan(0);
          expect(e.support.length).toBeGreaterThan(0);
          expect(e.limitation.length).toBeGreaterThan(0);
        }
      }
      // The inferred coverage finding is honestly graded C (derived, not observed).
      expect(
        byRule
          .get("CONTENT-COVERAGE-001")!
          .evidence.every((e) => e.grade === "C"),
      ).toBe(true);
    });

    it("AC-022: the run is `partial`, missing datasets `skipped` (not blocking), degradation strings honest", () => {
      // A single skipped dataset rule makes the whole run partial (spec §8.6).
      expect(findings.meta.latestRun?.status).toBe("partial");

      const byRule = new Map(
        findings.meta.ruleResults.map((r) => [r.ruleId, r]),
      );
      // GSC/GA4/CSV are unavailable → their rules skip with `missing_dataset`;
      // they do NOT manufacture a finding (unavailable ≠ 0/defect, spec §1.3).
      expect(byRule.get("SEARCH-CTR-004")?.status).toBe("skipped");
      expect(byRule.get("SEARCH-CTR-004")?.reason).toBe("missing_dataset");
      expect(byRule.get("SEARCH-DECAY-002")?.status).toBe("skipped");
      // The crawl rule that CAN run still ran (crawl is available, not skipped).
      expect(byRule.get("TECH-HTTP-001")?.status).toBe("candidate");
      // No search/landing/gap finding was fabricated from the missing datasets.
      const ruleIds = new Set(findings.data.map((f) => f.ruleId));
      expect(ruleIds.has("SEARCH-CTR-004")).toBe(false);
      expect(ruleIds.has("SEARCH-DECAY-002")).toBe(false);

      // The coverage projection carries the honest per-dataset degradation strings.
      const limitations = findings.meta.coverage?.limitations ?? [];
      for (const expected of DEGRADATION_LIMITATIONS) {
        expect(limitations).toContain(expected);
      }
    });

    it("confirm → same-tx Action (spec §9.1) → the plan lists it", () => {
      const confirmed = findings.data.find((f) => f.id === chain.httpFindingId);
      expect(confirmed?.reviewState).toBe("confirmed");
      const action = actions.data.find((a) => a.id === chain.actionId);
      expect(action).toBeDefined();
      expect(action?.templateId).toBe("fix_http_status.v1");
      expect(action?.findingId).toBe(chain.httpFindingId);
      // Priority is a deterministic derivation, not an opaque score (spec §9.3).
      expect(["critical", "high", "medium", "low"]).toContain(
        action?.priorityBand,
      );
    });

    it("runArtifact (TEMPLATE mode, no network) appends a draft revision", async () => {
      const repo = new ExecutionArtifactsRepository(handle.db);
      const artifact = await repo.findById(chain.scope, chain.artifactId);
      expect(artifact?.status).toBe("draft");
      expect(artifact?.current_revision).toBe(1);
      expect(artifact?.artifact_type).toBe("technical_ticket");
      const revisions = await repo.listRevisions(chain.scope, chain.artifactId);
      expect(revisions.length).toBe(1);
      // Template-generated (deterministic), NOT an LLM invocation.
      expect(revisions[0]?.generated_by).toBe("template");
      expect(revisions[0]?.analysis_invocation_id).toBeNull();
    });

    it("the service_bundle finalizes and its manifest validates against the schema", () => {
      expect(serviceBundle.runStatus).toBe("completed");
      expect(serviceBundle.row.object_key).not.toBeNull();
      expect(serviceBundle.row.checksum).toMatch(/^[a-f0-9]{64}$/);

      const errors = validateManifest(serviceBundle.manifest, MANIFEST_SCHEMA);
      expect(
        errors,
        `manifest schema violations: ${errors.join("; ")}`,
      ).toEqual([]);
      expect(serviceBundle.manifest["kind"]).toBe("service_bundle");
      expect(serviceBundle.manifest["schemaVersion"]).toBe(
        "signalframe.service-bundle.0.2.0",
      );
      expect(serviceBundle.manifest["ruleSetVersion"]).toBe("mvp.rules.0.2.0");
    });

    it("the service_bundle INCLUDES the internal diagnostic detail (spec §10.5)", () => {
      const paths = manifestFilePaths(serviceBundle.manifest);
      // Internal observation ledger + full canonical sections are present.
      expect(paths).toContain("observations.ndjson");
      expect(paths).toContain("findings.json");
      expect(paths).toContain("evidence.json");
      expect(paths).toContain("actions.json");
      expect(
        manifestItemCount(serviceBundle.manifest, "observations"),
      ).toBeGreaterThan(0);
      // The confirmed action's draft artifact rides along in the internal bundle.
      expect(manifestItemCount(serviceBundle.manifest, "artifacts")).toBe(1);
      expect(
        manifestItemCount(serviceBundle.manifest, "artifactRevisions"),
      ).toBeGreaterThan(0);
      // findings count in the bundle equals the persisted set (activeOnly:false).
      expect(manifestItemCount(serviceBundle.manifest, "findings")).toBe(
        findings.data.length,
      );
    });
  },
);

// pg-boss is enqueue-only per test file; stop it after this vertical.
afterAll(async () => {
  await stopSharedBoss();
});
