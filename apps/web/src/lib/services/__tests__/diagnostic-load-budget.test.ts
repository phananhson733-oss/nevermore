import { EvidenceRepository, type DbTx } from "@sf/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEvidenceByFinding } from "@/lib/services/diagnostic-load";

const SCOPE = { workspaceId: "workspace", projectId: "project" };
const EXECUTOR = {} as DbTx;

describe("diagnostic evidence loading", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads large finding and evidence id sets in fixed-size batches", async () => {
    const findingIds = Array.from(
      { length: 1_001 },
      (_, index) => `finding-${index}`,
    );
    const listSpy = vi
      .spyOn(EvidenceRepository.prototype, "listForFindings")
      .mockImplementation(async (_scope, batch) =>
        batch.map((findingId) => ({
          finding_id: findingId,
          evidence_id: `evidence-${findingId}`,
          role: "primary",
        })),
      );
    const findSpy = vi
      .spyOn(EvidenceRepository.prototype, "findByIds")
      .mockImplementation(async (_scope, batch) =>
        batch.map((id) => ({
          id,
          diagnostic_run_id: "diagnostic-1",
          source_provider: "crawl",
          origin: "observed",
          method: "deterministic",
          grade: "a",
          availability: "available",
          support: "supports",
          subject_refs: [],
          claim: `Claim for ${id}`,
          observed_at: "2026-07-19T00:00:00.000Z",
          limitation: "",
          snapshot_id: null,
          analysis_invocation_id: null,
        })),
      );

    const result = await loadEvidenceByFinding(EXECUTOR, SCOPE, findingIds);

    expect(result).toHaveLength(1_001);
    expect(listSpy.mock.calls.length).toBeGreaterThan(1);
    expect(findSpy.mock.calls.length).toBeGreaterThan(1);
    expect(listSpy.mock.calls.every((call) => call[1].length <= 500)).toBe(true);
    expect(findSpy.mock.calls.every((call) => call[1].length <= 500)).toBe(true);
  });

  it("uses one overflow row to fail closed before link fan-out exceeds its budget", async () => {
    const listSpy = vi
      .spyOn(EvidenceRepository.prototype, "listForFindings")
      .mockResolvedValue([
        { finding_id: "finding-1", evidence_id: "evidence-1", role: "primary" },
        { finding_id: "finding-1", evidence_id: "evidence-2", role: "supporting" },
        { finding_id: "finding-1", evidence_id: "evidence-3", role: "context" },
      ]);
    const findSpy = vi
      .spyOn(EvidenceRepository.prototype, "findByIds")
      .mockResolvedValue([]);
    const onExceeded = vi.fn((): never => {
      throw new Error("bounded evidence fan-out");
    });

    await expect(
      loadEvidenceByFinding(EXECUTOR, SCOPE, ["finding-1"], {
        maxLinks: 2,
        maxEvidenceRows: 2,
        maxEvidenceBytes: 1_024,
        onExceeded,
      }),
    ).rejects.toThrow("bounded evidence fan-out");

    expect(listSpy).toHaveBeenCalledWith(SCOPE, ["finding-1"], { maxRows: 3 });
    expect(onExceeded).toHaveBeenCalledOnce();
    expect(findSpy).not.toHaveBeenCalled();
  });
});
