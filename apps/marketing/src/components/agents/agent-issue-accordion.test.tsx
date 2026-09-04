// @vitest-environment jsdom
// @input  -- projected issue models covering clean, actionable, gated, and unrecognised runs
// @output -- interaction proof for independent disclosure, filtering, and bounded handoff
// @pos    -- client guard for the issue-first result surface

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { TOOL_HANDOFF_KEY } from "../../lib/tools/tool-handoff";
import { AgentIssueAccordion } from "./agent-issue-accordion";
import { buildAgentIssueModel } from "./agent-issue-model";
import {
  confirmAgentProfile,
  createAgentProfileDraft,
  updateAgentProfile,
} from "./agent-profile";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RUN = {
  completedAt: "2026-08-21T00:18:00.000Z",
  sourceTool: "seo_audit",
  schemaVersion: "seo_audit.v4",
} as const;

function record(id: string, affected: number): SeoAuditRecord {
  return {
    id,
    category: "metadata",
    state: "observed",
    unit: "pages",
    population: "every_collected_page",
    targetTested: null,
    tested: 10,
    affected,
    observations: Array.from({ length: affected }, (_, index) => ({
      url: `https://example.com/${id}-${index}`,
      values: [{ label: "title", value: "" }],
    })),
    limitation: null,
  } as unknown as SeoAuditRecord;
}

function check({
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
      title: { en: `Check ${id}`, zh: `检查 ${id}` },
      impact: { en: "impact", zh: "影响" },
      howToFix: { en: "Rewrite it", zh: "重写" },
      threshold: { en: "exactly one", zh: "恰好一个" },
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
    measurement: { en: "0 found", zh: "未找到" },
    evidenceRecordIds,
    scoreValue: null,
    scoreContribution: null,
  } as unknown as AgentAuditEvaluatedCheck;
}

function profile() {
  return confirmAgentProfile(
    updateAgentProfile(createAgentProfileDraft("seo", "https://example.com"), {
      productName: "Acme",
      primaryIcp: "Growth teams",
      primaryCta: "Start free",
      firstOutcome: "First audit",
      targetQuery: "seo audit",
      country: "US",
      locale: "en-US",
    }),
  );
}

