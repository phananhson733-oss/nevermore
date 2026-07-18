import { describe, expect, it } from "vitest";
import { computeGa4Window } from "./window.ts";

describe("computeGa4Window", () => {
  it("uses the property-timezone yesterday as endDate with a 56-day fetch window", () => {
    // 2026-07-18T02:00Z is 2026-07-17 19:00 in Los Angeles (PDT, UTC-7).
    const now = new Date("2026-07-18T02:00:00Z");
    const window = computeGa4Window(now, "America/Los_Angeles");

    expect(window.timeZone).toBe("America/Los_Angeles");
    expect(window.endDate).toBe("2026-07-16"); // yesterday in LA (today is 07-17)
    expect(window.startDate).toBe("2026-05-22"); // endDate − 55 days (56 inclusive)
  });

  it("derives the trailing 28-day current window inclusive of endDate", () => {
    const window = computeGa4Window(new Date("2026-07-18T02:00:00Z"), "America/Los_Angeles");
    expect(window.current28d.end).toBe("2026-07-16");
    expect(window.current28d.start).toBe("2026-06-19"); // endDate − 27 days
  });

  it("uses the property timezone, not machine-local/UTC, at day boundaries", () => {
    const now = new Date("2026-07-18T02:00:00Z");
    // In UTC the calendar date is already 07-18, so yesterday is 07-17.
    expect(computeGa4Window(now, "UTC").endDate).toBe("2026-07-17");
    // In LA it is still 07-17, so yesterday is 07-16 — a different window.
    expect(computeGa4Window(now, "America/Los_Angeles").endDate).toBe("2026-07-16");
  });

  it("handles a timezone ahead of UTC", () => {
    // 2026-07-17T20:00Z is 2026-07-18 05:00 in Tokyo (UTC+9); yesterday is 07-17.
    const window = computeGa4Window(new Date("2026-07-17T20:00:00Z"), "Asia/Tokyo");
    expect(window.endDate).toBe("2026-07-17");
  });

  it("throws on an invalid timezone", () => {
    expect(() => computeGa4Window(new Date("2026-07-18T00:00:00Z"), "Not/AZone")).toThrow();
  });

  it("throws on an invalid `now`", () => {
    expect(() => computeGa4Window(new Date("nonsense"), "UTC")).toThrow();
  });
});
