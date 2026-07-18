import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DB_AVAILABLE,
  DATABASE_URL,
  DEGRADATION_LIMITATIONS,
  MANIFEST_SCHEMA,
  buildCtx,
  createDbHandle,
  getProjectReport,
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
 * AC-045 — B2C full vertical: the same seed → diagnose → confirm → artifact chain
 * as the B2B vertical, then assert the CLIENT projection. getProjectReport returns
 * a client-safe report (only confirmed findings, honest limitation strings, no
 * internal-only fields), and createProjectExport({kind:"client_bundle"}) →
 * runExport produces a bundle that EXCLUDES the internal-only sections a
 * service_bundle carries (spec §10.5). AC-022 degradation strings are asserted on
 * the client report too. Both bundles run from the same canonical state so the
 * exclusions are a real diff.
 */

const describeDb = DB_AVAILABLE ? describe : describe.skip;

describeDb(
  "AC-045 B2C full vertical → client report + client_bundle (spec §10.4, §10.5)",
  () => {
    let handle: DbHandle;
    let ctx: WorkerContext;
    let chain: ChainResult;
    let report: Awaited<ReturnType<typeof getProjectReport>>;
    let clientBundle: ExportChainResult;
    let serviceBundle: ExportChainResult;

    beforeAll(async () => {
      handle = createDbHandle(DATABASE_URL);
      ctx = buildCtx(handle);
      chain = await runCommonChain(handle, ctx, "b2c");
      report = await getProjectReport(
        { workspaceId: chain.scope.workspaceId },
        chain.scope.projectId,
        "en",
        "2026-07-18T00:00:00.000Z",
      );
      // Both bundles from the SAME canonical state so exclusions are a real diff.
      clientBundle = await runExportChain(
        handle,
        ctx,
        chain.scope,
        chain.actor,
        "client_bundle",
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

    it("the client report is a client-safe projection: only confirmed findings, honest limitations, no internal-only fields", () => {
      // AC-036: the client sees ONLY confirmed + active findings (never the raw
      // unreviewed candidates that fill the operator's list).
      expect(report.findings.length).toBe(1);
      expect(report.findings.every((f) => f.reviewState === "confirmed")).toBe(
        true,
      );
      expect(report.findings[0]?.ruleId).toBe("TECH-HTTP-001");

      // Findings carry per-evidence limitation strings (spec §10.4 honesty).
      for (const f of report.findings) {
        expect(f.evidence.length).toBeGreaterThan(0);
        expect(f.evidence.every((e) => e.limitation.length > 0)).toBe(true);
      }
      // The methodology disclaimer never promises a result/ranking/revenue outcome.
      expect(report.methodology).toMatch(
        /no result, ranking, or revenue outcome/i,
      );

      // No internal-only fields leak: the reserved priority-relevance flag is
      // stripped, and there is no raw-observation section on the client view.
      for (const f of report.findings) {
        expect(Object.keys(f.titleArgs)).not.toContain("__priorityRelevant");
      }
      expect(
        (report as unknown as Record<string, unknown>)["observations"],
      ).toBeUndefined();
      // Draft artifacts stay out of the client view (only READY are projected).
      expect(report.artifacts.length).toBe(0);
    });

    it("AC-022: the client report echoes the honest degradation limitations for the unavailable datasets", () => {
      for (const expected of DEGRADATION_LIMITATIONS) {
        expect(report.limitations).toContain(expected);
      }
      expect(report.limitations).toEqual(report.coverage.limitations);
    });

    it("both bundles finalize and both manifests validate against the schema", () => {
      expect(clientBundle.runStatus).toBe("completed");
      expect(serviceBundle.runStatus).toBe("completed");
      expect(validateManifest(clientBundle.manifest, MANIFEST_SCHEMA)).toEqual(
        [],
      );
      expect(validateManifest(serviceBundle.manifest, MANIFEST_SCHEMA)).toEqual(
        [],
      );
      expect(clientBundle.manifest["kind"]).toBe("client_bundle");
      expect(serviceBundle.manifest["kind"]).toBe("service_bundle");
    });

    it("the client_bundle EXCLUDES the internal-only sections the service_bundle carries (spec §10.5)", () => {
      const clientPaths = manifestFilePaths(clientBundle.manifest);
      const servicePaths = manifestFilePaths(serviceBundle.manifest);

      // The raw internal observation ledger is service-only.
      expect(servicePaths).toContain("observations.ndjson");
      expect(clientPaths).not.toContain("observations.ndjson");
      expect(
        manifestItemCount(serviceBundle.manifest, "observations"),
      ).toBeGreaterThan(0);
      expect(manifestItemCount(clientBundle.manifest, "observations")).toBe(0);

      // Draft (non-ready) artifacts are excluded from the client bundle; the
      // service bundle carries the same draft artifact.
      expect(manifestItemCount(serviceBundle.manifest, "artifacts")).toBe(1);
      expect(manifestItemCount(clientBundle.manifest, "artifacts")).toBe(0);
      expect(
        manifestItemCount(clientBundle.manifest, "artifactRevisions"),
      ).toBe(0);
      expect(clientPaths.some((p) => p.startsWith("artifacts/"))).toBe(false);

      // The client bundle still carries the client-safe sections (no over-strip).
      expect(clientPaths).toContain("findings.json");
      expect(clientPaths).toContain("actions.json");
    });
  },
);

// pg-boss is enqueue-only per test file; stop it after this vertical.
afterAll(async () => {
  await stopSharedBoss();
});
