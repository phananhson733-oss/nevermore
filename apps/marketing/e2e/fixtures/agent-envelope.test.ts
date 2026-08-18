// @input  -- the envelope the Playwright route mock serves
// @output -- a failing test when the app would refuse it
// @pos    -- the reason a stale e2e mock cannot sit unnoticed for two releases
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import { isAgentAuditSuccessEnvelope } from "../../src/lib/agents/audit-contract";
import { agentEnvelope } from "./agent-envelope";

/**
 * A positive mock has to be one the app accepts, or it proves the opposite.
 *
 * The previous fixture carried seventeen of the contract's twenty-four record
 * ids and a schema version two releases old, so both browser tests were
 * asserting that the app renders an envelope its own guard rejects. Nothing
 * said so: Playwright is not in `pnpm test` and CI runs on request. This test
 * is, which is the point of it.
 */
describe("the Agent envelope the browser tests serve", () => {
  it.each(["seo", "tech"] as const)("%s is one the app accepts", (agent) => {
    expect(isAgentAuditSuccessEnvelope(agentEnvelope(agent))).toBe(true);
  });

  it("would have refused the version the mock used to claim", () => {
    const stale = structuredClone(agentEnvelope("seo")) as {
      data: { run: { source: { schemaVersion: string } } };
    };
    stale.data.run.source.schemaVersion = "seo_audit.sitewide.v5";
    expect(isAgentAuditSuccessEnvelope(stale)).toBe(false);
  });

  it("would have refused the partial ledger the mock used to carry", () => {
    const partial = structuredClone(agentEnvelope("seo")) as {
      data: { result: { records: unknown[] } };
    };
    partial.data.result.records = partial.data.result.records.slice(0, 17);
    expect(isAgentAuditSuccessEnvelope(partial)).toBe(false);
  });
});
