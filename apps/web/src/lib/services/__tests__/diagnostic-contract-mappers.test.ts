import { describe, expect, it } from "vitest";
import {
  toEvidenceDto,
  toRuleResultDto,
  type EvidenceRowLike,
} from "@/lib/services/diagnostic-mappers";

describe("diagnostic API contract mappers", () => {
  it("preserves exact source-backed snapshot and collection-run lineage", () => {
    const row: EvidenceRowLike = {
      id: "00000000-0000-4000-8000-000000000001",
      source_provider: "crawl",
      origin: "direct_public",
      method: "observed",
      grade: "B",
      availability: "available",
      support: "supports",
      subject_refs: ["https://example.com/pricing"],
      claim: "The pricing page needs a clearer comparison.",
      observed_at: "2026-07-18T12:00:00.000Z",
      limitation: "Public HTTP response from one immutable crawl.",
      snapshot_id: "00000000-0000-4000-8000-000000000002",
      collection_run_id: "00000000-0000-4000-8000-000000000003",
      analysis_invocation_id: null,
    };

    expect(toEvidenceDto(row)).toMatchObject({
      snapshotId: row.snapshot_id,
      collectionRunId: row.collection_run_id,
      analysisInvocationId: row.analysis_invocation_id,
    });
  });

  it("preserves LLM invocation lineage without inventing source lineage", () => {
    const row: EvidenceRowLike = {
      id: "00000000-0000-4000-8000-000000000004",
      source_provider: "llm",
      origin: "generated",
      method: "generated",
      grade: "C",
      availability: "available",
      support: "supports",
      subject_refs: ["https://example.com/pricing"],
      claim: "The pricing page needs a clearer comparison.",
      observed_at: "2026-07-18T12:00:00.000Z",
      limitation: "Generated analysis; validate before acting.",
      snapshot_id: null,
      collection_run_id: null,
      analysis_invocation_id: "00000000-0000-4000-8000-000000000005",
    };

    expect(toEvidenceDto(row)).toMatchObject({
      snapshotId: null,
      collectionRunId: null,
      analysisInvocationId: row.analysis_invocation_id,
    });
  });

  it("keeps absent evidence lineage explicitly null", () => {
    const row: EvidenceRowLike = {
      id: "00000000-0000-4000-8000-000000000006",
      source_provider: "system",
      origin: "derived",
      method: "computed",
      grade: "B",
      availability: "partial",
      support: "context",
      subject_refs: ["site:example.com"],
      claim: "Coverage is partial.",
      observed_at: "2026-07-18T12:00:00.000Z",
      limitation: "Only connected sources were evaluated.",
      snapshot_id: null,
      collection_run_id: null,
      analysis_invocation_id: null,
    };

    expect(toEvidenceDto(row)).toMatchObject({
      snapshotId: null,
      collectionRunId: null,
      analysisInvocationId: null,
    });
  });

  it("maps the persisted rule duration instead of fabricating zero", () => {
    expect(
      toRuleResultDto({
        rule_id: "TECH-HTTP-001",
        rule_version: 1,
        domain: "technical_seo",
        status: "candidate",
        reason: null,
        duration_ms: 37,
      }),
    ).toEqual({
      ruleId: "TECH-HTTP-001",
      ruleVersion: 1,
      domain: "technical_seo",
      status: "candidate",
      reason: null,
      durationMs: 37,
    });
  });
});
