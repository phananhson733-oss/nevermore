import { describe, expect, it } from "vitest";
import { compareRule, recheckResultsCopy } from "./recheck-results.ts";

describe("compareRule", () => {
  it("verifies a resolved technical condition when the current run passes", () => {
    expect(compareRule("candidate", "pass")).toEqual({
      state: "verified",
      disposition: "resolved",
    });
  });

  it("reports an unchanged observed condition when the candidate persists", () => {
    expect(compareRule("candidate", "candidate")).toEqual({
      state: "observed",
      disposition: "unchanged",
    });
  });

  it("reports insufficient data when the recheck skipped the rule", () => {
    expect(compareRule("candidate", "skipped")).toEqual({
      state: "insufficient_data",
      disposition: "unknown",
    });
  });

  it("reports insufficient data when the recheck was inconclusive", () => {
    expect(compareRule("candidate", "inconclusive")).toEqual({
      state: "insufficient_data",
      disposition: "unknown",
    });
  });

  it("guards against a prior status that is not a candidate failure", () => {
    expect(() => compareRule("pass", "pass")).toThrow(
      /prior candidate rule status/,
    );
    expect(() => compareRule("skipped", "candidate")).toThrow();
  });
});

describe("recheckResultsCopy", () => {
  it("produces technical-condition labels with no impact or lift wording", () => {
    const copy = recheckResultsCopy("en");
    const joined = [
      ...Object.values(copy.labels),
      copy.insufficientDataLimitation,
    ]
      .join(" ")
      .toLowerCase();
    expect(joined).not.toContain("impact");
    expect(joined).not.toContain("lift");
    expect(joined).not.toContain("traffic");
    expect(joined).not.toContain("revenue");
    expect(copy.labels.verified).toBe("Technical condition verified");
  });

  it("localizes the no-data state to a data-insufficient label in zh-CN", () => {
    const copy = recheckResultsCopy("zh-CN");
    expect(copy.labels.insufficient_data).toBe("数据不足");
  });
});
