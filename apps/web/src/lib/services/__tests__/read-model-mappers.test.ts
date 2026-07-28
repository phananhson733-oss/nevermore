import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  type ActionRow,
  type ArtifactRevisionRow,
  type ArtifactRow,
  type AsyncRunRow,
  type FindingRow,
} from "@sf/db";
import { ProblemError } from "@sf/observability";

vi.mock("@/lib/db", () => ({ getDb: () => ({ db: {} }) }));

import {
  toArtifactDto,
  toArtifactRevisionDto,
} from "../artifact-mappers.ts";
import {
  parseSubjectRef,
  toActionDto,
  toCoverageDto,
  toEvidenceDto,
  toFindingDto,
} from "../diagnostic-mappers.ts";
import {
  getProjectRun,
  runStatusUrl,
  toAsyncRunDto,
} from "../runs.ts";

const run = {
  id: "run-1",
  workspace_id: "workspace-1",
  project_id: "project-1",
  kind: "diagnostic",
  status: "running",
  active_key: "diagnostic",
  contract_version: "2026-07-21",
  request_payload: {},
  progress: {
    phase: "rules",
    current: 2,
    total: 5,
    messageKey: "run.rules",
  },
  last_error_code: null,
  last_error_summary: null,
  result_type: null,
  result_id: null,
  attempt_count: 1,
  initiated_by: "user-1",
  queued_at: "2026-07-18T10:00:00.000Z",
  started_at: "2026-07-18T10:00:01.000Z",
  completed_at: null,
  created_at: "2026-07-18T10:00:00.000Z",
  updated_at: "2026-07-18T10:00:01.000Z",
} as AsyncRunRow;

describe("diagnostic read-model mappers", () => {
  it("classifies URL and supported typed subject references", () => {
    expect(parseSubjectRef("https://example.com/pricing")).toEqual({
      type: "url",
      value: "https://example.com/pricing",
    });
    expect(parseSubjectRef("http_status:503")).toEqual({
      type: "http_status",
      value: "503",
    });
    expect(
      parseSubjectRef("competitor:20000000-0000-4000-8000-000000004001"),
    ).toEqual({
      type: "competitor",
      value: "20000000-0000-4000-8000-000000004001",
    });
    expect(() => parseSubjectRef("unknown:value")).toThrow(
      "unsupported subject reference type",
    );
    expect(() => parseSubjectRef("competitor:not-a-uuid")).toThrow(
      "invalid competitor subject reference",
    );
    expect(parseSubjectRef("/pricing")).toEqual({
      type: "url",
      value: "/pricing",
    });
  });

  it("maps evidence lineage and drops malformed subject references", () => {
    expect(
      toEvidenceDto({
        id: "evidence-1",
        source_provider: "crawl",
        origin: "observed",
        method: "deterministic",
        grade: "A",
        availability: "available",
        support: "supports",
        subject_refs: ["site:example.com", 42, null],
        claim: "The site was crawled.",
        observed_at: "2026-07-18T10:00:00.000Z",
        limitation: "Static HTML only",
        snapshot_id: "snapshot-1",
        analysis_invocation_id: null,
      }),
    ).toMatchObject({
      subjectRefs: [{ type: "site", value: "example.com" }],
      snapshotId: "snapshot-1",
      analysisInvocationId: null,
    });
  });

  it("strips private title metadata while retaining public finding fields", () => {
    const finding = {
      id: "finding-1",
      workspace_id: "workspace-1",
      project_id: "project-1",
      finding_key: "finding-key-1",
      rule_id: "technical.http_status",
      rule_version: 2,
      rule_family: "technical",
      intent: "fix",
      domain: "technical",
      title_key: "finding.httpStatus",
      title_args: { status: 503, __priorityRelevant: true },
      summary: "A page failed.",
      summary_locale: "en",
      severity: "high",
      confidence: "high",
      review_state: "confirmed",
      review_revision: 2,
      review_reason: "verified",
      review_note: null,
      active: true,
      regressed: false,
      subject_refs: ["https://example.com/pricing", false],
      first_seen_at: "2026-07-18T10:00:00.000Z",
      last_seen_at: "2026-07-18T10:00:00.000Z",
      first_seen_run_id: "run-1",
      last_seen_run_id: "run-1",
      resolved_at: null,
      created_at: "2026-07-18T10:00:00.000Z",
      updated_at: "2026-07-18T10:00:00.000Z",
    } as unknown as FindingRow;
    const evidence = toEvidenceDto({
      id: "evidence-1",
      source_provider: "crawl",
      origin: "observed",
      method: "deterministic",
      grade: "A",
      availability: "available",
      support: "supports",
      subject_refs: [],
      claim: "Observed",
      observed_at: "2026-07-18T10:00:00.000Z",
      limitation: "None",
      snapshot_id: "snapshot-1",
      analysis_invocation_id: null,
    });
    expect(toFindingDto(finding, [evidence])).toMatchObject({
      titleArgs: { status: 503 },
      evidence: [evidence],
      subjectRefs: [
        { type: "url", value: "https://example.com/pricing" },
      ],
    });
  });

  it("normalizes every coverage availability and malformed values", () => {
    expect(
      toCoverageDto({
        overall: "available",
        domains: {
          crawl: "available",
          gsc: "partial",
          ga4: "qualitative",
          csv: "unavailable",
          malformed: 123,
        },
        limitations: ["GSC disconnected", 42],
      }),
    ).toEqual({
      overall: "complete",
      domains: {
        crawl: "complete",
        gsc: "partial",
        ga4: "qualitative",
        csv: "unavailable",
        malformed: "unavailable",
      },
      limitations: ["GSC disconnected"],
    });
    expect(
      toCoverageDto({
        overall: "partial",
        domains: null,
        limitations: "not-an-array",
      }),
    ).toEqual({ overall: "partial", domains: {}, limitations: [] });
    expect(toCoverageDto({ overall: 42 })).toEqual({
      overall: "unavailable",
      domains: {},
      limitations: [],
    });
  });

  it("maps the complete action projection", () => {
    const action = {
      id: "action-1",
      source_finding_id: "finding-1",
      source_diagnostic_run_id: "diagnostic-run-1",
      template_id: "template-1",
      title: "Fix the page",
      description: "Restore the page",
      content_locale: "en",
      priority_band: "p0",
      roadmap_lane: "now",
      status: "accepted",
      effort: "s",
      risk: "low",
      expected_outcome: "Page is available",
      revision: 3,
      created_at: "2026-07-18T10:00:00.000Z",
      updated_at: "2026-07-18T11:00:00.000Z",
    } as ActionRow;
    expect(toActionDto(action)).toMatchObject({
      findingId: "finding-1",
      contentLocale: "en",
      revision: 3,
    });
  });
});

