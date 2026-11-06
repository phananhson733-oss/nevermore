// @input  -- a CSV file the admin picks and its currency; POST /api/admin/tasks/earnings
// @output -- the import result, or every problem line and unclaimed code
// @pos    -- the interactive half of /admin/tasks/earnings
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { MAX_SETTLEMENT_BYTES } from "../../../lib/task-center/settlement-csv.ts";
import { adminFetch, describeError } from "./admin-fetch.ts";

const PROBLEMS: Readonly<Record<string, string>> = {
  missing_columns: "缺少列：至少要有日期、推广码，和订单数、广告金额、收益中的一列",
  bad_date: "日期不对（要 YYYY-MM-DD）",
  bad_code: "推广码不对（8 位）",
  bad_orders: "订单数不是非负整数",
  bad_ad_amount: "广告金额格式不对",
  bad_income: "收益格式不对",
  no_figures: "三个数字都是空的",
  duplicate_row: "同一推广码同一天出现了两次",
  too_many_rows: "行数超过 20000",
  too_large: "文件超过 2 MB",
  empty_file: "文件里没有数据行",
  unbalanced_quotes: "引号没有配对",
  text_after_quote: "引号结束后还跟着别的字，没有逗号隔开",
  duplicate_column: "表头里同一列出现了两次（比如 income 和 收益 都有）",
  extra_cells: "这一行的格子比表头多，多半是金额里的千分位逗号没加引号，比如 1,000.00 要写成 1000.00",
};

export function SettlementImportForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);

  async function submit(): Promise<void> {
    const file = input.current?.files?.[0];
    if (!file) return;
    if (file.size > MAX_SETTLEMENT_BYTES) {
      setResult({ ok: false, lines: ["文件超过 2 MB。"] });
      return;
    }
    setBusy(true);
    setResult(null);
    const answer = await adminFetch("/api/admin/tasks/earnings", "POST", {
      fileName: file.name.slice(0, 255),
      currency: currency.trim().toUpperCase(),
      csv: await file.text(),
    });
    setBusy(false);
    if (answer.ok) {
      setResult({ ok: true, lines: [`导入了 ${String(answer.data?.rowCount)} 行。`] });
      if (input.current) input.current.value = "";
      router.refresh();
      return;
    }
    const lines = [describeError(answer)];
    const problems = answer.error?.problems;
    if (Array.isArray(problems)) {
      for (const p of problems as { line?: number; problem?: string }[]) {
        lines.push(`第 ${p.line} 行：${PROBLEMS[p.problem ?? ""] ?? p.problem}`);
      }
    }
    const codes = answer.error?.unknownCodes;
    if (Array.isArray(codes)) lines.push(`没人领取的推广码：${codes.join("、")}`);
    setResult({ ok: false, lines });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" accept=".csv,text/csv" className="text-[13.5px] text-text-dark-secondary" />
        <label className="text-[13.5px] text-text-dark-secondary">
          币种{" "}
          <input
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            maxLength={3}
            className="h-9 w-20 rounded-[8px] border border-brand-border-strong bg-brand-bg px-3 font-mono text-[13.5px] text-text-dark-primary uppercase"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="h-9 rounded-[8px] bg-primary px-4 text-[13.5px] font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "导入中…" : "导入"}
        </button>
      </div>
      {result && (
        <div role="status" className={`space-y-1 text-[13.5px] ${result.ok ? "text-brand-accent-text" : "text-brand-error"}`}>
          {result.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}
