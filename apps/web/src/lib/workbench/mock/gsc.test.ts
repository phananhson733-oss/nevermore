import { describe, expect, it } from "vitest";
import type { GscRow } from "../types.ts";
import {
  DEMO_GSC_TEXT,
  countByGscStatus,
  demoGscRows,
  gscStatus,
  parseGsc,
} from "./gsc.ts";

const row = (
  query: string,
  clicks: number | null,
  impressions: number | null,
  ctr: number | null,
  position: number | null,
): GscRow => ({ query, clicks, impressions, ctr, position });

const lines = (...parts: readonly string[]): string => parts.join("\n");

describe("parseGsc: pinned corpus", () => {
  it("keeps a quoted delimiter inside the query and reads a quoted thousands separator", () => {
    expect(parseGsc(`"best seo, geo tools",10,"1,234",0.8%,12.3`)).toEqual({
      rows: [row("best seo, geo tools", 10, 1234, 0.8, 12.3)],
      skipped: 0,
    });
  });

  it("reads European separators in a tab paste: 1.234 is thousands, 1,3% and 4,5 are decimals", () => {
    expect(parseGsc("foo\t1\t1.234\t1,3%\t4,5")).toEqual({
      rows: [row("foo", 1, 1234, 1.3, 4.5)],
      skipped: 0,
    });
  });

  it("skips a Chinese header without counting it", () => {
    const text = lines(
      "热门查询,点击次数,展示次数,点击率,排名",
      "geo tool,3,120,2.5%,9.1",
    );
    expect(parseGsc(text)).toEqual({
      rows: [row("geo tool", 3, 120, 2.5, 9.1)],
      skipped: 0,
    });
  });

  it("skips an English tab header without counting it", () => {
    const text = lines(
      "Top queries\tClicks\tImpressions\tCTR\tPosition",
      "geo tool\t3\t120\t2.5%\t9.1",
    );
    expect(parseGsc(text)).toEqual({
      rows: [row("geo tool", 3, 120, 2.5, 9.1)],
      skipped: 0,
    });
  });

  it("does not treat a header-less first data line as a header", () => {
    const text = lines(
      "llm seo checklist\t41\t3120\t1.3%\t8.4",
      "geo tool\t3\t120\t2.5%\t9.1",
    );
    expect(parseGsc(text)).toEqual({
      rows: [
        row("llm seo checklist", 41, 3120, 1.3, 8.4),
        row("geo tool", 3, 120, 2.5, 9.1),
      ],
      skipped: 0,
    });
  });

  it("strips a BOM and reads CRLF line endings", () => {
    const text =
      "\uFEFFTop queries\tClicks\tImpressions\tCTR\tPosition\r\nai seo\t5\t60\t8.3%\t3.2\r\nbest geo\t1\t10\t10%\t7\r\n";
    expect(parseGsc(text)).toEqual({
      rows: [row("ai seo", 5, 60, 8.3, 3.2), row("best geo", 1, 10, 10, 7)],
      skipped: 0,
    });
  });

  it("strips a BOM from a header-less first query", () => {
    expect(parseGsc("\uFEFFai seo,5,60,8.3%,3.2").rows).toEqual([
      row("ai seo", 5, 60, 8.3, 3.2),
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseGsc(`"say ""hi""",1,2,3%,4`)).toEqual({
      rows: [row(`say "hi"`, 1, 2, 3, 4)],
      skipped: 0,
    });
  });

  it("counts a single-column row as skipped", () => {
    expect(parseGsc(lines("justaquery", "ok,1,2,3%,4"))).toEqual({
      rows: [row("ok", 1, 2, 3, 4)],
      skipped: 1,
    });
  });

  it("counts an empty query as skipped", () => {
    expect(parseGsc(lines(",1,2,3,4", "   ,1,2,3,4", "ok,1,2,3%,4"))).toEqual({
      rows: [row("ok", 1, 2, 3, 4)],
      skipped: 2,
    });
  });

  it("turns a non-finite number into null, not 0", () => {
    expect(parseGsc("q,1e999,2,3,4")).toEqual({
      rows: [row("q", null, 2, 3, 4)],
      skipped: 0,
    });
  });

  it("splits on semicolons when there is no comma", () => {
    expect(parseGsc("q;1;2;3%;4")).toEqual({
      rows: [row("q", 1, 2, 3, 4)],
      skipped: 0,
    });
  });

  it("returns nothing and skips nothing for empty or blank text", () => {
    expect(parseGsc("")).toEqual({ rows: [], skipped: 0 });
    expect(parseGsc("\n\r\n\n")).toEqual({ rows: [], skipped: 0 });
    expect(parseGsc("\uFEFF")).toEqual({ rows: [], skipped: 0 });
  });
});

describe("parseGsc: RFC 4180 structure", () => {
  it("keeps a quoted field with a newline and a delimiter as one record", () => {
    const text = lines(`"multi`, `line, query",1,2,3%,4`, "next,5,6,7%,8");
    expect(parseGsc(text)).toEqual({
      rows: [row("multi\nline, query", 1, 2, 3, 4), row("next", 5, 6, 7, 8)],
      skipped: 0,
    });
  });

  it("keeps a quoted tab inside a tab paste", () => {
    expect(parseGsc(`"a\tb"\t1\t2\t3%\t4`).rows).toEqual([
      row("a\tb", 1, 2, 3, 4),
    ]);
  });

  it("does not add a row or a skip for a trailing newline", () => {
    expect(parseGsc("q,1,2,3%,4\n")).toEqual({
      rows: [row("q", 1, 2, 3, 4)],
      skipped: 0,
    });
    expect(parseGsc("q,1,2,3%,4\r\n\r\n")).toEqual({
      rows: [row("q", 1, 2, 3, 4)],
      skipped: 0,
    });
  });

  it("ignores blank, whitespace-only and delimiter-only lines without counting them", () => {
    const text = lines(
      "",
      "a\t1\t2\t3%\t4",
      "   ",
      "\t\t\t\t",
      "",
      "b\t5\t6\t7%\t8",
      "",
    );
    expect(parseGsc(text)).toEqual({
      rows: [row("a", 1, 2, 3, 4), row("b", 5, 6, 7, 8)],
      skipped: 0,
    });
  });

  it("reads old Mac CR-only line endings", () => {
    expect(parseGsc("a,1,2,3%,4\rb,5,6,7%,8").rows).toEqual([
      row("a", 1, 2, 3, 4),
      row("b", 5, 6, 7, 8),
    ]);
  });

  it("allows spaces around a quoted field", () => {
    expect(
      parseGsc(`"best seo, geo tools", 10, "1,234" , 0.8%, 12.3`).rows,
    ).toEqual([row("best seo, geo tools", 10, 1234, 0.8, 12.3)]);
  });

  it("treats a quote inside an unquoted field as a literal character", () => {
    const text = lines(`27" monitor\t1\t2\t3%\t4`, "next\t5\t6\t7%\t8");
    expect(parseGsc(text)).toEqual({
      rows: [row(`27" monitor`, 1, 2, 3, 4), row("next", 5, 6, 7, 8)],
      skipped: 0,
    });
  });

  it("keeps a closed quote pair inside an unquoted field as text, not as a replacement field", () => {
    expect(parseGsc(`frame 5"x7"\t1\t2\t3%\t4`).rows).toEqual([
      row(`frame 5"x7"`, 1, 2, 3, 4),
    ]);
  });

  it("does not let an unterminated leading quote swallow the rest of the paste", () => {
    const text = lines(
      `"hello world\t1\t2\t3%\t4`,
      "next\t5\t6\t7%\t8",
      "last\t9\t10\t11%\t12",
    );
    expect(parseGsc(text)).toEqual({
      rows: [
        row(`"hello world`, 1, 2, 3, 4),
        row("next", 5, 6, 7, 8),
        row("last", 9, 10, 11, 12),
      ],
      skipped: 0,
    });
  });

  it("does not merge two lines whose stray leading quotes happen to pair up", () => {
    const text = lines(`"hello\t1\t2\t3%\t4`, `"world\t5\t6\t7%\t8`);
    expect(parseGsc(text)).toEqual({
      rows: [row(`"hello`, 1, 2, 3, 4), row(`"world`, 5, 6, 7, 8)],
      skipped: 0,
    });
  });

  it("keeps the quotes of a query that only starts with a quoted phrase", () => {
    expect(parseGsc(`"best seo" tools\t1\t2\t3%\t4`).rows).toEqual([
      row(`"best seo" tools`, 1, 2, 3, 4),
    ]);
  });

  it("counts every bad row in a mixed paste and keeps every good one", () => {
    const text = lines(
      "Top queries,Clicks,Impressions,CTR,Position",
      "good one,1,10,10%,1.5",
      "lonely",
      ",2,20,10%,3",
      "",
      `"quoted, ok",3,"1,000",0.3%,40`,
      "no metrics,abc,def,ghi,jkl",
      "zero,0,0,0%,",
      "trailing,4,40,10%,5",
      "",
    );
    const parsed = parseGsc(text);
    expect(parsed.rows).toEqual([
      row("good one", 1, 10, 10, 1.5),
      row("quoted, ok", 3, 1000, 0.3, 40),
      row("zero", 0, 0, 0, null),
      row("trailing", 4, 40, 10, 5),
    ]);
    expect(parsed.rows.length).toBe(4);
    expect(parsed.skipped).toBe(3);
  });
});

describe("gscStatus", () => {
  it("is unknown without a usable position", () => {
    expect([
      gscStatus({}),
      gscStatus({ position: null }),
      gscStatus({ position: 0 }),
      gscStatus({ position: -1 }),
      gscStatus({ position: Number.NaN }),
      gscStatus({ position: Number.POSITIVE_INFINITY }),
    ]).toEqual([
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
    ]);
  });

  it("is ranked from just above 0 up to and including 10", () => {
    expect([
      gscStatus({ position: 0.01 }),
      gscStatus({ position: 1 }),
      gscStatus({ position: 10 }),
    ]).toEqual(["ranked", "ranked", "ranked"]);
  });

  it("is borderline from just above 10 up to and including 30", () => {
    expect([
      gscStatus({ position: 10.01 }),
      gscStatus({ position: 30 }),
    ]).toEqual(["borderline", "borderline"]);
  });

  it("is a gap just above 30", () => {
    expect([
      gscStatus({ position: 30.01 }),
      gscStatus({ position: 30.5 }),
      gscStatus({ position: 99 }),
    ]).toEqual(["gap", "gap", "gap"]);
  });
});

describe("countByGscStatus", () => {
  it("has all four keys even when a status has no rows", () => {
    expect(countByGscStatus([])).toEqual({
      ranked: 0,
      borderline: 0,
      gap: 0,
      unknown: 0,
    });
  });

  it("counts each row once under its status", () => {
    const rows = [
      { position: 10 },
      { position: 10.01 },
      { position: 30 },
      { position: 31 },
      { position: null },
      {},
    ];
    expect(countByGscStatus(rows)).toEqual({
      ranked: 1,
      borderline: 2,
      gap: 1,
      unknown: 2,
    });
  });
});

describe("DEMO_GSC_TEXT / demoGscRows", () => {
  it("parses the demo text completely", () => {
    const parsed = parseGsc(DEMO_GSC_TEXT);
    expect(parsed.skipped).toBe(0);
    expect(parsed.rows.length).toBe(8);
    expect(parsed.rows[0]).toEqual(
      row("ai visibility checker", 18, 2410, 0.7, 14.2),
    );
    expect(parsed.rows[5]).toEqual(row("gengrowth pricing", 63, 740, 8.5, 2.1));
  });

  it("drops GenGrowth brand queries for any other brand", () => {
    const rows = demoGscRows({ brand: "Acme" });
    expect(rows.length).toBe(7);
    expect(
      rows
        .map((r) => r.query)
        .filter((q) => q.toLowerCase().startsWith("gengrowth")),
    ).toEqual([]);
    expect(demoGscRows({ brand: "" }).length).toBe(7);
  });

  it("keeps GenGrowth brand queries for the GenGrowth brand in any spelling", () => {
    for (const brand of ["GenGrowth", "  genGROWTH  "]) {
      const rows = demoGscRows({ brand });
      expect(rows.length).toBe(8);
      expect(rows).toContainEqual(row("gengrowth pricing", 63, 740, 8.5, 2.1));
    }
  });
});
