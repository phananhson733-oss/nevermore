/** @vitest-environment jsdom */

/**
 * The import pane against the real store (T10 Steps 3, 4b, 6).
 *
 * The honesty rules each have a case whose fixture makes the other branch
 * impossible to take by accident:
 * - columns are named from `recognized`, never from cell values (Q7): one case
 *   has a recognised column whose cells are all blank, which a "column is all
 *   null → unrecognised" shortcut reports wrongly;
 * - a parse that finds nothing leaves the saved rows alone (same array
 *   reference), because replacing them with [] is the clear without its
 *   confirmation;
 * - repeated queries are disclosed and the first row is the one kept;
 * - the cap sentence is asserted whole with 5000 / 5002, in both locales
 *   (Step 4b): a swap renders "kept 5002 of 5000" with both numbers present;
 * - a slow file read never lands over a newer paste.
 *
 * The file cases go through a real `<input type="file">` change event; only
 * `File.prototype.text` is stubbed where the case is about the read itself.
 */

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GSC_IMPORT_MAX_BYTES } from "@/lib/workbench/mock/gsc-import";
import {
  buttonByText,
  gscRow,
  mountWithStore,
  pickFile,
  settle,
  typeInto,
  type DsLocale,
  type MountedStore,
} from "./data-sources-test-harness.tsx";
import { GscImportPane } from "./GscImportPane.tsx";

let mounted: MountedStore | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  localStorage.clear();
  vi.restoreAllMocks();
});

function render(locale: DsLocale = "en"): MountedStore {
  mounted = mountWithStore(<GscImportPane />, locale);
  return mounted;
}

const lines = (...parts: readonly string[]): string => parts.join("\n");

function paste(view: MountedStore, text: string): void {
  const field = view.app.querySelector("textarea");
  if (!(field instanceof HTMLTextAreaElement)) throw new Error("no paste field");
  typeInto(field, text);
}

function parse(view: MountedStore, label = "Parse"): void {
  act(() => buttonByText(view.app, label).click());
}

function result(view: MountedStore, kind: string): string | null {
  return view.app.querySelector(`[data-wb-result="${kind}"]`)?.textContent ?? null;
}

function fileInput(view: MountedStore): HTMLInputElement {
  const input = view.app.querySelector("[data-wb-gsc-file]");
  if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
  return input;
}

describe("GscImportPane: parse", () => {
  it("stores the operator's rows as user rows and reports the counts", () => {
    const view = render();
    paste(view, lines("seo tool\t10\t100\t1%\t4", "geo tool\t3\t40\t2%\t22", "answer engine\t5\t60\t4%\t31"));
    parse(view);
    expect(view.store().state.gscRows).toEqual([
      gscRow("seo tool", 10, 100, 1, 4),
      gscRow("geo tool", 3, 40, 2, 22),
      gscRow("answer engine", 5, 60, 4, 31),
    ]);
    expect(view.store().state.gscRowsSource).toBe("user");
    expect(result(view, "counts")).toBe("3 rows parsed · 0 rows skipped");
    expect(result(view, "duplicates")).toBeNull();
    expect(result(view, "truncated")).toBeNull();
    expect(result(view, "nothing")).toBeNull();
  });

  it("counts a record that did not become a row as skipped, in both locales", () => {
    const text = lines("seo tool\t10\t100\t1%\t4", "a query with no numbers", "geo tool\t3\t40\t2%\t22");
    const en = render();
    paste(en, text);
    parse(en);
    expect(result(en, "counts")).toBe("2 rows parsed · 1 row skipped");
    en.unmount();
    localStorage.clear();

    const zh = render("zh-CN");
    paste(zh, text);
    parse(zh, "解析");
    expect(result(zh, "counts")).toBe("解析 2 条 · 跳过 1 条");
  });
});

