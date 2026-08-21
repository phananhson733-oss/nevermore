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

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function render(model: ReturnType<typeof buildAgentIssueModel>) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={en}>
          <AgentIssueAccordion
            model={model}
            locale="en"
            profile={profile()}
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

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });

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

  it("renders no untranslated message key", () => {
    render(actionableModel());
    click('[data-issue-control="expand-visible"]');

    // next-intl renders a missing key as its own path, which reads as ordinary
    // text; asserting on the path is the only way that failure shows up.
    expect(host.textContent).not.toContain("agents.workbench.issues.");
    expect(host.textContent).not.toContain("agents.workbench.recommendations.");
  });
});
