import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./_run-diagnosis.tsx", import.meta.url),
  "utf8",
);
const en = JSON.parse(
  readFileSync(
    new URL("../../../../../../../packages/i18n/src/messages/en.json", import.meta.url),
    "utf8",
  ),
) as { growthMap: Record<string, unknown> };
const zh = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../../../packages/i18n/src/messages/zh-CN.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { growthMap: Record<string, unknown> };

describe("Growth Map Analysis Refresh wiring", () => {
  it("queues and tracks the server-owned Analysis Refresh command", () => {
    expect(source).toContain(
      "const createRun = useCreateAnalysisRefreshRun(projectId);",
    );
    expect(source).toContain(
      "const sources = useProjectSources(projectId);",
    );
    expect(source).toContain(
      "const accepted = await createRun.mutateAsync();",
    );
    expect(source).toContain(
      "invalidateAnalysisRefreshTerminalQueries(queryClient, projectId)",
    );
  });

  it("does not create a standalone diagnostic run or submit snapshot inputs", () => {
    expect(source).not.toContain("useCreateDiagnosticRun");
    expect(source).not.toContain("useProjectSnapshots");
    expect(source).not.toContain("selectLatestSnapshotIds");
    expect(source).not.toContain("snapshotIds:");
    expect(source).not.toContain("hasCrawlSnapshot");
    expect(source).not.toContain('t("runNeedsCrawl")');
  });

  it("renders a completed-with-limitations label instead of generic partial once the full refresh finishes", () => {
    expect(source).toContain("runDiagnosisStatusLabelKey");
    expect(source).toContain('t("runCompletedWithLimitations")');
    expect(en.growthMap.runCompletedWithLimitations).toMatch(/completed/i);
    expect(zh.growthMap.runCompletedWithLimitations).toMatch(/已完成/u);
  });

  it("uses explicit whole-site refresh CTA copy and explains that it is not competitor-local", () => {
    expect(source).toContain('t("runDiagnosis")');
    expect(source).toContain('t("rerunDiagnosis")');
    expect(source).toContain('t("runInProgress")');
    expect(source).toContain('t("runDiagnosisScopeNote")');
    expect(en.growthMap.runDiagnosis).toMatch(/refresh all data/i);
    expect(en.growthMap.rerunDiagnosis).toMatch(/refresh all data again/i);
    expect(en.growthMap.runInProgress).toMatch(/refreshing all data/i);
    expect(en.growthMap.runDiagnosisScopeNote).toMatch(/not just the selected competitor/i);
    expect(zh.growthMap.runDiagnosis).toMatch(/刷新全部数据并运行诊断/u);
    expect(zh.growthMap.rerunDiagnosis).toMatch(/重新刷新全部数据并运行诊断/u);
    expect(zh.growthMap.runInProgress).toMatch(/全站数据刷新/u);
    expect(zh.growthMap.runDiagnosisScopeNote).toMatch(/不只当前选中竞品/u);
  });
});
