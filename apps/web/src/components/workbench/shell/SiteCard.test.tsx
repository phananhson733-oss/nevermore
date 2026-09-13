/** @vitest-environment jsdom */

/**
 * The site card is three rows of "what do we know about this site", and each
 * row has a not-known rendering that must not look like a value: a missing
 * market, a GSC status the shell has not wired yet (`null`, distinct from "not
 * connected"), and an audit that never ran or has not been read from storage
 * yet. The date row is the one mock-backed value, so it carries the sample
 * marker.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditReport } from "@/lib/workbench/types";
import { SiteCard, type SidebarSite } from "./SiteCard.tsx";

const en = getMessages("en");
const zh = getMessages("zh-CN");

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const SITE: SidebarSite = { host: "example.test", marketCode: "US", gscConnected: true };
const REPORT: AuditReport = {
  at: "2026-09-11 10:00",
  score: 56,
  findings: [],
  crawl: { pages: 1, indexable: 1, blocked: 0, orphan: 0, lcp: "2.4", schema: 0, llmReadable: 50 },
  pageRows: [],
};
const NONE = en.workbench.shell.siteCard.none;

let cleanup: (() => void) | null = null;

function render(
  props: { readonly site?: SidebarSite; readonly lastAudit?: AuditReport | null; readonly ready?: boolean },
  locale: "en" | "zh-CN" = "en",
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh} timeZone="UTC">
        <SiteCard site={props.site ?? SITE} lastAudit={props.lastAudit ?? null} ready={props.ready ?? true} />
      </NextIntlClientProvider>,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

/** The three `<dd>` values in row order: market, GSC, audit. */
function rows(scope: ParentNode): readonly string[] {
  return [...scope.querySelectorAll("[data-wb-site-card] dd")].map((node) => node.textContent ?? "");
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("SiteCard", () => {
  it("shows the host with the market code and a connected GSC", () => {
    const scope = render({});

    expect(scope.querySelector("[data-wb-site-card]")?.textContent).toContain(SITE.host);
    expect(rows(scope)).toEqual(["US", "Connected", NONE]);
  });

  it("distinguishes GSC not connected from GSC not wired yet", () => {
    expect(rows(render({ site: { ...SITE, gscConnected: false } }))).toEqual(["US", "Not connected", NONE]);
    cleanup?.();
    expect(rows(render({ site: { ...SITE, gscConnected: null } }))).toEqual(["US", NONE, NONE]);
  });

  it("renders a missing market as none rather than an empty cell", () => {
    expect(rows(render({ site: { ...SITE, marketCode: null } }))).toEqual([NONE, "Connected", NONE]);
  });

  it("shows the last audit's date with the sample marker once the store is ready", () => {
    const scope = render({ lastAudit: REPORT });
    const audit = rows(scope)[2] ?? "";

    // `at` is "YYYY-MM-DD HH:mm"; the rail has room for the month onwards.
    expect(audit.startsWith("09-11 10:00")).toBe(true);
    expect(audit).toContain(en.workbench.shell.sampleData);
    expect(audit).not.toContain("2026-");
  });

  it("keeps the audit row at none until the store has been read", () => {
    // Before hydration the seed state carries no audit; showing one from a
    // stale render would claim a run that this browser has not confirmed.
    expect(rows(render({ lastAudit: REPORT, ready: false }))[2]).toBe(NONE);
  });

  it("uses the Chinese GSC copy under zh-CN", () => {
    expect(rows(render({ site: { ...SITE, gscConnected: false } }, "zh-CN"))[1]).toBe("未接入");
    cleanup?.();
    expect(rows(render({}, "zh-CN"))[1]).toBe("已接入");
  });
});