describe("AgentIssueAccordion", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  let clipboardDescriptor: PropertyDescriptor | undefined;

  function stubClipboard(writeText: () => Promise<void>) {
    clipboardDescriptor ??= Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  }

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    // restoreAllMocks does not undo defineProperty, so without this every test
    // declared after the clipboard-denial case inherits a rejecting clipboard.
    if (clipboardDescriptor !== undefined) {
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      clipboardDescriptor = undefined;
    }
  });

  function render(
    model: ReturnType<typeof buildAgentIssueModel>,
    currentProfile = profile(),
  ) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={en}>
          <AgentIssueAccordion
            model={model}
            locale="en"
            profile={currentProfile}
            run={RUN}
            targetPageExtract={null}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  function actionableModel() {
    return buildAgentIssueModel({
      agent: "seo",
      checks: [
        check({ id: "1.1", result: "blocker", evidenceRecordIds: ["r1"] }),
        check({ id: "1.2", result: "warning", evidenceRecordIds: ["r2"] }),
        check({ id: "1.3", result: "tip", evidenceRecordIds: ["r3"] }),
      ],
      records: [record("r1", 2), record("r2", 1), record("r3", 1)],
    });
  }

  function groupHintModel() {
    return buildAgentIssueModel({
      agent: "seo",
      checks: [
        check({
          id: "2.4",
          result: "warning",
          evidenceRecordIds: ["r2"],
        }),
        check({
          id: "2.5",
          result: "warning",
          evidenceRecordIds: ["r25"],
        }),
        check({
          id: "4.6",
          result: "tip",
          evidenceRecordIds: ["r4"],
        }),
      ],
      records: [record("r2", 1), record("r25", 1), record("r4", 1)],
    });
  }

  function click(selector: string) {
    act(() => {
      host.querySelector<HTMLButtonElement>(selector)?.click();
    });
  }

  function openRows(): readonly string[] {
    return [...host.querySelectorAll<HTMLElement>("[data-issue-detail]")].map(
      (node) => node.getAttribute("data-issue-detail") ?? "",
    );
  }

  /**
   * The row states key page reach as a count -- "2/3 key pages" -- and until
   * now nothing on screen ever named those pages. A reader could see that a
   * problem was somewhere in the selected set with no way to find out where.
   */
  function keyPageModel(hitUrls: readonly string[]) {
    return buildAgentIssueModel({
      agent: "seo",
      checks: [check({ id: "1.1", result: "blocker", evidenceRecordIds: ["r1"] })],
      records: [record("r1", 2)],
      targetUrl: "https://example.com/",
      keyPageReach: new Map([
        [
          "1.1",
          {
            keyPageTotal: 3,
            keyPageEvaluatedCount: 3,
            keyPageHitCount: hitUrls.length,
            hitUrls,
            outcomes: [],
          },
        ],
      ]),
    });
  }

  it("names the key pages a problem was found on, not just how many", () => {
    render(
      keyPageModel([
        "https://example.com/pricing",
        "https://example.com/features",
      ]),
    );
    click('[data-issue-control="expand-visible"]');

    const hits = [
      ...host.querySelectorAll<HTMLElement>("[data-key-page-hit] > span"),
    ].map((node) => node.textContent ?? "");

    expect(hits).toEqual([
      "https://example.com/pricing",
      "https://example.com/features",
    ]);
  });

  /** A check that failed on several key pages, with its per-page outcomes. */
  function splitModel() {
    return buildAgentIssueModel({
      agent: "seo",
      checks: [check({ id: "1.1", result: "blocker", evidenceRecordIds: ["r1"] })],
      records: [record("r1", 2)],
      targetUrl: "https://example.com/",
      inspectedTargetUrl: "https://example.com/",
      keyPageReach: new Map([
        [
          "1.1",
          {
            keyPageTotal: 3,
            keyPageEvaluatedCount: 3,
            keyPageHitCount: 2,
            hitUrls: ["https://example.com/", "https://example.com/pricing"],
            outcomes: [
              {
                page: { url: "https://example.com/", title: null, metaDescription: null, depth: 0, inboundLinks: 9, reason: "target", score: 0, basis: "target", matchedFeature: null },
                result: "blocker",
                measurement: null,
              },
              {
                page: { url: "https://example.com/pricing", title: null, metaDescription: null, depth: 1, inboundLinks: 4, reason: "navigation", score: 0, basis: "structure", matchedFeature: null },
                result: "warning",
                measurement: null,
              },
            ],
          },
        ],
      ]),
    });
  }

  it("gives each hit page its own row instead of a list inside one", () => {
    /*
      The aggregate took its verdict from the worst key page and listed the
      rest inside, which left the reader holding "which of these is this
      verdict about". One row, one page, one verdict.
    */
    render(splitModel());

    const rows = [
      ...host.querySelectorAll<HTMLElement>("[data-issue-row]"),
    ].map((node) => node.getAttribute("data-issue-row"));

    expect(rows).toEqual([
      "seo:page:1.1@https://example.com/",
      "seo:page:1.1@https://example.com/pricing",
    ]);
  });

  it("carries each page's own result rather than the worst one twice", () => {
    // The whole point of splitting: the submitted page is a blocker and the
    // other is a warning, and one row saying "blocker" for both would be the
    // aggregate again with extra steps.
    render(splitModel());

    const severities = [
      ...host.querySelectorAll<HTMLElement>("[data-issue-row]"),
    ].map((node) => node.getAttribute("data-issue-severity"));

    expect(severities).toEqual(["blocker", "warning"]);
  });

  it("names the page on the row itself, by path", () => {
    render(splitModel());

    const labels = [
      ...host.querySelectorAll<HTMLElement>("[data-issue-key-page]"),
    ];

    expect(labels.map((node) => node.getAttribute("data-issue-key-page"))).toEqual([
      "https://example.com/",
      "https://example.com/pricing",
    ]);
    // The origin is on every row; the path is what differs.
    expect(labels[1]?.textContent).toContain("/pricing");
    expect(labels[1]?.textContent).not.toContain("https://");
    expect(labels[0]?.getAttribute("data-issue-key-page-is-target")).toBe("true");
    expect(labels[1]?.getAttribute("data-issue-key-page-is-target")).toBe("false");
  });

  it("hands a hit page that is not the submitted one to the checker", () => {
    /*
      The Agent judges twelve key pages and captures the full text of one. A
      problem found on any of the other eleven can be named and located and
      cannot be written repair guidance for -- there is no heading list to
      rewrite. The checker is the same engine run against a single page, so the
      page goes there rather than the Agent growing a second text pipeline.
    */
    render(
      keyPageModel([
        "https://example.com/",
        "https://example.com/pricing",
      ]),
    );
    click('[data-issue-control="expand-visible"]');

    const links = [
      ...host.querySelectorAll<HTMLAnchorElement>("[data-key-page-check]"),
    ];

    // Only the page whose text this run does not have. The submitted page
    // already has its own capture, and its own guidance right below.
    expect(links.map((node) => node.getAttribute("data-key-page-check"))).toEqual([
      "https://example.com/pricing",
    ]);
    expect(links[0]?.getAttribute("href")).toContain(
      "/tools/on-page-seo-check",
    );
    // sessionStorage carries the handoff, and `_blank` with `noopener` would
    // sever it before the destination could read it.
    expect(links[0]?.rel).toBe("opener");
  });

  it("offers no check link without a confirmed query for the checker to judge", () => {
    // The checker's keyword slots have nothing to measure against, and the
    // handoff validator refuses the payload -- a button that could only fail.
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={en}>
          <AgentIssueAccordion
            model={keyPageModel(["https://example.com/pricing"])}
            locale="en"
            profile={confirmAgentProfile(
              updateAgentProfile(
                createAgentProfileDraft("seo", "https://example.com"),
                {
                  productName: "Acme",
                  primaryIcp: "Growth teams",
                  primaryCta: "Start free",
                  firstOutcome: "First audit",
                  country: "US",
                  locale: "en-US",
                  targetQuery: "",
                },
              ),
            )}
            run={RUN}
            targetPageExtract={null}
          />
        </NextIntlClientProvider>,
      );
    });
    click('[data-issue-control="expand-visible"]');

    expect(host.querySelector("[data-key-page-check]")).toBeNull();
    expect(host.querySelector("[data-key-page-hit]")).not.toBeNull();
  });

  it("shows real Chinese On-Page guidance for groups 2 and 4 and hands off the submitted page", () => {
    sessionStorage.removeItem(TOOL_HANDOFF_KEY);
    act(() => {
      root.render(
        <NextIntlClientProvider locale="zh" messages={zh}>
          <AgentIssueAccordion
            model={groupHintModel()}
            locale="zh"
            profile={profile()}
            run={RUN}
            targetPageExtract={null}
          />
        </NextIntlClientProvider>,
      );
    });

    const hints = [
      ...host.querySelectorAll<HTMLElement>("[data-on-page-group-hint]"),
    ];
    expect(hints.map((hint) => hint.dataset.onPageGroupHint)).toEqual([
      "2",
      "4",
    ]);
    for (const hint of hints) {
      expect(hint.textContent).toContain(
        "想知道某一页是否真的覆盖了目标词？用 On-Page SEO Checker 逐位点看标题、H1、描述、开头正文和密度，附 SERP 预览。",
      );
    }
    expect(host.textContent).not.toContain("agents.workbench.issues.groupHint");

    const links = hints.map((hint) =>
      hint.querySelector<HTMLAnchorElement>("a"),
    );
    for (const link of links) {
      expect(link?.getAttribute("href")).toContain("/tools/on-page-seo-check");
      expect(link?.target).toBe("_blank");
      expect(link?.rel).toBe("opener");
    }

    for (const link of links) {
      sessionStorage.removeItem(TOOL_HANDOFF_KEY);
      link?.click();
      expect(
        JSON.parse(sessionStorage.getItem(TOOL_HANDOFF_KEY) ?? "null"),
      ).toMatchObject({
        source: "seo-agent-key-page",
        destination: "on-page-seo-check",
        scope: "query_page",
        query: "seo audit",
        page: "https://example.com/",
        evidenceId: null,
      });
    }
  });

  it("normalizes a bare submitted host before writing the On-Page handoff", () => {
    sessionStorage.removeItem(TOOL_HANDOFF_KEY);
    render(groupHintModel(), {
      ...profile(),
      targetUrl: "astrologywiki.com",
      host: "astrologywiki.com",
    });

    host
      .querySelector<HTMLAnchorElement>('[data-on-page-group-hint="2"] a')
      ?.click();

    expect(
      JSON.parse(sessionStorage.getItem(TOOL_HANDOFF_KEY) ?? "null"),
    ).toMatchObject({ page: "https://astrologywiki.com/" });
  });

  it("keeps an unsafe submitted target as a plain checker link", () => {
    sessionStorage.removeItem(TOOL_HANDOFF_KEY);
    render(groupHintModel(), {
      ...profile(),
      targetUrl: "https://user:pass@example.com/",
    });

    const link = host.querySelector<HTMLAnchorElement>(
      '[data-on-page-group-hint="2"] a',
    );
    expect(link?.getAttribute("href")).toContain("/tools/on-page-seo-check");
    link?.click();
    expect(sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull();
  });

  it("places each hint after the last visible issue in its own group", () => {
    render(actionableModel());

    expect(host.querySelector("[data-on-page-group-hint]")).toBeNull();

    render(groupHintModel());

    expect(
      [
        ...host.querySelectorAll<HTMLElement>(
          "[data-issue-row], [data-on-page-group-hint]",
        ),
      ].map(
        (node) =>
          node.getAttribute("data-issue-row") ??
          `hint:${node.dataset.onPageGroupHint}`,
      ),
    ).toEqual([
      "seo:page:2.4",
      "seo:page:2.5",
      "hint:2",
      "seo:page:4.6",
      "hint:4",
    ]);
  });

  it("does not show a group hint when the current filter hides that group", () => {
    render(groupHintModel());
    click('[data-issue-filter="warning"]');

    expect(host.querySelector('[data-on-page-group-hint="2"]')).not.toBeNull();
    expect(host.querySelector('[data-on-page-group-hint="4"]')).toBeNull();
  });

  it("keeps the group guidance as a plain checker link when no query is confirmed", () => {
    sessionStorage.removeItem(TOOL_HANDOFF_KEY);
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={en}>
          <AgentIssueAccordion
            model={groupHintModel()}
            locale="en"
            profile={updateAgentProfile(profile(), { targetQuery: "" })}
            run={RUN}
            targetPageExtract={null}
          />
        </NextIntlClientProvider>,
      );
    });

    const link = host.querySelector<HTMLAnchorElement>(
      '[data-on-page-group-hint="2"] a',
    );
    expect(link?.getAttribute("href")).toContain("/tools/on-page-seo-check");
    link?.click();
    expect(sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull();
  });

  it("writes the group handoff before a new-tab mouse path too", () => {
    sessionStorage.removeItem(TOOL_HANDOFF_KEY);
    render(groupHintModel());

    const link = host.querySelector<HTMLAnchorElement>(
      '[data-on-page-group-hint="2"] a',
    );
    act(() => {
      link?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(
      JSON.parse(sessionStorage.getItem(TOOL_HANDOFF_KEY) ?? "null"),
    ).toMatchObject({
      source: "seo-agent-key-page",
      destination: "on-page-seo-check",
      scope: "query_page",
      evidenceId: null,
    });
  });

  it("says the repair is for a page that passed when the submitted page is not a hit", () => {
    /*
      The aggregate takes its verdict from the worst key page while the draft,
      the preview and the handoff all use the submitted page. When those are
      different pages the screen was asking the reader to change a page that
      passed, and nothing said so.
    */
    render(keyPageModel(["https://example.com/pricing"]));
    click('[data-issue-control="expand-visible"]');

    const scope = host.querySelector<HTMLElement>("[data-repair-scope]");

    expect(scope?.getAttribute("data-repair-scope")).toBe("elsewhere");
    expect(scope?.textContent ?? "").toContain("not found on the page you submitted");
  });

  it("keeps the repair scoped to the submitted page when it is itself a hit", () => {
    render(keyPageModel(["https://example.com/"]));
    click('[data-issue-control="expand-visible"]');

    const scope = host.querySelector<HTMLElement>("[data-repair-scope]");

    expect(scope?.getAttribute("data-repair-scope")).toBe("target");
  });

  it("states a clean run in words instead of showing an empty list", () => {
    render(
      buildAgentIssueModel({
        agent: "seo",
        checks: [
          check({ id: "1.1", result: "pass" }),
          check({ id: "1.2", result: "pass" }),
        ],
        records: [],
      }),
    );

    const clean = host.querySelector('[data-testid="agent-issues-clean"]');
    expect(clean).not.toBeNull();
    expect(clean?.textContent).toContain("found nothing actionable");
    // A clean run still has to say how far its coverage reached.
    expect(clean?.textContent).toContain("coverage reached");
    expect(host.querySelector("[data-issue-row]")).toBeNull();
    expect(
      host.querySelector('[data-testid="agent-issues-passed"]'),
    ).not.toBeNull();
  });

  it("starts every row collapsed and opens them independently", () => {
    render(actionableModel());

    expect(host.querySelectorAll("[data-issue-row]")).toHaveLength(3);
    expect(openRows()).toEqual([]);

    click('[data-issue-control="expand-visible"]');
    expect(openRows()).toHaveLength(3);

    click('[data-issue-control="collapse-all"]');
    expect(openRows()).toEqual([]);
  });

  it("narrows the list by severity without changing any evidence", () => {
    render(actionableModel());

    click('[data-issue-filter="blocker"]');
    expect(host.querySelectorAll("[data-issue-row]")).toHaveLength(1);
    expect(
      host
        .querySelector('[data-issue-filter="blocker"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    click('[data-issue-control="expand-visible"]');
    expect(openRows()).toEqual(["seo:page:1.1"]);

    click('[data-issue-filter="all"]');
    expect(host.querySelectorAll("[data-issue-row]")).toHaveLength(3);
    // Filtering hid a row; it did not close or alter the one already open.
    expect(openRows()).toEqual(["seo:page:1.1"]);
  });

  it("reveals the identical text when the browser denies the clipboard", async () => {
    render(actionableModel());
    click('[data-issue-control="expand-visible"]');

    const preview = host.querySelector<HTMLElement>(
      '[data-issue-preview="seo:page:1.1"]',
    );
    act(() => preview?.click());
    const previewText =
      host.querySelector<HTMLElement>(
        '[data-issue-preview-panel="seo:page:1.1"]',
      )?.textContent ?? "";
    expect(previewText).toContain("Check 1.1");

    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[data-issue-copy="seo:page:1.1"]')
        ?.click();
    });

    const fallback = host.querySelector<HTMLTextAreaElement>(
      '[data-issue-fallback="seo:page:1.1"]',
    );
    expect(fallback).not.toBeNull();
    // The instruction "select this" is only true if it is the same text.
    expect(fallback?.value).toBe(previewText);
    expect(fallback?.readOnly).toBe(true);
  });

  it("keeps a source-gated row as an investigation, never as a failure", () => {
    render(
      buildAgentIssueModel({
        agent: "seo",
        checks: [
          check({
            id: "9.1",
            result: "excluded",
            truth: "source-gated",
            engine: "access-required",
          }),
        ],
        records: [],
      }),
    );

    const row = host.querySelector<HTMLElement>("[data-issue-row]");
    expect(row?.getAttribute("data-issue-lane")).toBe("investigation");
    expect(row?.getAttribute("data-issue-severity")).toBe("none");
    expect(row?.textContent).toContain("Affected population unavailable");

    click('[data-issue-control="expand-visible"]');
    expect(
      host.querySelector("[data-issue-investigation-note]"),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-issue-copy="seo:page:9.1"]')?.textContent,
    ).toContain("investigation");
    expect(
      host.querySelector<HTMLElement>('[data-affected-mode="unavailable"]'),
    ).not.toBeNull();
  });

  it("says a check could not be read instead of calling the run clean", () => {
    render(
      buildAgentIssueModel({
        agent: "seo",
        checks: [
          check({ id: "3.1", result: "pass" }),
          check({
            id: "4.1",
            result: "catastrophe",
            evidenceRecordIds: ["r1"],
          }),
        ],
        records: [record("r1", 2)],
      }),
    );

    const notice = host.querySelector('[data-testid="agent-issues-quarantined"]');
    expect(notice).not.toBeNull();
    expect(notice?.getAttribute("data-quarantined-count")).toBe("1");
    // The green "nothing actionable" panel must not appear beside it.
    expect(host.querySelector('[data-testid="agent-issues-clean"]')).toBeNull();
  });


  it("renders the floor and the remainder when the affected list is bounded", () => {
    const sparse = {
      ...record("r1", 14),
      affected: 25,
    } as unknown as SeoAuditRecord;

    render(
      buildAgentIssueModel({
        agent: "seo",
        checks: [
          check({ id: "1.1", result: "warning", evidenceRecordIds: ["r1"] }),
        ],
        records: [sparse],
      }),
    );

    expect(host.querySelector("[data-issue-row]")?.textContent).toContain(
      "At least 25 affected URLs",
    );

    click('[data-issue-control="expand-visible"]');
    const detail = host.querySelector('[data-issue-detail="seo:page:1.1"]');
    expect(detail?.querySelector('[data-affected-enumerated="false"]')).not.toBeNull();
    expect(detail?.textContent).toContain("more not listed");
  });

  it("says a run evaluated nothing rather than showing it as clean", () => {
    render(
      buildAgentIssueModel({
        agent: "seo",
        checks: [
          check({
            id: "2.1",
            result: "excluded",
            truth: "unavailable",
            engine: "not-integrated",
          }),
        ],
        records: [],
      }),
    );

    expect(
      host.querySelector('[data-testid="agent-issues-not-evaluated"]'),
    ).not.toBeNull();
    expect(host.querySelector('[data-testid="agent-issues-clean"]')).toBeNull();
  });

  it("still gives an observed issue its repair preview", () => {
    render(actionableModel());
    click('[data-issue-control="expand-visible"]');

    expect(
      host.querySelectorAll("[data-issue-preview-shape]").length,
    ).toBeGreaterThan(0);
    expect(
      host.querySelector('[data-issue-detail="seo:page:1.1"]')?.textContent,
    ).toContain("Rewrite it");
  });

  it("gives a gated row a required source instead of a repair", () => {
    render(
      buildAgentIssueModel({
        agent: "seo",
        checks: [
          check({
            id: "9.1",
            result: "excluded",
            truth: "source-gated",
            engine: "access-required",
          }),
        ],
        records: [],
      }),
    );
    click('[data-issue-control="expand-visible"]');

    const detail = host.querySelector('[data-issue-detail="seo:page:9.1"]');
    expect(detail?.textContent).toContain("Data source required");
    // No fix text, no code preview, no validation steps for a check that
    // reached no verdict.
    expect(detail?.textContent).not.toContain("Rewrite it");
    expect(host.querySelector("[data-issue-preview-shape]")).toBeNull();
    expect(detail?.textContent).not.toContain("Validation steps");
  });

  it("quarantines a check whose state this build cannot say", () => {
    render(
      buildAgentIssueModel({
        agent: "seo",
        checks: [
          check({
            id: "4.1",
            result: "warning",
            truth: "illustrative",
            evidenceRecordIds: ["r1"],
          }),
        ],
        records: [record("r1", 1)],
      }),
    );

    expect(host.querySelector("[data-issue-row]")).toBeNull();
    const excluded = host.querySelector(
      '[data-testid="agent-issues-excluded"]',
    );
    expect(excluded?.textContent).toContain("Unrecognised state");
  });

  it("prefixes each actionable row with the priority its severity maps to", () => {
    // The badge is the first thing read on a row, and it has to agree with the
    // ranking the list is already sorted by. blocker/warning/tip map to
    // P0/P1/P2 through the one table `analyzeAgentRecommendations` sorts with,
    // so a row can never say P2 beside a finding the sort treated as P0.
    render(actionableModel());

    const badges = [
      ...host.querySelectorAll<HTMLElement>("[data-issue-priority]"),
    ].map((element) => element.textContent);

    expect(badges).toEqual(["P0", "P1", "P2"]);
  });

  it("gives an unrecognised check no priority badge at all", () => {
    // `RESULT_PRIORITY[...] ?? "P2"` upstream is fail-open. If the badge were
    // rendered from that fallback, a state this build cannot read would arrive
    // dressed as an ordinary suggestion. Quarantine has to win first.
    render(
      buildAgentIssueModel({
        agent: "seo",
        checks: [check({ id: "9.9", result: "supernova" })],
        records: [],
      }),
    );

    expect(host.querySelector("[data-issue-priority]")).toBeNull();
    expect(host.textContent).not.toContain("P2");
  });

  describe("the key page reach", () => {
    function reachModel(
      reach: { total: number; evaluated: number; hits: number; urls: string[] },
      result = "warning",
    ) {
      return buildAgentIssueModel({
        agent: "seo",
        checks: [check({ id: "2.1", result, evidenceRecordIds: ["r1"] })],
        records: [record("r1", 12)],
        keyPageReach: new Map([
          [
            "2.1",
            {
              keyPageTotal: reach.total,
              keyPageEvaluatedCount: reach.evaluated,
              keyPageHitCount: reach.hits,
              hitUrls: reach.urls,
              outcomes: [],
            },
          ],
        ]),
      });
    }

    function reachText(): string {
      return (
        host.querySelector("[data-issue-key-page-reach]")?.textContent ?? ""
      );
    }

    it("states the key pages hit and the pages beyond them separately", () => {
      render(
        reachModel({ total: 12, evaluated: 12, hits: 3, urls: ["https://a/"] }),
      );

      // 12 affected overall, 3 of them key pages, so 9 elsewhere. Reporting
      // "3 pages" alone would understate it; "12" alone would lose the ones
      // this Profile actually cares about.
      expect(reachText()).toContain("3/12 key pages");
      expect(reachText()).toContain("another 9 pages");
    });

    it("says at least when the record did not enumerate its own population", () => {
      render(
        buildAgentIssueModel({
          agent: "seo",
          checks: [
            check({ id: "2.1", result: "warning", evidenceRecordIds: ["r1"] }),
          ],
          records: [
            {
              ...record("r1", 2),
              // Claims 30 affected while publishing 2 observations.
              affected: 30,
            } as never,
          ],
          keyPageReach: new Map([
            [
              "2.1",
              {
                keyPageTotal: 12,
                keyPageEvaluatedCount: 12,
                keyPageHitCount: 1,
                hitUrls: ["https://a/"],
                outcomes: [],
              },
            ],
          ]),
        }),
      );

      expect(reachText()).toContain("at least another");
    });

    it("states how much of the key set a passing check was judged on", () => {
      // The honest half of the fail-closed ruling: on a key page that is not
      // the submitted one many checks cannot pass, so "passing" has to say
      // how many pages it actually got to look at.
      render(
        reachModel(
          { total: 12, evaluated: 4, hits: 0, urls: [] },
          "pass",
        ),
      );

      const passed = host.querySelector(
        '[data-testid="agent-issues-passed"]',
      );
      expect(passed?.textContent).toContain("4/12 key pages evaluated");
    });

    it("never says passing for a check that reached no verdict", () => {
      // An excluded check counts zero evaluated pages. Rendering the passed
      // lane's wording there claimed a verdict it never reached; the
      // observed-only lane's heading says "not judged" and would have been
      // contradicted by the row directly under it.
      render(reachModel({ total: 12, evaluated: 0, hits: 0, urls: [] },
        "excluded"));
      expect(reachText()).toContain("0/12 key pages evaluated");
      expect(reachText()).not.toContain("passing");

      render(
        reachModel({ total: 12, evaluated: 3, hits: 0, urls: [] },
          "observed-only"),
      );
      expect(reachText()).toContain("3/12 key pages measured");
      expect(reachText()).not.toContain("passing");
    });

    it("never says passing on an actionable or investigation row", () => {
      // Same defect as the quiet lanes, in the other branch: a row whose
      // problem was found elsewhere on the site, and a source-gated row that
      // reached no verdict at all, both used the passed lane's wording.
      render(reachModel({ total: 12, evaluated: 12, hits: 0, urls: [] }));
      expect(reachText()).toContain("12/12 key pages evaluated");
      expect(reachText()).not.toContain("passing");
    });

    it("says nothing about key pages for a site-wide check", () => {
      render(
        buildAgentIssueModel({
          agent: "seo",
          checks: [
            check({ id: "D1", result: "warning", evidenceRecordIds: ["r1"] }),
          ],
          records: [record("r1", 2)],
          keyPageReach: new Map(),
        }),
      );

      expect(host.querySelector("[data-issue-key-page-reach]")).toBeNull();
    });
  });

  describe("the opened detail", () => {
    function openFirstRow() {
      render(actionableModel());
      click('[data-issue-control="expand-visible"]');
    }

    it("puts the handoff and its buttons before the reading blocks", () => {
      // The two buttons are what a reader reaches for once they have decided
      // the row matters. At the bottom of a long detail they were behind the
      // answer they act on.
      openFirstRow();
      const detail = host.querySelector("[data-issue-detail]")!;
      const handoff = detail.querySelector("[data-issue-handoff]")!;
      const firstBlock = detail.querySelector("[data-issue-block]")!;

      expect(handoff).not.toBeNull();
      expect(
        handoff.compareDocumentPosition(firstBlock) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("reads top to bottom rather than in two columns", () => {
      openFirstRow();
      const detail = host.querySelector("[data-issue-detail]")!;

      expect(detail.querySelector(".lg\\:grid-cols-2")).toBeNull();
    });

    it("sizes its own body text instead of inheriting the site's prose rule", () => {
      // `@layer base` sets `p { font-size: clamp(0.97rem, 1.4vw, 1.09rem) }`
      // for marketing prose — about 17px, larger than the issue title above
      // it. Every sibling line here carries an explicit size, so inheriting
      // left one paragraph per block towering over the rest.
      openFirstRow();
      const bodies = [
        ...host.querySelectorAll("[data-issue-block] > div"),
      ];

      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) {
        expect(body.className).toContain("[&_p]:text-[12.5px]");
      }
    });
  });

  it("renders no untranslated message key", () => {
    render(actionableModel());
    click('[data-issue-control="expand-visible"]');

    // next-intl renders a missing key as its own path, which reads as ordinary
    // text; asserting on the path is the only way that failure shows up.
    expect(host.textContent).not.toContain("agents.workbench.issues.");
    expect(host.textContent).not.toContain("agents.workbench.recommendations.");
  });
});
