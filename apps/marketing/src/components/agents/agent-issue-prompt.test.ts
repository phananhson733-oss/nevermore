// @input  -- projected issues in both copy modes and both locales
// @output -- regression guard for bounded, issue-scoped handoff text
// @pos    -- pure unit guard for what leaves this product in a prompt

import { describe, expect, it } from "vitest";
import type { SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import {
  AGENT_ISSUE_VALUE_CHAR_LIMIT,
  buildAgentIssuePrompt,
  redactUrl,
} from "./agent-issue-prompt";
import {
  AGENT_ISSUE_URL_DISPLAY_LIMIT,
  buildAgentIssueModel,
} from "./agent-issue-model";

function record({
  id,
  affected,
  values = [],
  siteLevel = false,
  limitation = null,
}: {
  readonly id: string;
  readonly affected: number;
  readonly values?: readonly {
    readonly label: string;
    readonly value: unknown;
  }[];
  readonly siteLevel?: boolean;
  readonly limitation?: string | null;
}): SeoAuditRecord {
  return {
    id,
    category: "metadata",
    state: "observed",
    unit: siteLevel ? "site" : "pages",
    population: "every_collected_page",
    targetTested: null,
    tested: 12,
    affected,
    observations: Array.from({ length: affected }, (_, index) => ({
      url: siteLevel ? null : `https://example.com/${id}-${index}`,
      values,
    })),
    limitation,
  } as unknown as SeoAuditRecord;
}

function evaluatedCheck({
  id,
  result,
  truth = "observed",
  engine = "ready",
  evidenceRecordIds = [],
}: {
  readonly id: string;
  readonly result: string;
  readonly truth?: string;
  readonly engine?: string;
  readonly evidenceRecordIds?: readonly string[];
}): AgentAuditEvaluatedCheck {
  return {
    check: {
      id,
      scope: "page",
      groupId: id.split(".")[0] ?? id,
      title: { en: `Missing title on ${id}`, zh: `${id} 缺少 Title` },
      impact: { en: `${id} impact`, zh: `${id} 影响` },
      howToFix: { en: `Rewrite the title`, zh: `重写 Title` },
      threshold: { en: "exactly one title", zh: "恰好一个 Title" },
      thresholdAuthority: "official",
      dataSource: { en: "public HTML", zh: "公开 HTML" },
      scoreWeight: 1,
      scored: true,
      blocking: result === "blocker",
      blockerEvidenceRecordIds: [],
      failureResult: "warning",
      primaryAgent: "seo",
      inventoryReady: true,
      engine,
      evidenceRecordIds,
      issueRules: [],
      boundary: { en: "static HTML only", zh: "仅静态 HTML" },
    },
    result,
    engine,
    truth,
    measurement: { en: "0 titles found", zh: "未找到 Title" },
    evidenceRecordIds,
    scoreValue: null,
    scoreContribution: null,
  } as unknown as AgentAuditEvaluatedCheck;
}

const RUN = {
  completedAt: "2026-08-21T00:18:00.000Z",
  sourceTool: "seo_audit",
  schemaVersion: "seo_audit.v4",
} as const;

function repairIssue(affected = 2) {
  const model = buildAgentIssueModel({
    agent: "seo",
    checks: [
      evaluatedCheck({
        id: "2.1",
        result: "warning",
        evidenceRecordIds: ["r1"],
      }),
    ],
    records: [
      record({
        id: "r1",
        affected,
        values: [{ label: "title", value: "" }],
      }),
    ],
  });
  return model.actionable[0]!;
}

function investigationIssue() {
  const model = buildAgentIssueModel({
    agent: "seo",
    checks: [
      evaluatedCheck({
        id: "9.1",
        result: "excluded",
        truth: "source-gated",
        engine: "access-required",
      }),
    ],
    records: [],
  });
  return model.actionable[0]!;
}

describe("buildAgentIssuePrompt", () => {
  it("scopes the prompt to one issue and names its decision rule", () => {
    const text = buildAgentIssuePrompt({
      issue: repairIssue(),
      locale: "zh",
      run: RUN,
    });

    expect(text).toContain("2.1");
    expect(text).toContain("2.1 缺少 Title");
    expect(text).toContain("恰好一个 Title");
    expect(text).toContain("未找到 Title");
    expect(text).toContain("https://example.com/r1-0");
    // The boundary of the evidence travels with it.
    expect(text).toContain("仅静态 HTML");
  });

  it("states the remainder when affected URLs exceed the display limit", () => {
    const affected = AGENT_ISSUE_URL_DISPLAY_LIMIT + 3;
    const text = buildAgentIssuePrompt({
      issue: repairIssue(affected),
      locale: "zh",
      run: RUN,
    });

    const listed = text.match(/https:\/\/example\.com\/r1-\d+/g) ?? [];
    expect(listed).toHaveLength(AGENT_ISSUE_URL_DISPLAY_LIMIT);

    // Pin the sentence, not a digit. Asserting toContain("13") passed even with
    // the whole remainder line deleted, because the evidence row already prints
    // "命中 13" and the URL list already contains "r1-3".
    const en = buildAgentIssuePrompt({
      issue: repairIssue(affected),
      locale: "en",
      run: RUN,
    });
    expect(en).toContain(
      `Listed ${AGENT_ISSUE_URL_DISPLAY_LIMIT} of ${affected} affected URLs; 3 more not listed`,
    );
  });

  it("asks an investigation issue to establish evidence rather than to repair", () => {
    const text = buildAgentIssuePrompt({
      issue: investigationIssue(),
      locale: "zh",
      run: RUN,
    });

    expect(text).toContain("未取得");
    expect(text).toContain("调查");
    // No verdict was reached, so the prompt must not hand over a repair order.
    expect(text).not.toContain("请修复");
    expect(text).not.toContain("受影响 URL");
  });

  it("never renders an unmeasured population as zero", () => {
    const text = buildAgentIssuePrompt({
      issue: investigationIssue(),
      locale: "zh",
      run: RUN,
    });

    // The prompt must not present a measured population of zero. It may — and
    // should — say the words "not zero", so the assertion targets a stated
    // count, not the digit.
    expect(text).not.toMatch(/^[^\n:]*(受影响|命中|已测)[^\n:]*:\s*0\s*$/m);
    expect(text).toContain("不可得不等于 0");
  });

  it("bounds a long observation value instead of pasting it whole", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({
          id: "2.1",
          result: "warning",
          evidenceRecordIds: ["r1"],
        }),
      ],
      records: [
        record({
          id: "r1",
          affected: 1,
          values: [{ label: "title", value: "x".repeat(900) }],
        }),
      ],
    });

    const text = buildAgentIssuePrompt({
      issue: model.actionable[0]!,
      locale: "zh",
      run: RUN,
    });

    expect(text).not.toContain("x".repeat(AGENT_ISSUE_VALUE_CHAR_LIMIT + 1));
    expect(text).toContain("…");
  });

  it("carries no session, account, or credential material", () => {
    const text = buildAgentIssuePrompt({
      issue: repairIssue(),
      locale: "zh",
      run: RUN,
    });

    for (const forbidden of [
      "cookie",
      "authorization",
      "bearer",
      "access_token",
      "refresh_token",
      "api_key",
      "@gmail.com",
    ]) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("writes the prompt in the requested locale", () => {
    const zh = buildAgentIssuePrompt({
      issue: repairIssue(),
      locale: "zh",
      run: RUN,
    });
    const en = buildAgentIssuePrompt({
      issue: repairIssue(),
      locale: "en",
      run: RUN,
    });

    expect(zh).toContain("2.1 缺少 Title");
    expect(en).toContain("Missing title on 2.1");
    expect(en).not.toContain("缺少");
  });

  it("names the run it came from without claiming the data was stored", () => {
    const text = buildAgentIssuePrompt({
      issue: repairIssue(),
      locale: "en",
      run: RUN,
    });

    expect(text).toContain(RUN.completedAt);
    expect(text).toContain(RUN.schemaVersion);
  });

  it("hands an investigation no repair guidance, not even relabelled", () => {
    const text = buildAgentIssuePrompt({
      issue: investigationIssue(),
      locale: "zh",
      run: RUN,
    });

    // The check's howToFix is a fix. Printing it under "candidate directions"
    // is still printing a fix for something that reached no verdict.
    expect(text).not.toContain("重写 Title");
    expect(text).toContain("需要的数据来源");
  });

  it("states how many observation values it left out", () => {
    const values = Array.from({ length: 9 }, (_, index) => ({
      label: `label-${index}`,
      value: `value-${index}`,
    }));
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({ id: "2.1", result: "warning", evidenceRecordIds: ["r1"] }),
      ],
      records: [record({ id: "r1", affected: 1, values })],
    });

    const text = buildAgentIssuePrompt({
      issue: model.actionable[0]!,
      locale: "en",
      run: RUN,
    });

    expect(text).toContain("label-5");
    expect(text).not.toContain("label-6");
    expect(text).toContain("3 further observation values not listed");
  });

  it("strips credentials and secret query values out of exported URLs", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({ id: "2.1", result: "warning", evidenceRecordIds: ["r1"] }),
      ],
      records: [
        {
          ...record({ id: "r1", affected: 1 }),
          observations: [
            {
              url: "https://alice:hunter2@example.com/p?access_token=abcdef&page=2",
              values: [
                {
                  label: "canonical",
                  value: "https://example.com/x?session_id=zzz",
                },
              ],
            },
          ],
        } as unknown as SeoAuditRecord,
      ],
    });

    const text = buildAgentIssuePrompt({
      issue: model.actionable[0]!,
      locale: "en",
      run: RUN,
    });

    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("abcdef");
    expect(text).not.toContain("zzz");
    // The finding itself survives redaction.
    expect(text).toContain("example.com/p");
    expect(text).toContain("page=2");
  });

  it("reports markup by shape instead of pasting it", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({ id: "2.1", result: "warning", evidenceRecordIds: ["r1"] }),
      ],
      records: [
        record({
          id: "r1",
          affected: 1,
          values: [
            { label: "snippet", value: '<form action="/login"><input name="pw">' },
          ],
        }),
      ],
    });

    const text = buildAgentIssuePrompt({
      issue: model.actionable[0]!,
      locale: "en",
      run: RUN,
    });

    expect(text).not.toContain("<form");
    expect(text).toContain("markup omitted");
  });

  it("describes a site-level issue as site scope with no URL list", () => {
    const model = buildAgentIssueModel({
      agent: "tech",
      checks: [
        evaluatedCheck({
          id: "A1",
          result: "blocker",
          evidenceRecordIds: ["rs"],
        }),
      ],
      records: [record({ id: "rs", affected: 1, siteLevel: true })],
    });

    const text = buildAgentIssuePrompt({
      issue: model.actionable[0]!,
      locale: "zh",
      run: RUN,
    });

    expect(text).toContain("站点");
    expect(text).not.toMatch(/https:\/\/example\.com/);
  });

  it("passes the record limitation through instead of dropping it", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({
          id: "2.1",
          result: "warning",
          evidenceRecordIds: ["r1"],
        }),
      ],
      records: [
        record({
          id: "r1",
          affected: 1,
          limitation: "JavaScript-rendered DOM was not inspected",
        }),
      ],
    });

    const text = buildAgentIssuePrompt({
      issue: model.actionable[0]!,
      locale: "en",
      run: RUN,
    });

    expect(text).toContain("JavaScript-rendered DOM was not inspected");
  });
});

