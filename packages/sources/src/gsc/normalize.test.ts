import { describe, expect, it } from "vitest";
import { GSC_LIMITATION, normalizeGscRows } from "./normalize.ts";
import type { GscRow } from "./client.ts";
import type { GscWindow } from "./window.ts";
import type { GscPageProjection } from "../observations.ts";

const WINDOW: GscWindow = {
  startDate: "2026-05-21",
  endDate: "2026-07-15",
  current28d: { start: "2026-06-18", end: "2026-07-15" },
  previous28d: { start: "2026-05-21", end: "2026-06-17" },
};

const CAPTURED_AT = "2026-07-18T00:00:00.000Z";

function row(partial: Partial<GscRow> & Pick<GscRow, "date" | "page" | "query">): GscRow {
  return { clicks: 0, impressions: 0, position: 0, ...partial };
}

function projectionOf(observation: { readonly valueJson: unknown }): GscPageProjection {
  return observation.valueJson as GscPageProjection;
}

describe("normalizeGscRows", () => {
  it("aggregates by canonical subjectUrl with impression-weighted position", () => {
    const rows: readonly GscRow[] = [
      // URL A, current window — mixed-case host + trailing slash must canonicalize.
      row({ date: "2026-07-01", page: "https://Example.com/blog/post/", query: "alpha", clicks: 5, impressions: 100, position: 3 }),
      row({ date: "2026-07-02", page: "https://example.com/blog/post", query: "beta", clicks: 2, impressions: 300, position: 8 }),
      // URL A, previous window.
      row({ date: "2026-06-01", page: "https://example.com/blog/post", query: "alpha", clicks: 1, impressions: 50, position: 10 }),
      // URL B, previous window only.
      row({ date: "2026-06-10", page: "https://example.com/pricing", query: "cost", clicks: 0, impressions: 20, position: 4 }),
      // Dropped: unparseable page.
      row({ date: "2026-07-03", page: "not a url", query: "junk", clicks: 9, impressions: 9, position: 9 }),
      // Dropped: outside both halves.
      row({ date: "2026-05-01", page: "https://example.com/blog/post", query: "old", clicks: 7, impressions: 7, position: 7 }),
    ];

    const observations = normalizeGscRows(rows, WINDOW, CAPTURED_AT);

    // Two pages (A, B); bad-URL and out-of-window rows dropped. Sorted by subjectRef.
    expect(observations.map((o) => o.subjectRef)).toEqual([
      "https://example.com/blog/post",
      "https://example.com/pricing",
    ]);

    const a = observations[0]!;
    expect(a.metricKey).toBe("gsc.page.v1");
    expect(a.subjectType).toBe("url");
    expect(a.availability).toBe("available");
    expect(a.observedAt).toBe(CAPTURED_AT);
    expect(a.origin).toBe("first_party");
    expect(a.grade).toBe("A");
    expect(a.unit).toBeNull();
    expect(a.limitation).toBe(GSC_LIMITATION);

    const projA = projectionOf(a);
    // current: clicks 5+2, impressions 100+300, weighted pos (3*100 + 8*300)/400.
    expect(projA.current28d).toEqual({ clicks: 7, impressions: 400, position: 2700 / 400 });
    // previous: single row.
    expect(projA.previous28d).toEqual({ clicks: 1, impressions: 50, position: 10 });
    // Top queries ordered by impressions desc, from the current window only.
    expect(projA.topQueries).toEqual([
      { query: "beta", clicks: 2, impressions: 300, position: 8 },
      { query: "alpha", clicks: 5, impressions: 100, position: 3 },
    ]);
  });

  it("reports null position (never 0) for a window with zero impressions", () => {
    const rows: readonly GscRow[] = [
      row({ date: "2026-06-10", page: "https://example.com/pricing", query: "cost", clicks: 0, impressions: 20, position: 4 }),
    ];

    const [observation] = normalizeGscRows(rows, WINDOW, CAPTURED_AT);
    const projection = projectionOf(observation!);

    // No current-window data: clicks/impressions are true zeros, position is null.
    expect(projection.current28d).toEqual({ clicks: 0, impressions: 0, position: null });
    expect(projection.current28d.position).not.toBe(0);
    expect(projection.topQueries).toEqual([]);
    // Previous window has impressions, so its position is defined.
    expect(projection.previous28d.position).toBe(4);
  });

  it("keeps only the top 10 current-window queries by impressions", () => {
    const rows: readonly GscRow[] = Array.from({ length: 12 }, (_unused, index) =>
      row({
        date: "2026-07-05",
        page: "https://example.com/hub",
        query: `q${index.toString().padStart(2, "0")}`,
        clicks: 1,
        impressions: (index + 1) * 10, // q11 highest, q00 lowest
        position: 5,
      }),
    );

    const [observation] = normalizeGscRows(rows, WINDOW, CAPTURED_AT);
    const projection = projectionOf(observation!);

    expect(projection.topQueries).toHaveLength(10);
    // Highest-impression queries retained; ordered desc; the two smallest dropped.
    expect(projection.topQueries.map((q) => q.query)).toEqual([
      "q11", "q10", "q09", "q08", "q07", "q06", "q05", "q04", "q03", "q02",
    ]);
    // Aggregate still counts all 12 rows.
    expect(projection.current28d.impressions).toBe(
      Array.from({ length: 12 }, (_u, i) => (i + 1) * 10).reduce((sum, v) => sum + v, 0),
    );
  });

  it("returns no observations when every row fails canonicalization", () => {
    const rows: readonly GscRow[] = [
      row({ date: "2026-07-01", page: "javascript:alert(1)", query: "x", impressions: 5, position: 1 }),
      row({ date: "2026-07-01", page: "mailto:a@b.com", query: "y", impressions: 5, position: 1 }),
    ];
    expect(normalizeGscRows(rows, WINDOW, CAPTURED_AT)).toEqual([]);
  });
});
