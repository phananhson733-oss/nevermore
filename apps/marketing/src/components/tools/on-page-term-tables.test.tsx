import { describe, expect, it } from "vitest";

import { coverageOf } from "./on-page-term-tables.tsx";

describe("coverageOf", () => {
  it("calls a row full coverage when it contains the whole query in order", () => {
    expect(coverageOf("free birth chart calculator", ["birth chart"])).toBe(
      "full",
    );
  });

  it("does not read a word out of the middle of a longer one", () => {
    // Substring matching reported "charter school" as covering "chart".
    expect(coverageOf("charter school", ["chart"])).toBe("none");
  });

  it("calls a shared word partial rather than nothing", () => {
    expect(coverageOf("birth order", ["birth chart"])).toBe("partial");
  });

  it("compares CJK character by character, the way the units were counted", () => {
    expect(coverageOf("免费星盘计算器", ["免费星盘"])).toBe("full");
    expect(coverageOf("免费星", ["免费星盘"])).toBe("partial");
    expect(coverageOf("天气预报", ["免费星盘"])).toBe("none");
  });

  it("ignores case and surrounding whitespace", () => {
    expect(coverageOf("Free Birth Chart", ["  free birth  "])).toBe("full");
  });

  it("reports nothing when no query was submitted", () => {
    expect(coverageOf("free birth chart", [])).toBe("none");
  });
});
