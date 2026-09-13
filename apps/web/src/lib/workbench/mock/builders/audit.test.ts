import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditReport, Finding, Profile } from "../../types.ts";
import { fixTaskPrompt, ticketCsv } from "./audit.ts";
import { FIXTURE_PROFILE, FIXTURE_REPORT } from "./builder-fixtures.ts";
import {
  type FieldCase,
  HOSTILE_VALUES,
  promptViolations,
  withEveryField,
} from "./hostile-fixtures.ts";
import { splitFences } from "./prompt-test-helpers.ts";

interface Input {
  readonly report: AuditReport;
  readonly profile: Profile;
  readonly stack: string;
}

const STACK = "[未知：先识别仓库框架]";
const BASE: Input = { report: FIXTURE_REPORT, profile: FIXTURE_PROFILE, stack: STACK };
const TITLE = "# 任务：修复站点的 SEO / GEO 技术问题";
const REPRODUCE_FIRST =
  "以下问题由示例数据生成，先逐条在仓库里复现；复现不了的直接丢弃，不要为了“修复”去制造改动。";

function withFinding(report: AuditReport, patch: Partial<Finding>): AuditReport {
  return {
    ...report,
    findings: report.findings.map((f, i) => (i === 0 ? { ...f, ...patch } : f)),
  };
}

function profileField(key: "url" | "brand" | "positioning"): FieldCase<Input> {
  return {
    field: `profile.${key}`,
    apply: (input, value) => ({ ...input, profile: { ...input.profile, [key]: value } }),
  };
}

function findingField(key: "id" | "t" | "page" | "found" | "expect" | "fix"): FieldCase<Input> {
  return {
    field: `report.findings[0].${key}`,
    apply: (input, value) => ({ ...input, report: withFinding(input.report, { [key]: value }) }),
  };
}

const CASES: readonly FieldCase<Input>[] = [
  ...(["url", "brand", "positioning"] as const).map(profileField),
  { field: "stack", apply: (input, value) => ({ ...input, stack: value }) },
  {
    field: "report.at",
    apply: (input, value) => ({ ...input, report: { ...input.report, at: value } }),
  },
  ...(["id", "t", "page", "found", "expect", "fix"] as const).map(findingField),
];

describe("ticketCsv", () => {
  it("writes the exact header and id-valued severity and engine columns", () => {
    const lines = ticketCsv(FIXTURE_REPORT.findings).split("\n");
    expect(lines).toEqual([
      "id,category,issue,severity,engine,page,detected,expected,fix",
      "FIX-01,抓取与索引,sitemap 里有 404 与重定向 URL,high,seo,/,sitemap.xml 中存在非 200 的 URL,sitemap 只列 200 且可索引的 URL,从 sitemap 生成逻辑里过滤非 200 页面",
      "FIX-02,AI 可读性,关键论述缺数字与日期,low,both,/pricing,定价页与对比页的关键论述没有数字断言,关键论述带数字、日期或版本号,在定价页与对比页补上可核对的数字",
    ]);
  });

  it("neutralises a formula-leading cell", () => {
    const report = withFinding(FIXTURE_REPORT, { t: "=cmd|' /C calc'!A0" });
    const [, first] = ticketCsv(report.findings).split("\n");
    expect(first?.split(",")[2]).toBe("'=cmd|' /C calc'!A0");
  });

  it("writes only the header without findings", () => {
    expect(ticketCsv([])).toBe("id,category,issue,severity,engine,page,detected,expected,fix");
  });
});