describe("GscImportPane: columns are named from the header metadata (Q7)", () => {
  it("names the metric columns a header did not name", () => {
    const view = render();
    paste(view, lines("Query,Clicks", "seo tool,10", "geo tool,3"));
    parse(view);
    expect(result(view, "unrecognized")).toBe("These columns were not recognized: Impressions, CTR, and Position");
    expect(result(view, "noHeader")).toBeNull();
  });

  it("names them in zh-CN with the zh column labels", () => {
    const view = render("zh-CN");
    paste(view, lines("Query,Clicks", "seo tool,10"));
    parse(view, "解析");
    expect(result(view, "unrecognized")).toBe("这些列没认出来：展示、点击率和排名");
  });

  it("does not report a recognised column as unrecognised when every cell in it is blank", () => {
    const view = render();
    paste(view, lines("Query,Clicks,Impressions,CTR,Position", "seo tool,10,,1%,4", "geo tool,3,,2%,12"));
    parse(view);
    expect(view.store().state.gscRows.map((row) => row.impressions)).toEqual([null, null]);
    expect(result(view, "unrecognized")).toBeNull();
    expect(result(view, "noHeader")).toBeNull();
  });

  it("says the columns were read by position when no header named a metric", () => {
    const view = render();
    paste(view, "seo tool\t10\t100\t1%\t4");
    parse(view);
    expect(result(view, "noHeader")).toBe(
      "No header naming a metric column was recognized, so the columns were read by position.",
    );
    expect(result(view, "unrecognized")).toBeNull();
  });
});

describe("GscImportPane: repeated queries (Step 1b)", () => {
  const text = lines("SEO Tool\t10\t100\t1%\t4", "geo tool\t3\t40\t2%\t22", "seo tool\t20\t300\t5%\t9");

  it("keeps the first occurrence and says so as its own sentence", () => {
    const view = render();
    paste(view, text);
    parse(view);
    expect(view.store().state.gscRows).toEqual([gscRow("SEO Tool", 10, 100, 1, 4), gscRow("geo tool", 3, 40, 2, 22)]);
    expect(result(view, "counts")).toBe("2 rows parsed · 1 row skipped");
    expect(result(view, "duplicates")).toBe("Of these, 1 was a repeated query; its first occurrence was kept.");
  });

  it("says it in zh-CN", () => {
    const view = render("zh-CN");
    paste(view, text);
    parse(view, "解析");
    expect(result(view, "duplicates")).toBe("其中 1 条是重复的查询，保留了第一次出现的那条。");
  });
});

describe("GscImportPane: nothing to import", () => {
  it("leaves the saved rows and their provenance untouched and says so", () => {
    const view = render();
    view.dispatch({ type: "setGscRows", rows: [gscRow("sample query", 9, 90, 1, 5)], source: "sample" });
    const saved = view.store().state.gscRows;
    paste(view, "just some words");
    parse(view);
    expect(view.store().state.gscRows).toBe(saved);
    expect(view.store().state.gscRowsSource).toBe("sample");
    expect(result(view, "counts")).toBe("0 rows parsed · 1 row skipped");
    expect(result(view, "nothing")).toBe("No rows to import, so the saved GSC rows were left unchanged.");
  });

  it("reports an empty paste without claiming how columns were read", () => {
    const view = render();
    parse(view);
    expect(result(view, "counts")).toBe("0 rows parsed · 0 rows skipped");
    expect(result(view, "nothing")).not.toBeNull();
    expect(result(view, "noHeader")).toBeNull();
  });
});

describe("GscImportPane: the row cap (Q8, Step 4b)", () => {
  const text = Array.from({ length: 5002 }, (_, i) => `query ${i}\t1\t10\t1%\t5`).join("\n");

  it("keeps 5000 of 5002 and says kept-of-parsed in that order (en)", () => {
    const view = render();
    paste(view, text);
    parse(view);
    expect(view.store().state.gscRows).toHaveLength(5000);
    expect(result(view, "truncated")).toBe("Kept the first 5000 of the 5002 parsed rows.");
  });

  it("says it in zh-CN in the same order", () => {
    const view = render("zh-CN");
    paste(view, text);
    parse(view, "解析");
    expect(result(view, "truncated")).toBe("只保留了前 5000 条，共解析出 5002 条。");
  });
});

