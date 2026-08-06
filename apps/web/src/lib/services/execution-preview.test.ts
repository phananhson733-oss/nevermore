import { describe, expect, it, vi } from "vitest";
import { ExecutionPreview } from "@sf/contracts";
import { ACTION_TEMPLATES, type RuleId } from "@sf/engine";
import { buildExecutionPreview } from "./execution-preview";

describe("buildExecutionPreview", () => {
  it("uses the project delivery locale rather than any UI locale", () => {
    const uiLocale = "en";
    const preview = buildExecutionPreview("CONTENT-COVERAGE-001", "zh-CN");

    expect(uiLocale).toBe("en");
    expect(preview).toMatchObject({
      contentLocale: "zh-CN",
      title: "为未覆盖的优先意图创建内容",
      artifactType: "content_brief",
    });
    expect(ExecutionPreview.parse(preview)).toEqual(preview);
  });

  it("resolves every exhaustive ActionTemplate Rule", () => {
    for (const ruleId of Object.keys(ACTION_TEMPLATES) as RuleId[]) {
      expect(buildExecutionPreview(ruleId, "en")).toEqual(
        ExecutionPreview.parse({
          templateId: ACTION_TEMPLATES[ruleId].templateId,
          templateVersion: ACTION_TEMPLATES[ruleId].templateVersion,
          artifactType: ACTION_TEMPLATES[ruleId].artifactType,
          effort: ACTION_TEMPLATES[ruleId].effort,
          risk: ACTION_TEMPLATES[ruleId].risk,
          contentLocale: "en",
          ...ACTION_TEMPLATES[ruleId].copy.en,
        }),
      );
    }
  });

  it("returns null for an unknown runtime Rule without allocating execution state", () => {
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");

    expect(buildExecutionPreview("TECH-UNKNOWN-999", "en")).toBeNull();
    expect(randomUuid).not.toHaveBeenCalled();
    randomUuid.mockRestore();
  });

  it("returns only presentational template fields and is deterministic", () => {
    const first = buildExecutionPreview("TECH-HTTP-001", "en");
    const second = buildExecutionPreview("TECH-HTTP-001", "en");

    expect(first).toEqual(second);
    expect(Object.keys(first ?? {}).sort()).toEqual(
      [
        "artifactType",
        "contentLocale",
        "description",
        "effort",
        "expectedOutcome",
        "risk",
        "templateId",
        "templateVersion",
        "title",
      ].sort(),
    );
    expect(first).not.toMatchObject({
      actionId: expect.anything(),
      artifactId: expect.anything(),
      idempotencyKey: expect.anything(),
      status: expect.anything(),
    });
  });
});