describe("fixTaskPrompt", () => {
  const prompt = fixTaskPrompt(BASE);

  it("opens with the fixed title, which names no domain, then the reproduce-first sentence", () => {
    expect(prompt.split("\n\n").slice(0, 2)).toEqual([TITLE, REPRODUCE_FIRST]);
    expect(splitFences(prompt).outside).not.toContain("acme.io");
  });

  it("never says 实测, even when finding text does", () => {
    expect(prompt).not.toContain("实测");
    expect(prompt).toContain("sampleObservation");
  });

  it("puts the site and the findings in two announced JSON blocks", () => {
    const { blocks } = splitFences(prompt);
    expect(blocks.map((b) => b.info)).toEqual(["json", "json"]);
    expect(blocks[0]?.before).toContain("## 站点");
    expect(blocks[1]?.before).toContain("## 问题清单");
    expect(JSON.parse(blocks[0]?.body ?? "")).toEqual({
      url: "https://acme.io",
      domain: "acme.io",
      brand: "Acme",
      positioning: "给小团队用的 SEO 检查工具",
      stack: STACK,
      auditedAt: "2026-09-13 09:00",
      score: 72,
      findingCount: 2,
    });
    expect(Object.keys(JSON.parse(blocks[0]?.body ?? "{}") as object)).toEqual([
      "url", "domain", "brand", "positioning", "stack", "auditedAt", "score", "findingCount",
    ]);
  });

  it("labels severity and engine in Chinese inside the findings block", () => {
    const findings = JSON.parse(splitFences(prompt).blocks[1]?.body ?? "") as unknown;
    expect(findings).toEqual([
      {
        id: "FIX-01",
        severity: "高",
        engine: "SEO",
        title: "sitemap 里有 404 与重定向 URL",
        page: "/",
        sampleObservation: "sitemap.xml 中存在非 200 的 URL",
        expected: "sitemap 只列 200 且可索引的 URL",
        suggestion: "从 sitemap 生成逻辑里过滤非 200 页面",
      },
      {
        id: "FIX-02",
        severity: "低",
        engine: "SEO+GEO",
        title: "关键论述缺数字与日期",
        page: "/pricing",
        sampleObservation: "定价页与对比页的关键论述没有数字断言",
        expected: "关键论述带数字、日期或版本号",
        suggestion: "在定价页与对比页补上可核对的数字",
      },
    ]);
  });

  it("ends with the five execution steps", () => {
    expect(prompt.endsWith(`## 执行要求

1. 先只读扫描仓库，为每个问题定位到具体文件与行号，不要直接改。
2. 输出改动计划：问题 ID → 文件路径 → 改什么 → 风险 → 验证方式。
3. 我确认后按 高 → 中 → 低 分批提交，一个问题一个 commit。
4. 模板级问题优先于单页修补；不要为通过检查造用户看不见的内容。
5. 每条给出我能自己复跑的验收方法（命令、URL 或校验器）。`)).toBe(true);
  });

  it("still fences an empty findings list", () => {
    const out = fixTaskPrompt({ ...BASE, report: { ...FIXTURE_REPORT, findings: [] } });
    expect(splitFences(out).blocks[1]?.body).toBe("[]");
  });

  describe("severity order", () => {
    afterEach(() => {
      vi.doUnmock("../labels-zh.ts");
      vi.resetModules();
    });

    it("is spelled from SEVERITY_ZH, not a literal", async () => {
      vi.resetModules();
      vi.doMock("../labels-zh.ts", async (importOriginal) => ({
        ...(await importOriginal<typeof import("../labels-zh.ts")>()),
        SEVERITY_ZH: { high: "H", mid: "M", low: "L" },
      }));
      const mocked = await import("./audit.ts");
      const out = mocked.fixTaskPrompt(BASE);
      expect(out).toContain("3. 我确认后按 H → M → L 分批提交，一个问题一个 commit。");
      expect(out).not.toContain("高 → 中 → 低");
    });
  });

  describe.each(CASES)("hostile $field", ({ apply }) => {
    it.each(HOSTILE_VALUES)("$name stays inside the data blocks", (hostile) => {
      const input = apply(BASE, hostile.value);
      const out = fixTaskPrompt(input);
      expect(promptViolations(out, hostile)).toEqual([]);
      expect(out).not.toContain("实测");
      expect(fixTaskPrompt(input)).toBe(out);
    });
  });

  it.each(HOSTILE_VALUES)("every field hostile at once: $name", (hostile) => {
    const out = fixTaskPrompt(withEveryField(BASE, CASES, hostile.value));
    expect(promptViolations(out, hostile)).toEqual([]);
  });
});
