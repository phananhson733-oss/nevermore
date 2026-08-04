import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTRACT_VERSION } from "@sf/contracts";
import { RULE_SET_VERSION } from "@sf/engine";
import { ProblemError } from "@sf/observability";
import {
  ActionsRepository,
  AsyncRunsRepository,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  FindingTargetsRepository,
  FindingsRepository,
  ObservationsRepository,
  PageSnapshotsRepository,
  ProjectsRepository,
  contentHash,
  toRunAttempt,
} from "@sf/db";
import { METRIC_CRAWL_PAGE } from "@sf/sources";
import { createActionArtifact } from "@/lib/services/artifacts";
import { createDiagnosticRun } from "@/lib/services/diagnostics";
import { createProjectExport } from "@/lib/services/export-service";
import {
  DATABASE_URL,
  DB_AVAILABLE,
  DEGRADATION_LIMITATIONS,
  MANIFEST_SCHEMA,
  buildCtx,
  createDbHandle,
  ExecutionArtifactsRepository,
  getBoss,
  listProjectActions,
  listProjectFindings,
  manifestFilePaths,
  manifestItemCount,
  runCommonChain,
  runMissingProviderDiagnostic,
  runArtifact,
  runExportChain,
  stopSharedBoss,
  validateManifest,
  type ChainResult,
  type DbHandle,
  type ExportChainResult,
  type WorkerContext,
} from "./full-chain-harness.ts";

const ARTIFACT_ACCEPTANCE_CASES = [
  {
    artifactType: "technical_ticket",
    templateId: "normalize_canonical.v1",
    sourceRuleId: "TECH-CANONICAL-002",
    expectedFormat: "markdown",
    risk: "high",
  },
  {
    artifactType: "metadata_rewrite",
    templateId: "rewrite_search_metadata.v1",
    sourceRuleId: "TECH-LINKGRAPH-005",
    expectedFormat: "json",
    risk: "low",
  },
  {
    artifactType: "content_brief",
    templateId: "create_priority_content.v1",
    sourceRuleId: "CONTENT-COVERAGE-001",
    expectedFormat: "markdown",
    risk: "low",
  },
] as const;

