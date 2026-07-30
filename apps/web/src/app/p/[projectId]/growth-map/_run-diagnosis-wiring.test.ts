import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./_run-diagnosis.tsx", import.meta.url),
  "utf8",
);

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
});
