// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import zh from "../../i18n/messages/zh.json";
import { DailyBriefingEvidence } from "./daily-briefing-evidence";

let root: Root | null = null;
const windows = {
  latestDay: { startDate: "2026-08-30", endDate: "2026-08-30" },
  previousDay: { startDate: "2026-08-29", endDate: "2026-08-29" },
  current7Days: { startDate: "2026-08-24", endDate: "2026-08-30" },
  previous7Days: { startDate: "2026-08-17", endDate: "2026-08-23" },
  readRange: { startDate: "2026-08-17", endDate: "2026-08-30" },
};

async function render(overrides: Partial<ComponentProps<typeof DailyBriefingEvidence>> = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(
    <NextIntlClientProvider locale="zh" messages={zh}>
      <DailyBriefingEvidence property="sc-domain:example.com" windows={windows} scope="page" page="https://example.com/article" current={{ clicks: 0, impressions: 16, position: 8.3 }} previous={{ clicks: 0, impressions: 110, position: 9.4 }} comparisonEligible verification={null} {...overrides} />
    </NextIntlClientProvider>,
  ));
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("readable Daily Briefing evidence", () => {
  it("groups each period into labeled metrics while retaining exact GSC dates and filters", async () => {
    const host = await render();
    const current = host.querySelector('[data-evidence-period="current"]');
    const previous = host.querySelector('[data-evidence-period="previous"]');
    expect(current?.textContent).toContain("2026-08-24");
    expect(previous?.textContent).toContain("2026-08-17");
    expect(current?.querySelectorAll("[data-evidence-metric]")).toHaveLength(4);
    expect(current?.querySelector('[data-evidence-metric="impressions"] dd')?.textContent).toBe("16");
    expect(previous?.querySelector('[data-evidence-metric="position"] dd')?.textContent).toBe("9.4");
    expect(host.textContent).not.toContain("sc-domain:");
    expect(host.textContent).not.toContain("byPage");
    const link = current?.querySelector<HTMLAnchorElement>("a");
    expect(new URL(link!.href).searchParams.get("resource_id")).toBe("sc-domain:example.com");
    expect(new URL(link!.href).searchParams.get("page")).toBe("!https://example.com/article");
    expect(new URL(link!.href).searchParams.get("start_date")).toBe("20260824");
  });

  it("keeps measured zero separate from unavailable CTR and position", async () => {
    const host = await render({ current: { clicks: 0, impressions: 0, position: null } });
    const current = host.querySelector('[data-evidence-period="current"]');
    expect(current?.querySelector('[data-evidence-metric="clicks"] dd')?.textContent).toBe("0");
    expect(current?.querySelector('[data-evidence-metric="ctr"] dd')?.textContent).toBe(zh.tools.dailyBriefing.kpis.unavailable);
    expect(current?.querySelector('[data-evidence-metric="position"] dd')?.textContent).toBe(zh.tools.dailyBriefing.kpis.unavailable);
  });

  it("does not render prior metrics when the comparison is unavailable", async () => {
    const host = await render({ comparisonEligible: false, previousEvidence: "not_compared" });
    const previous = host.querySelector('[data-evidence-period="previous"]');
    expect(previous?.querySelectorAll("[data-evidence-metric]")).toHaveLength(0);
    expect(previous?.textContent).toContain(zh.tools.dailyBriefing.sourceEvidence.notCompared);
    expect(previous?.querySelector("a[data-gsc-period=previous]")).not.toBeNull();
  });
});