/**
 * AC-044 — B2B full vertical: createProject → seed complete ICP + golden crawl →
 * createDiagnosticRun (service) → runDiagnostic (worker) → confirm the top
 * finding → createActionArtifact (TEMPLATE) → runArtifact (worker) →
 * createProjectExport({kind:"service_bundle"}) → runExport (worker), asserting the
 * bundle finalizes, its manifest validates against
 * schemas/service-bundle-manifest.schema.json, and the service_bundle carries the
 * internal diagnostic detail. AC-022 degradation is asserted with a separate
 * crawl-only diagnostic so it cannot dilute the complete all-provider chain.
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
    let degradedFindings: Awaited<ReturnType<typeof listProjectFindings>>;

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
      const degraded = await runMissingProviderDiagnostic(
        handle,
        ctx,
        "b2b-missing-providers",
      );
      degradedFindings = await listProjectFindings(
        { workspaceId: degraded.scope.workspaceId },
        degraded.scope.projectId,
        { limit: 100, cursor: null, activeOnly: false },
      );
    });
    afterAll(async () => {
      await handle?.end();
    });

    it("AC-022: the shared Crawl + GSC + GA4 + CSV fixture executes at least one rule in all five domains", () => {
      const byRule = new Map(findings.data.map((f) => [f.ruleId, f]));
      // Deterministic golden triggers across all five domains (spec §8.3, §8.4).
      expect(byRule.has("TECH-HTTP-001")).toBe(true); // technical_seo
      expect(byRule.has("TECH-CANONICAL-002")).toBe(true); // technical_seo
      expect(byRule.has("TECH-LINKGRAPH-005")).toBe(true); // technical_seo
      expect(byRule.get("TECH-HTTP-001")?.ruleVersion).toBe(2);
      expect(byRule.get("TECH-CANONICAL-002")?.ruleVersion).toBe(2);
      expect(byRule.get("TECH-LINKGRAPH-005")?.ruleVersion).toBe(2);
      expect(byRule.has("SEARCH-CTR-004")).toBe(true); // search_performance
      expect(byRule.has("CONTENT-COVERAGE-001")).toBe(true); // content_intent
      expect(byRule.has("CRO-LANDING-003")).toBe(true); // conversion_journey
      expect(byRule.has("GEO-ENTITY-001")).toBe(true); // geo_ai

      const executableByDomain = new Map<string, number>();
      for (const result of findings.meta.ruleResults) {
        if (result.status !== "pass" && result.status !== "candidate") continue;
        executableByDomain.set(
          result.domain,
          (executableByDomain.get(result.domain) ?? 0) + 1,
        );
      }
      expect(Object.fromEntries(executableByDomain)).toMatchObject({
        technical_seo: expect.any(Number),
        search_performance: expect.any(Number),
        content_intent: expect.any(Number),
        conversion_journey: expect.any(Number),
        geo_ai: expect.any(Number),
      });
      expect([...executableByDomain.values()].every((count) => count >= 1)).toBe(
        true,
      );
      expect(findings.meta.latestRun?.status).toBe("completed");
      expect(findings.meta.coverage?.overall).toBe("complete");
      expect(findings.meta.coverage?.limitations).toEqual([]);

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

    it("persists the HTTP finding against its exact frozen Crawl page lineage", async () => {
      const targets = await new FindingTargetsRepository(
        handle.db,
      ).listForFindings(chain.scope, chain.diagRunId, [chain.httpFindingId]);
      expect(targets).toHaveLength(1);
      const target = targets[0]!;

      const observations = await new ObservationsRepository(
        handle.db,
      ).listBySnapshotIds(chain.scope, [chain.snapshotId]);
      const observation = observations.find(
        (candidate) => candidate.id === target.source_observation_id,
      );
      const frozenPages = await new PageSnapshotsRepository(
        handle.db,
      ).listByDataSnapshotWithSitePageIdentity(
        chain.scope,
        chain.snapshotId,
      );
      const frozenPage = frozenPages.find(
        (candidate) => candidate.page_snapshot_id === target.page_snapshot_id,
      );

      expect(target).toMatchObject({
        finding_id: chain.httpFindingId,
        diagnostic_run_id: chain.diagRunId,
        relation: "affected_by_http_status",
        target_kind: "http_status",
        target_ref: "404",
        resolution_state: "resolved",
        basis_kind: "crawl_exact_fetch",
        limitation: null,
      });
      expect(observation).toMatchObject({
        snapshot_id: chain.snapshotId,
        site_page_id: target.site_page_id,
        provider: "crawl",
        metric_key: METRIC_CRAWL_PAGE,
      });
      expect(frozenPage).toMatchObject({
        data_snapshot_id: chain.snapshotId,
        site_page_id: target.site_page_id,
        normalized_url: target.member_ref,
      });
    });

    it("AC-022: a separate missing-provider fixture is `partial` with precise skipped rules and no fabricated defects", () => {
      // A single skipped dataset rule makes the whole run partial (spec §8.6).
      expect(degradedFindings.meta.latestRun?.status).toBe("partial");

      const byRule = new Map(
        degradedFindings.meta.ruleResults.map((r) => [r.ruleId, r]),
      );
      // GSC/GA4/CSV are unavailable → their rules skip with `missing_dataset`;
      // they do NOT manufacture a finding (unavailable ≠ 0/defect, spec §1.3).
      expect(byRule.get("SEARCH-CTR-004")?.status).toBe("skipped");
      expect(byRule.get("SEARCH-CTR-004")?.reason).toBe("missing_dataset");
      expect(byRule.get("SEARCH-DECAY-002")?.status).toBe("skipped");
      // The crawl rule that CAN run still ran (crawl is available, not skipped).
      expect(byRule.get("TECH-HTTP-001")?.status).toBe("candidate");
      // No search/landing/gap finding was fabricated from the missing datasets.
      const ruleIds = new Set(degradedFindings.data.map((f) => f.ruleId));
      expect(ruleIds.has("SEARCH-CTR-004")).toBe(false);
      expect(ruleIds.has("SEARCH-DECAY-002")).toBe(false);

      // The coverage projection carries the honest per-dataset degradation strings.
      const limitations = degradedFindings.meta.coverage?.limitations ?? [];
      for (const expected of DEGRADATION_LIMITATIONS) {
        expect(limitations).toContain(expected);
      }
    });

    it("AC-025: replaying the same manifest command reuses one run, one queue job, and one Finding", async () => {
      const before = await handle.pool.query<{
        id: string;
        finding_key: string;
      }>(
        `SELECT id, finding_key
           FROM app.findings
          WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
        [
          chain.scope.workspaceId,
          chain.scope.projectId,
          chain.httpFindingId,
        ],
      );
      expect(before.rows).toHaveLength(1);

      const replay = await createDiagnosticRun(
        { workspaceId: chain.scope.workspaceId },
        chain.scope.projectId,
        chain.actor,
        chain.diagnosticIdempotencyKey,
        { snapshotIds: [...chain.snapshotIds], outputLocale: "en" },
      );

      expect(replay).toMatchObject({
        status: 202,
        replayed: true,
        run: { id: chain.diagRunId },
        resourceRef: { type: "diagnostic_run", id: chain.diagRunId },
      });
      expect(replay.location).toBe(replay.statusUrl);

      const boss = await getBoss();
      await expect(
        boss.findJobs<{ runId: string }>("diagnose", {
          data: { runId: chain.diagRunId },
        }),
      ).resolves.toHaveLength(1);

      const canonicalRows = await handle.pool.query<{
        async_count: number;
        diagnostic_count: number;
        finding_count: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM app.async_runs WHERE id = $1) AS async_count,
           (SELECT count(*)::int FROM app.diagnostic_runs WHERE id = $1) AS diagnostic_count,
           (SELECT count(*)::int
              FROM app.findings
             WHERE workspace_id = $2
               AND project_id = $3
               AND finding_key = $4) AS finding_count`,
        [
          chain.diagRunId,
          chain.scope.workspaceId,
          chain.scope.projectId,
          before.rows[0]!.finding_key,
        ],
      );
      expect(canonicalRows.rows[0]).toEqual({
        async_count: 1,
        diagnostic_count: 1,
        finding_count: 1,
      });

      const after = await handle.pool.query<{ id: string }>(
        `SELECT id
           FROM app.findings
          WHERE workspace_id = $1 AND project_id = $2 AND finding_key = $3`,
        [
          chain.scope.workspaceId,
          chain.scope.projectId,
          before.rows[0]!.finding_key,
        ],
      );
      expect(after.rows).toEqual([{ id: chain.httpFindingId }]);
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

    it("generates from the confirmed Action's frozen diagnosis after its Finding advances", async () => {
      const driftChain = await runCommonChain(
        handle,
        ctx,
        `b2b-action-lineage-${randomUUID().slice(0, 8)}`,
      );
      const diagnosticRuns = new DiagnosticRunsRepository(handle.db);
      const sourceRun = await diagnosticRuns.findById(
        driftChain.scope,
        driftChain.diagRunId,
      );
      const findingsRepo = new FindingsRepository(handle.db);
      const sourceFinding = await findingsRepo.findById(
        driftChain.scope,
        driftChain.httpFindingId,
      );
      if (!sourceRun || !sourceFinding) {
        throw new Error("lineage drift fixture did not persist its source rows");
      }

      const nonce = randomUUID();
      const asyncRuns = new AsyncRunsRepository(handle.db);
      const laterRun = await asyncRuns.insertQueued({
        workspaceId: driftChain.scope.workspaceId,
        projectId: driftChain.scope.projectId,
        kind: "diagnostic",
        activeKey: `diagnostic:lineage-drift:${nonce}`,
        initiatedBy: driftChain.actor,
        contractVersion: CONTRACT_VERSION,
        requestPayload: { lineageDriftFixture: nonce },
      });
      const frozenSnapshots = sourceRun.input_manifest["snapshots"];
      const frozenCrawl = Array.isArray(frozenSnapshots)
        ? frozenSnapshots.find(
            (entry) =>
              typeof entry === "object" &&
              entry !== null &&
              Reflect.get(entry, "provider") === "crawl",
          )
        : null;
      const frozenSnapshotId = frozenCrawl
        ? Reflect.get(frozenCrawl, "snapshotId")
        : null;
      if (typeof frozenSnapshotId !== "string") {
        throw new Error("lineage drift fixture has no frozen Crawl snapshot");
      }
      const frozenSnapshot = await new DataSnapshotsRepository(
        handle.db,
      ).findById(driftChain.scope, frozenSnapshotId);
      if (!frozenSnapshot) {
        throw new Error("lineage drift frozen Crawl snapshot is missing");
      }
      await diagnosticRuns.insert({
        runId: laterRun.id,
        workspaceId: driftChain.scope.workspaceId,
        projectId: driftChain.scope.projectId,
        siteId: sourceRun.site_id,
        icpProfileId: sourceRun.icp_profile_id,
        icpProfileVersion: sourceRun.icp_profile_version,
        ruleSetVersion: sourceRun.rule_set_version,
        promptSetVersion: sourceRun.prompt_set_version,
        outputLocale: sourceRun.output_locale,
        inputManifest: sourceRun.input_manifest,
        inputHash: sourceRun.input_hash,
      });
      const claimed = await asyncRuns.claim(driftChain.scope, laterRun.id);
      if (!claimed) throw new Error("lineage drift diagnostic was not claimable");

      const evidence = new EvidenceRepository(handle.db);
      const [laterEvidenceId] = await evidence.insertMany(
        {
          workspaceId: driftChain.scope.workspaceId,
          projectId: driftChain.scope.projectId,
          diagnosticRunId: laterRun.id,
        },
        [
          {
            sourceProvider: "crawl",
            origin: "direct_public",
            method: "observed",
            grade: "B",
            availability: "available",
            support: "supports",
            subjectRefs: sourceFinding.subject_refs,
            claim: "The later diagnostic observed the same canonical finding.",
            observedAt: frozenSnapshot.captured_at,
            limitation: "Isolated integration fixture for lineage drift.",
            snapshotId: frozenSnapshot.id,
            collectionRunId: frozenSnapshot.collection_run_id,
          },
        ],
      );
      await evidence.linkObservations(
        {
          workspaceId: driftChain.scope.workspaceId,
          projectId: driftChain.scope.projectId,
          diagnosticRunId: laterRun.id,
        },
        [
          {
            findingId: sourceFinding.id,
            evidenceId: laterEvidenceId!,
            role: "primary",
          },
        ],
      );
      await findingsRepo.touchSeen(sourceFinding.id, {
        ruleVersion: sourceFinding.rule_version,
        severity: sourceFinding.severity,
        confidence: sourceFinding.confidence,
        titleArgs: sourceFinding.title_args,
        summary: "A later diagnostic observed this finding again.",
        summaryLocale: sourceFinding.summary_locale,
        summaryInvocationId: sourceFinding.summary_invocation_id ?? null,
        subjectRefs: sourceFinding.subject_refs,
        runId: laterRun.id,
        seenAt: new Date(Date.now() + 1_000).toISOString(),
        regressed: false,
      });
      await asyncRuns.setTerminal(toRunAttempt(claimed), {
        status: "completed",
        resultType: "diagnostic_run",
        resultId: laterRun.id,
      });

      await expect(
        new ActionsRepository(handle.db).findById(
          driftChain.scope,
          driftChain.actionId,
        ),
      ).resolves.toMatchObject({
        source_finding_id: sourceFinding.id,
        source_diagnostic_run_id: sourceRun.id,
      });
      await expect(
        findingsRepo.findById(driftChain.scope, sourceFinding.id),
      ).resolves.toMatchObject({ last_seen_run_id: laterRun.id });

      const artifactBefore = await new ExecutionArtifactsRepository(
        handle.db,
      ).findById(driftChain.scope, driftChain.artifactId);
      const accepted = await createActionArtifact(
        { workspaceId: driftChain.scope.workspaceId },
        driftChain.scope.projectId,
        driftChain.actionId,
        driftChain.actor,
        randomUUID(),
        {
          artifactType: "technical_ticket",
          generationMode: "template",
          outputLocale: "en",
          operatorInstructions: null,
        },
      );
      const queued = await asyncRuns.findById(
        driftChain.scope,
        accepted.run.id,
      );
      expect(queued?.request_payload).toMatchObject({
        sourceDiagnosticRunId: sourceRun.id,
        sourceIcpProfileId: sourceRun.icp_profile_id,
      });
      await runArtifact(ctx, {
        runId: accepted.run.id,
        workspaceId: driftChain.scope.workspaceId,
        projectId: driftChain.scope.projectId,
      });
      await expect(
        new ExecutionArtifactsRepository(handle.db).findById(
          driftChain.scope,
          driftChain.artifactId,
        ),
      ).resolves.toMatchObject({
        current_revision: (artifactBefore?.current_revision ?? 0) + 1,
        latest_generation_run_id: accepted.run.id,
        status: "draft",
      });
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

    it("replays artifact creation for the same Idempotency-Key + request", async () => {
      const projects = new ProjectsRepository(handle.db);
      await expect(
        projects.findById(
          { workspaceId: chain.scope.workspaceId },
          chain.scope.projectId,
        ),
      ).resolves.toMatchObject({ stage: "executing" });

      // A replay must return before the create transaction, including its
      // server-owned stage transition. Moving the project back gives the test
      // an observable guard against accidentally re-running that side effect.
      await projects.setStage(
        { workspaceId: chain.scope.workspaceId },
        chain.scope.projectId,
        "planning",
      );
      const replay = await createActionArtifact(
        { workspaceId: chain.scope.workspaceId },
        chain.scope.projectId,
        chain.actionId,
        chain.actor,
        chain.artifactIdempotencyKey,
        {
          artifactType: "technical_ticket",
          generationMode: "template",
          outputLocale: "en",
          operatorInstructions: null,
        },
      );

      expect(replay.run.id).toBe(chain.artifactRunId);
      expect(replay.resourceRef).toEqual({
        type: "artifact",
        id: chain.artifactId,
      });
      await expect(
        projects.findById(
          { workspaceId: chain.scope.workspaceId },
          chain.scope.projectId,
        ),
      ).resolves.toMatchObject({ stage: "planning" });
    });

    it("rejects artifact Idempotency-Key reuse with a different request as a 409 problem", async () => {
      const promise = createActionArtifact(
        { workspaceId: chain.scope.workspaceId },
        chain.scope.projectId,
        chain.actionId,
        chain.actor,
        chain.artifactIdempotencyKey,
        {
          artifactType: "technical_ticket",
          generationMode: "structured_llm",
          outputLocale: "en",
          operatorInstructions: null,
        },
      );
      await expect(promise).rejects.toBeInstanceOf(ProblemError);
      await expect(promise).rejects.toMatchObject({
        status: 409,
        code: "IDEMPOTENCY_KEY_REUSED",
      });
    });

    it("replays export creation and uses the OpenAPI `export` resource literal", async () => {
      const replay = await createProjectExport(
        { workspaceId: chain.scope.workspaceId },
        chain.scope.projectId,
        chain.actor,
        serviceBundle.idempotencyKey,
        { kind: "service_bundle", outputLocale: "en" },
      );

      expect(serviceBundle.resourceRefType).toBe("export");
      expect(replay.run.id).toBe(serviceBundle.runId);
      expect(replay.resourceRef).toEqual({
        type: "export",
        id: serviceBundle.row.id,
      });
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
        "signalframe.service-bundle.0.3.0",
      );
      expect(serviceBundle.manifest["ruleSetVersion"]).toBe(RULE_SET_VERSION);
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

    it.each(ARTIFACT_ACCEPTANCE_CASES)(
      "AC-031: $artifactType create is 202/statusUrl and the real worker persists draft revision 1",
      async ({
        artifactType,
        templateId,
        sourceRuleId,
        expectedFormat,
        risk,
      }) => {
        const sourceFinding = findings.data.find(
          (finding) => finding.ruleId === sourceRuleId,
        );
        if (!sourceFinding) {
          throw new Error(`golden fixture did not trip ${sourceRuleId}`);
        }
        const sourceFindingRow = await new FindingsRepository(
          handle.db,
        ).findById(chain.scope, sourceFinding.id);
        if (!sourceFindingRow) {
          throw new Error(`source finding ${sourceFinding.id} was not persisted`);
        }
        const action = await new ActionsRepository(handle.db).insert({
          workspaceId: chain.scope.workspaceId,
          projectId: chain.scope.projectId,
          sourceFindingId: sourceFinding.id,
          sourceDiagnosticRunId: sourceFindingRow.last_seen_run_id,
          actionKey: contentHash({
            acceptance: "AC-031",
            projectId: chain.scope.projectId,
            artifactType,
            nonce: randomUUID(),
          }),
          templateId,
          templateVersion: 1,
          title: `Generate ${artifactType}`,
          description: `Produce the ${artifactType} acceptance fixture.`,
          contentLocale: "en",
          priorityBand: "high",
          roadmapLane: "now",
          status: "planned",
          effort: "medium",
          risk,
          expectedOutcome: `A valid ${artifactType} is available for review.`,
          evidenceRefs: [],
          createdBy: chain.actor,
        });

        const accepted = await createActionArtifact(
          { workspaceId: chain.scope.workspaceId },
          chain.scope.projectId,
          action.id,
          chain.actor,
          randomUUID(),
          {
            artifactType,
            generationMode: "template",
            outputLocale: "en",
            operatorInstructions: null,
          },
        );

        expect(accepted.status).toBe(202);
        expect(accepted.statusUrl).toBe(
          `/api/mvp/projects/${chain.scope.projectId}/runs/${accepted.run.id}`,
        );
        expect(accepted.location).toBe(accepted.statusUrl);
        expect(accepted.resourceRef.type).toBe("artifact");
        await expect(
          (await getBoss()).findJobs<{ runId: string }>("artifact.generate", {
            data: { runId: accepted.run.id },
          }),
        ).resolves.toHaveLength(1);

        await runArtifact(ctx, {
          runId: accepted.run.id,
          workspaceId: chain.scope.workspaceId,
          projectId: chain.scope.projectId,
        });

        const repo = new ExecutionArtifactsRepository(handle.db);
        const stored = await repo.findById(
          chain.scope,
          accepted.resourceRef.id,
        );
        expect(stored).toMatchObject({
          artifact_type: artifactType,
          status: "draft",
          current_revision: 1,
          validation_state: "valid",
        });
        const revisions = await repo.listRevisions(
          chain.scope,
          accepted.resourceRef.id,
        );
        expect(revisions).toHaveLength(1);
        expect(revisions[0]).toMatchObject({
          revision: 1,
          content_format: expectedFormat,
          generated_by: "template",
          validation_errors: [],
        });
        const run = await new AsyncRunsRepository(handle.db).findById(
          chain.scope,
          accepted.run.id,
        );
        expect(run).toMatchObject({
          status: "completed",
          result_type: "artifact",
          result_id: accepted.resourceRef.id,
        });
      },
    );

    it("stores the actual mode requested by a regeneration", async () => {
      const regenerated = await createActionArtifact(
        { workspaceId: chain.scope.workspaceId },
        chain.scope.projectId,
        chain.actionId,
        chain.actor,
        randomUUID(),
        {
          artifactType: "technical_ticket",
          generationMode: "structured_llm",
          outputLocale: "zh-CN",
          operatorInstructions: "Regenerate for operator review.",
        },
      );

      expect(regenerated.resourceRef).toEqual({
        type: "artifact",
        id: chain.artifactId,
      });
      const stored = await new ExecutionArtifactsRepository(handle.db).findById(
        chain.scope,
        chain.artifactId,
      );
      expect(stored?.generation_mode).toBe("structured_llm");
      expect(stored?.output_locale).toBe("zh-CN");
      await expect(
        new ProjectsRepository(handle.db).findById(
          { workspaceId: chain.scope.workspaceId },
          chain.scope.projectId,
        ),
      ).resolves.toMatchObject({ stage: "executing" });
    });
  },
);

// pg-boss is enqueue-only per test file; stop it after this vertical.
afterAll(async () => {
  await stopSharedBoss();
});
