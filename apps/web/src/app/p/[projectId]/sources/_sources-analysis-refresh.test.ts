import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./_sources.tsx", import.meta.url), "utf8");
const en = JSON.parse(
  readFileSync(
    new URL("../../../../../../../packages/i18n/src/messages/en.json", import.meta.url),
    "utf8",
  ),
) as { sources: { analysisRefresh: Record<string, unknown> } };
const zh = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../../../packages/i18n/src/messages/zh-CN.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { sources: { analysisRefresh: Record<string, unknown> } };

describe("Sources Analysis Refresh wiring", () => {
  it("uses the primary CTA to create a real parent command and tracks its run", () => {
    expect(source).toContain(
      "const createAnalysisRefresh = useCreateAnalysisRefreshRun(projectId);",
    );
    expect(source).toContain(
      "const accepted = await createAnalysisRefresh.mutateAsync();",
    );
    expect(source).toContain(
      "replaceAnalysisRefreshRun(accepted.run.id);",
    );
    expect(source).toContain('t("analysisRefresh.start")');
  });

  it("recovers the URL pointer and adopts a locatable 409 winner", () => {
    expect(source).toContain(
      "readAnalysisRefreshRunId(window.location.search)",
    );
    expect(source).toContain(
      "const winnerRunId = analysisRefreshRunIdFromError(error);",
    );
    expect(source).toContain("replaceAnalysisRefreshRun(winnerRunId);");
    expect(source).toContain(
      "withAnalysisRefreshRunId(window.location.href, runId)",
    );
  });

  it("invalidates evidence/audit/growth at terminal and exposes honest terminal states", () => {
    expect(source).toContain(
      "invalidateAnalysisRefreshTerminalQueries(queryClient, projectId)",
    );
    expect(source).toContain("setAnalysisRefreshTerminal({");
    expect(source).toContain(
      "data-terminal-status={analysisRefreshTerminal.status}",
    );
    expect(en.sources.analysisRefresh).toMatchObject({
      start: "Update analysis data",
      terminal: {
        partial: expect.stringMatching(/partially/i),
        failed: expect.stringMatching(/did not finish/i),
      },
    });
    expect(zh.sources.analysisRefresh).toMatchObject({
      start: "更新分析数据",
      terminal: {
        partial: expect.stringMatching(/部分完成/u),
        failed: expect.stringMatching(/未完成/u),
      },
    });
  });

  it("retains a separately labelled status-only refresh action", () => {
    expect(source).toContain(
      "sources.refetch(),\n                gscSnapshots.refetch(),\n                ga4Snapshots.refetch(),",
    );
    expect(source).toContain(
      "...(analysisRefreshRunId !== null\n                  ? [analysisRefreshRun.refetch()]",
    );
    expect(source).toContain(
      "{refreshing ? copy.refreshing : copy.refreshAll}",
    );
  });
});
