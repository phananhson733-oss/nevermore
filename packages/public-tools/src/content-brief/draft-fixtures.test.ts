// @input  -- the draft fixture in its first-run and rerun shapes
// @output -- proof both shapes pass the draft parser, and that the rerun shape carries the
//            section endpoint's semantics (budget, reran_from, a one-call aggregate)
// @pos    -- keeps the shared fixture honest: a UI or e2e test built on it is built on a
//            DraftResult the parser would accept from the real endpoint
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import { DRAFT_TOTAL_BUDGET_MS, SECTION_ENDPOINT_BUDGET_MS } from "./constants.ts";
import {
  DRAFT_FIXTURE_RERUN_ID,
  DRAFT_FIXTURE_RUN_ID,
  draftBrief,
  draftResultFixture,
  fixtureCallOf,
} from "./draft-fixtures.ts";
import { aggregateSectionLlm } from "./draft-assemble.ts";
import { parseDraftResult } from "./parse-draft.ts";

const brief = await draftBrief();

describe("draftResultFixture", () => {
  it("passes the draft parser as a first run", async () => {
    const result = await draftResultFixture(brief, { failSection: "O2" });
    expect(result.run.reran_from).toBeNull();
    expect(result.run.budget_ms).toBe(DRAFT_TOTAL_BUDGET_MS);
    expect((await parseDraftResult(result, brief)).ok).toBe(true);
  });

  it("passes the draft parser as a section rerun, reflecting only the one section's call", async () => {
    const first = await draftResultFixture(brief, { failSection: "O2" });
    const rerun = await draftResultFixture(brief, { rerun: { previousRunId: first.run.run_id, sectionId: "O2" } });
    expect(rerun.run.run_id).toBe(DRAFT_FIXTURE_RERUN_ID);
    expect(rerun.run.run_id).not.toBe(DRAFT_FIXTURE_RUN_ID);
    expect(rerun.run.reran_from).toBe(first.run.run_id);
    expect(rerun.run.budget_ms).toBe(SECTION_ENDPOINT_BUDGET_MS);
    const section = rerun.sections.find((candidate) => candidate.id === "O2");
    if (section === undefined) throw new Error("O2 missing");
    const call = fixtureCallOf(section);
    if (call === null) throw new Error("O2 made no call");
    expect(rerun.run.reads.llm_sections).toEqual(aggregateSectionLlm([call], call.temperature_requested));
    expect(rerun.run.reads.llm_sections.calls).toBe(section.status === "ok" ? section.llm.attempts : 0);
    const parsed = await parseDraftResult(rerun, brief);
    expect(parsed.ok, parsed.ok ? "" : `${parsed.code} at ${parsed.path}`).toBe(true);
  });

  it("also passes the parser when the rerun leaves the coverage check unavailable", async () => {
    const rerun = await draftResultFixture(brief, {
      rerun: { previousRunId: DRAFT_FIXTURE_RUN_ID, sectionId: "O1" },
      coverage: "unavailable",
    });
    expect(rerun.coverage.status).toBe("unavailable");
    expect(rerun.run.mode).toBe("degraded");
    const parsed = await parseDraftResult(rerun, brief);
    expect(parsed.ok, parsed.ok ? "" : `${parsed.code} at ${parsed.path}`).toBe(true);
  });

  it("refuses to rerun a skipped section", async () => {
    await expect(
      draftResultFixture(brief, { skipSection: "O3", rerun: { previousRunId: DRAFT_FIXTURE_RUN_ID, sectionId: "O3" } }),
    ).rejects.toThrow(/skipped/);
  });
});
