import { describe, expect, it } from "vitest";

import {
  UNAVAILABLE,
  formatCount,
  formatGap,
  formatPercent,
  formatPosition,
  formatTail,
} from "./quick-wins-format.ts";

describe("formatCount", () => {
  it("groups digits the way the page's language does", () => {
    // The table renders inside a localized page. Falling back to the runtime's
    // default locale means a visitor reading the German page gets whatever
    // grouping the server process happened to boot with.
    expect(formatCount(1234567, "en")).toBe("1,234,567");
    expect(formatCount(1234567, "de")).toBe("1.234.567");
  });

  it("rounds to a whole impression", () => {
    expect(formatCount(3.7, "en")).toBe("4");
  });

  it("falls back rather than throwing on a locale tag it cannot parse", () => {
    // The locale comes from the route segment. A malformed one should cost a
    // thousands separator, not the whole results table.
    expect(formatCount(1000, "not a locale")).toMatch(/1.?000/);
  });
});

describe("formatPercent", () => {
  it("shows an unavailable rate as unavailable, not as zero", () => {
    expect(formatPercent(null, "en")).toBe(UNAVAILABLE);
  });

  it("shows a non-finite rate as unavailable too", () => {
    expect(formatPercent(Number.NaN, "en")).toBe(UNAVAILABLE);
  });

  it("keeps two decimals so a 0.51% rate does not read as 1%", () => {
    // The evaluated site earns 0.51% at positions 4-10. Rounded to a whole
    // percent that becomes 1%, which is double.
    expect(formatPercent(0.0051, "en")).toBe("0.51%");
  });

  it("takes a digit count for the places that want a coarse share", () => {
    expect(formatPercent(0.46, "en", 0)).toBe("46%");
  });
});

describe("formatTail", () => {
  it("shows an absent probability as unavailable", () => {
    expect(formatTail(null, "en")).toBe(UNAVAILABLE);
  });

  it("floors an underflowed probability instead of printing zero", () => {
    // 0 would tell the reader the observation cannot happen. What happened is
    // that double precision ran out of exponent.
    expect(formatTail(0, "en")).toBe("< 0.0001");
    expect(formatTail(1e-300, "en")).toBe("< 0.0001");
  });

  it("prints a measurable probability as itself", () => {
    expect(formatTail(0.0234, "en")).toBe("0.0234");
  });
});

describe("formatGap", () => {
  it("signs a gap so its direction survives being read quickly", () => {
    expect(formatGap(14.5, "en")).toBe("+15");
    expect(formatGap(-4.2, "en")).toBe("-4");
  });

  it("shows an unavailable gap as unavailable", () => {
    expect(formatGap(Number.NaN, "en")).toBe(UNAVAILABLE);
  });
});

describe("formatPosition", () => {
  it("keeps one decimal, because it is an average and not a rank", () => {
    expect(formatPosition(8.44, "en")).toBe("8.4");
  });
});
