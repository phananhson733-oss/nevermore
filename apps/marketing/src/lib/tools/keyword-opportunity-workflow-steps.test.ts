import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  new URL("./keyword-opportunity-workflow-steps.ts", import.meta.url),
  "utf8",
);

describe("keyword Workflow step retry contract", () => {
  it("disables SDK retries on every external, summary, and terminal step", () => {
    const assignments = SOURCE.match(/\.maxRetries = 0;/gu) ?? [];

    expect(assignments).toHaveLength(14);
    expect(SOURCE).not.toMatch(/\.maxRetries = [1-9]/u);
  });
});