describe("artifact and run read-model mappers", () => {
  const textRevision = {
    id: "revision-1",
    revision: 1,
    output_locale: "en",
    content_format: "markdown",
    content_text: "# Brief",
    content_json: null,
    content_hash: "hash-1",
    validation_errors: ["Missing CTA", 42],
    note: null,
    created_at: "2026-07-18T11:00:00.000Z",
  } as ArtifactRevisionRow;

  const artifact = {
    id: "artifact-1",
    action_id: "action-1",
    artifact_type: "content_brief",
    status: "draft",
    generation_mode: "template",
    output_locale: "en",
    current_revision: 1,
    validation_state: "invalid",
    created_at: "2026-07-18T10:00:00.000Z",
    updated_at: "2026-07-18T11:00:00.000Z",
  } as ArtifactRow;

  it("chooses text, JSON, then an empty object for revision content", () => {
    expect(toArtifactRevisionDto(textRevision)).toMatchObject({
      outputLocale: "en",
      content: "# Brief",
      validationErrors: ["Missing CTA"],
    });
    expect(
      toArtifactRevisionDto({
        ...textRevision,
        content_text: null,
        content_json: { title: "Pricing" },
      }),
    ).toMatchObject({ content: { title: "Pricing" } });
    expect(
      toArtifactRevisionDto({
        ...textRevision,
        content_text: null,
        content_json: null,
      }),
    ).toMatchObject({ content: {} });
  });

  it("maps optional artifact revision and active run projections", () => {
    // The read model carries the adoption judgement so a control can be
    // disabled BEFORE it is clicked; `null` means the type has no such gate.
    expect(
      toArtifactDto(artifact, textRevision, run, {
        blocked: true,
        blockingClaimIds: ["content-shadow.qa.rl12_citation_integrity"],
      }),
    ).toMatchObject({
      adoption: {
        blocked: true,
        blockingClaimIds: ["content-shadow.qa.rl12_citation_integrity"],
      },
    });
    expect(toArtifactDto(artifact, textRevision, run, null).adoption).toBeNull();
    expect(toArtifactDto(artifact, textRevision, run, null)).toMatchObject({
      current: { id: "revision-1" },
      activeRun: { id: "run-1", status: "running" },
    });
    expect(toArtifactDto(artifact, null, null, null)).toMatchObject({
      current: null,
      activeRun: null,
    });
  });

  it("normalizes run progress, errors, results, and defaults", () => {
    expect(toAsyncRunDto(run)).toMatchObject({
      progress: {
        phase: "rules",
        current: 2,
        total: 5,
        messageKey: "run.rules",
      },
      lastError: null,
      resultRef: null,
    });
    expect(
      toAsyncRunDto({
        ...run,
        status: "failed",
        progress: { phase: 1, current: "two", total: false, messageKey: null },
        last_error_code: "RULE_FAILURE",
        last_error_summary: null,
        result_type: "diagnostic",
        result_id: "diagnostic-1",
      }),
    ).toMatchObject({
      progress: {
        phase: "queued",
        current: 0,
        total: null,
        messageKey: "run.queued",
      },
      lastError: { code: "RULE_FAILURE", summary: "" },
      resultRef: { type: "diagnostic", id: "diagnostic-1" },
    });
    expect(
      toAsyncRunDto({ ...run, result_type: "diagnostic", result_id: null }),
    ).toMatchObject({ resultRef: null });
    expect(runStatusUrl("project one", "run/two")).toBe(
      "/api/mvp/projects/project one/runs/run/two",
    );
  });

  it("loads scoped runs and returns a non-enumerating 404", async () => {
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValueOnce(
      run,
    );
    await expect(
      getProjectRun({ workspaceId: "workspace-1" }, "project-1", "run-1"),
    ).resolves.toMatchObject({ id: "run-1" });

    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValueOnce(
      null,
    );
    const missing = getProjectRun(
      { workspaceId: "workspace-1" },
      "project-1",
      "missing",
    );
    await expect(missing).rejects.toBeInstanceOf(ProblemError);
    await expect(missing).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  beforeEach(() => vi.restoreAllMocks());
});