describe("GscImportPane: upload (Q8)", () => {
  it("does not read a file over the limit and leaves the store alone", async () => {
    const view = render();
    const file = new File(["x".repeat(GSC_IMPORT_MAX_BYTES + 1)], "big.csv", { type: "text/csv" });
    const read = vi.spyOn(file, "text");
    pickFile(fileInput(view), file);
    await settle();
    expect(read).not.toHaveBeenCalled();
    expect(result(view, "tooLarge")).toBe("This file is larger than 2 MB, so it was not read.");
    expect(view.store().state.gscRows).toEqual([]);
    expect(view.app.textContent).toContain("Up to 2 MB per file.");
  });

  it("reads a file exactly at the limit", async () => {
    const view = render();
    const file = new File(["x".repeat(GSC_IMPORT_MAX_BYTES)], "edge.csv", { type: "text/csv" });
    const read = vi.spyOn(file, "text");
    pickFile(fileInput(view), file);
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(result(view, "tooLarge")).toBeNull();
    expect(result(view, "counts")).toBe("0 rows parsed · 1 row skipped");
  });

  it("imports a file's rows as the operator's own", async () => {
    const view = render();
    const file = new File([lines("Query,Clicks,Position", "seo tool,10,4", "geo tool,3,22")], "gsc.csv", {
      type: "text/csv",
    });
    pickFile(fileInput(view), file);
    await settle();
    expect(view.store().state.gscRows).toEqual([gscRow("seo tool", 10, null, null, 4), gscRow("geo tool", 3, null, null, 22)]);
    expect(view.store().state.gscRowsSource).toBe("user");
    expect(result(view, "counts")).toBe("2 rows parsed · 0 rows skipped");
  });

  it("says a failed read without a cause and leaves the store alone", async () => {
    const view = render();
    const file = new File(["seo tool,10"], "broken.csv");
    vi.spyOn(file, "text").mockRejectedValue(new Error("NotReadableError"));
    pickFile(fileInput(view), file);
    await settle();
    expect(result(view, "readFailed")).toBe("This file could not be read. You can paste its contents instead.");
    expect(view.store().state.gscRows).toEqual([]);
  });

  it("drops a file read that settles after a newer paste was imported", async () => {
    const view = render();
    let finishRead: (text: string) => void = () => {};
    const file = new File(["ignored"], "slow.csv");
    vi.spyOn(file, "text").mockReturnValue(
      new Promise<string>((resolve) => {
        finishRead = resolve;
      }),
    );
    pickFile(fileInput(view), file);
    paste(view, "pasted query\t7\t70\t1%\t6");
    parse(view);
    await act(async () => {
      finishRead(lines("file query one\t1\t10\t1%\t5", "file query two\t2\t20\t1%\t5"));
    });
    await settle();
    expect(view.store().state.gscRows).toEqual([gscRow("pasted query", 7, 70, 1, 6)]);
    expect(result(view, "counts")).toBe("1 row parsed · 0 rows skipped");
  });
});

describe("GscImportPane: no sample labels (Q6, codex #4)", () => {
  it.each([
    ["en", "Parse", "sample"],
    ["zh-CN", "解析", "示例"],
  ] as const)("says nothing about sample data in %s, before or after an import", (locale, label, word) => {
    const view = render(locale);
    expect(view.app.textContent?.toLowerCase()).not.toContain(word);
    paste(view, "seo tool\t10\t100\t1%\t4");
    parse(view, label);
    expect(view.app.textContent?.toLowerCase()).not.toContain(word);
  });
});
