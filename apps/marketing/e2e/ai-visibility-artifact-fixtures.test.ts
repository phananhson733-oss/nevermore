import { describe, expect, it } from "vitest";
import { handleVisibilityContext } from "../src/lib/geo-tools/visibility-context-handler.ts";
import { parseVisibilityContext } from "../src/lib/geo-tools/visibility-context.ts";
import { listVisibilityHistory, readVisibilityHistory } from "../src/lib/geo-tools/visibility-history.ts";
import { exportVisibilityJson, parseVisibilityImport } from "../src/lib/geo-tools/visibility-export.ts";
import { GEO_CHAIN_USER } from "./geo-chain-fixtures.ts";
import { ARTIFACT_LEGACY_RUN, ARTIFACT_CURRENT_RUN, createVisibilityArtifactFixture } from "./ai-visibility-artifact-fixtures.ts";

describe("provider-free AI Visibility browser fixtures", () => {
  it.each(["partial", "insufficient"] as const)("derives %s from actual failed samples without rewriting manifest status", async outcome => {
    const fixture = await createVisibilityArtifactFixture(outcome);
    expect(fixture.current.manifest.status).toBe(outcome);
    expect(fixture.current.byEngine.find(engine => engine.engine === "perplexity")?.status).toBe("insufficient");
    expect(parseVisibilityImport(exportVisibilityJson(fixture.current)).ok).toBe(true);
  });
  it("uses real owned context/history readers and keeps omitted evidence distinct from non-mention", async () => {
    const fixture = await createVisibilityArtifactFixture();
    const calls = fixture.chain.providerCalls;
    const response = await handleVisibilityContext(new Request("http://127.0.0.1/api/tools/ai-visibility-check/context"), fixture.contextDependencies);
    expect(response.status).toBe(200);
    const context = parseVisibilityContext(await response.json());
    expect(context.websites.map(site => site.preparation.status)).toEqual(["ready", "profile_required"]);
    expect(context.websites[0]!.frozen!.payload.profileCopy!.profile).toEqual(fixture.chain.website.currentConfirmedSnapshot!.profile);
    const history = await listVisibilityHistory({ userId: GEO_CHAIN_USER }, fixture.historyDependencies);
    expect(history.kind).toBe("ok");
    if (history.kind === "ok") expect(history.value.runs).toHaveLength(3);
    const current = await readVisibilityHistory({ userId: GEO_CHAIN_USER, runId: ARTIFACT_CURRENT_RUN }, fixture.historyDependencies);
    expect(current.kind).toBe("ok");
    const legacy = await readVisibilityHistory({ userId: GEO_CHAIN_USER, runId: ARTIFACT_LEGACY_RUN }, fixture.historyDependencies);
    expect(legacy).toMatchObject({ kind: "ok", value: { evidenceAvailability: "summary_only" } });
    const imported = parseVisibilityImport(exportVisibilityJson(fixture.current));
    expect(imported.ok).toBe(true);
    expect(fixture.current.questions[0]!.samples[0]).toMatchObject({ mentioned: true, excerpt: null, excerptOmitted: true });
    expect(fixture.chain.providerCalls).toBe(calls);
  });
});