describe("redactUrl", () => {
  /**
   * Each row is a shape the crawl actually produces. The first implementation
   * handled exactly one of them (absolute URL, userinfo, matching query key)
   * and exported the credential verbatim for the other seven.
   */
  it.each([
    ["a credential in the fragment", "https://x.test/cb#access_token=SECRET123"],
    ["a scheme-less target", "example.com/cb#access_token=SECRET123"],
    ["a relative path", "/checkout?access_token=SECRET123"],
    ["a token in a path segment", "https://x.test/reset/aG9sZHRoaXNzZWNyZXR2YWx1ZTEyMzQ1"],
    [
      "a credential nested in an encoded parameter",
      "https://x.test/?next=https%3A%2F%2Fidp%2F%3Ftoken%3DSECRET123",
    ],
    [
      "the second URL of a whitespace-joined value",
      "https://a.test/p1 https://user:pw@b.test/p2?session_id=SECRET123",
    ],
    ["an OAuth code and state", "https://x.test/cb?code=SECRET123&state=SECRET456"],
    ["userinfo beside a query secret", "https://alice:pw@x.test/p?access_token=SECRET123"],
  ])("strips %s", (_label, input) => {
    const out = redactUrl(input);
    expect(out).not.toMatch(/SECRET\d+/);
    expect(out).not.toContain("pw@");
    expect(out).toContain("[redacted]");
  });

  it("leaves ordinary SEO parameters intact", () => {
    // A substring rule redacts `keyword` for containing "key" — which corrupts
    // the single most important parameter an SEO audit reports on.
    const out = redactUrl(
      "https://x.test/p?keyword=seo+audit&design=v2&utm_source=news&page=2",
    );

    expect(out).toContain("keyword=seo");
    expect(out).toContain("design=v2");
    expect(out).toContain("utm_source=news");
    expect(out).toContain("page=2");
    expect(out).not.toContain("[redacted]");
  });

  it("leaves a readable slug path intact", () => {
    const out = redactUrl("https://x.test/birth-chart-calculator/free-reading");
    expect(out).toBe("https://x.test/birth-chart-calculator/free-reading");
  });

  it("keeps every URL of a whitespace-joined value readable", () => {
    // `source_pages` evidence is a space-joined list; parsing only the first URL
    // swallowed the rest into its path as %20-escaped text.
    const out = redactUrl("https://a.test/x?ref=1 https://b.test/y?ref=2");
    expect(out).toContain("https://a.test/x?ref=1");
    expect(out).toContain("https://b.test/y?ref=2");
    expect(out).not.toContain("%20");
  });
});
