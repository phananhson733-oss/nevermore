import { describe, expect, it } from "vitest";

import {
  geoBriefFileName,
  geoBriefMarkdown,
  type GeoBriefExportLabels,
} from "./brief-export.ts";
import {
  GEO_BRIEF_SCHEMA_VERSION,
  type GeoBrief,
} from "./brief-contract.ts";

const LABELS: GeoBriefExportLabels = {
  title: "GEO Brief",
  question: "Question:",
  leadAnswer: "Opening answer",
  requiredEntities: "Must name",
  mustAnswer: "Must answer",
  outline: "Outline",
  facts: "Facts",
  wontSay: "Do not put a number on",
  citedDomains: "Currently answering this",
  limits: "What this does not do",
  notVerified: "not verified",
  sourceKb: "knowledge base",
  sourceCrawl: "crawled",
  sourceSample: "seen in one answer",
  sourceModel: "written here",
  generatedAt: "Generated",
  limitLines: ["Read once, on one surface."],
};

function brief(overrides: Partial<GeoBrief> = {}): GeoBrief {
  return {
    schemaVersion: GEO_BRIEF_SCHEMA_VERSION,
    origin: {
      kbId: "kb-1",
      snapshotId: "snap-1",
      revision: 2,
      questionId: "q01",
      questionText: "best project trackers for mid-market ops",
      layer: "discovery",
      roleId: "role-1",
    },
    officialName: "Acme",
    market: { country: "US", language: "en" },
    leadAnswer: {
      requirement: "Say what Acme is and who it is for.",
      requiredEntities: ["project tracker"],
      source: "model",
    },
    mustAnswer: [
      { id: "Q1", text: "What does it cost?", source: "ai_sample" },
      { id: "Q2", text: "Is there an audit trail?", source: "model" },
    ],
    outline: [
      { id: "S1", heading: "Pricing", answers: ["Q1"], source: "model" },
    ],
    facts: [
      {
        key: "pricing",
        value: "$29 per seat",
        reason: null,
        source: "crawl",
        sourceUrl: "https://acme.test/pricing",
        observedAt: "2026-08-29T00:00:00.000Z",
      },
      {
        key: "uptime",
        value: null,
        reason: "notPublished",
        source: "kb",
        sourceUrl: null,
        observedAt: null,
      },
    ],
    wontSay: ["uptime"],
    citedDomains: [
      {
        domain: "rival.test",
        isOwn: false,
        isCompetitor: true,
        urls: ["https://rival.test/compare"],
      },
    ],
    limits: ["singleSample"],
    generatedAt: "2026-08-29T12:00:00.000Z",
    ...overrides,
  };
}

describe("geoBriefMarkdown", () => {
  it("keeps every item's provenance in the exported text", () => {
    // The chips on the page do not survive a paste. Without the words inline, a
    // subtopic another company's answer happened to use reads as something the
    // brand verified.
    const markdown = geoBriefMarkdown(brief(), LABELS);
    expect(markdown).toContain("- What does it cost? _(seen in one answer)_");
    expect(markdown).toContain("- Is there an audit trail? _(written here)_");
  });

  it("names an unverified fact instead of leaving it out", () => {
    const markdown = geoBriefMarkdown(brief(), LABELS);
    // A table that silently drops what it could not verify reads as a shorter
    // but complete table.
    expect(markdown).toContain("- **uptime**: not verified (notPublished)");
    expect(markdown).toContain("- **pricing**: $29 per seat");
  });

  it("carries the fact's own source url", () => {
    expect(geoBriefMarkdown(brief(), LABELS)).toContain(
      "https://acme.test/pricing",
    );
  });

  it("uses no English of its own", () => {
    // Every heading in the output must have come from the labels. A builder
    // with words baked in would export an English document from a Chinese page.
    const markdown = geoBriefMarkdown(brief(), {
      ...LABELS,
      title: "标题",
      question: "问题：",
      leadAnswer: "开头段",
      mustAnswer: "必须回答",
      outline: "大纲",
      facts: "事实",
      wontSay: "不要写数字的维度",
      citedDomains: "现在在回答这道题的",
      limits: "这份简报做不到什么",
      requiredEntities: "必须点名",
      notVerified: "未核实",
      sourceKb: "知识库",
      sourceCrawl: "抓取",
      sourceSample: "一次回答里出现过",
      sourceModel: "本工具写的",
      generatedAt: "生成于",
      limitLines: ["只读了一次，只在一个面上。"],
    });
    expect(markdown).toContain("# 标题");
    expect(markdown).toContain("## 必须回答");
    expect(markdown).not.toContain("Must answer");
    expect(markdown).not.toContain("GEO Brief");
  });

  it("omits the outline section rather than printing an empty one", () => {
    const markdown = geoBriefMarkdown(brief({ outline: [] }), LABELS);
    expect(markdown).not.toContain("## Outline");
    // The rest is still there; a missing outline is not a missing brief.
    expect(markdown).toContain("## Must answer");
  });

  it("resolves an outline section to the wording of the items it answers", () => {
    const markdown = geoBriefMarkdown(brief(), LABELS);
    const outlineIndex = markdown.indexOf("### Pricing");
    expect(outlineIndex).toBeGreaterThan(-1);
    expect(markdown.slice(outlineIndex)).toContain("- What does it cost?");
  });

  it("prints the run's own limit lines, not a fixed list", () => {
    const markdown = geoBriefMarkdown(brief(), {
      ...LABELS,
      limitLines: ["This run could not be stored.", "Read once."],
    });
    expect(markdown).toContain("- This run could not be stored.");
    expect(markdown).toContain("- Read once.");
  });
});

describe("geoBriefFileName", () => {
  it("names the file after the question and the day", () => {
    expect(geoBriefFileName(brief(), "md")).toBe(
      "geo-brief-best-project-trackers-for-mid-market-ops-2026-08-29.md",
    );
  });

  it("survives a question with no latin characters", () => {
    const named = geoBriefFileName(
      brief({
        origin: { ...brief().origin, questionText: "最好的项目管理工具是什么？" },
      }),
      "json",
    );
    expect(named).toBe("geo-brief-2026-08-29.json");
  });

  it("bounds the slug so one long question cannot make an unusable name", () => {
    const named = geoBriefFileName(
      brief({
        origin: { ...brief().origin, questionText: "a".repeat(200) },
      }),
      "md",
    );
    expect(named.length).toBeLessThan(80);
  });
});
