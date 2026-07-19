import { describe, expect, it } from "vitest";

import { DiagnosticContext } from "./context.ts";
import { parseIcp } from "./icp.ts";
import { runPipeline } from "./pipeline.ts";

async function coverageFor(locale: string) {
  const ctx = DiagnosticContext.build({
    icp: parseIcp({ productName: "Acme" }),
    deliveryLocale: locale,
    observations: [],
    coverage: {
      crawl: "partial",
      gsc: "unavailable",
      ga4: "unavailable",
      csv: "unavailable",
    },
    capturedAt: {},
  });
  return (await runPipeline({
    projectId: "00000000-0000-4000-8000-000000000001",
    ctx,
    rules: [],
    deliveryLocale: locale,
  })).coverage;
}

describe("diagnostic coverage output locale", () => {
  it("persists zh-CN client-facing limitations for a zh-CN run", async () => {
    expect((await coverageFor("zh-CN")).limitations).toEqual([
      "Crawl 采集不完整；部分链接图视图可能缺失。",
      "未连接 Google Search Console；搜索规则已跳过。",
      "未连接 GA4；落地页转化规则已跳过。",
      "未提供关键词差距 CSV；内容差距规则已跳过。",
    ]);
  });

  it("uses the English fallback for non-Chinese delivery locales", async () => {
    expect((await coverageFor("en")).limitations[0]).toBe(
      "Crawl was partial; some link-graph views are incomplete.",
    );
  });
});
