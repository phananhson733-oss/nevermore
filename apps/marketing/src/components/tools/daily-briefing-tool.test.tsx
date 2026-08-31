// @vitest-environment jsdom
// @input  -- GSC connection states, brand confirmation, API responses, and localized messages
// @output -- state-reset, request, accessibility, and error-boundary guards for the Daily Briefing form
// @pos    -- primary interaction contract for /[locale]/tools/daily-search-briefing

import { act, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildDailyBriefing, type DailyBriefingEnvelope } from "@sf/public-tools";
import en from "../../i18n/messages/en.json";

const { trackMarketingEventMock, writeToolHandoffMock } = vi.hoisted(() => ({
  trackMarketingEventMock: vi.fn(),
  writeToolHandoffMock: vi.fn(),
}));

vi.mock("../layout/google-analytics", () => ({
  trackMarketingEvent: trackMarketingEventMock,
}));

vi.mock("../../lib/tools/tool-handoff", () => ({
  writeToolHandoff: writeToolHandoffMock,
}));

vi.mock("./gsc-connect-panel", () => ({
  GscConnectPanel: (props: {
    readonly namespace: string;
    readonly toolPath: string;
    readonly sectionId: string;
    readonly connectEnabled: boolean;
    readonly consentNotice: string;
  }) => (
    <section
      data-connect-panel
      data-namespace={props.namespace}
      data-tool-path={props.toolPath}
      data-section-id={props.sectionId}
      data-connect-enabled={String(props.connectEnabled)}
      data-consent-notice={props.consentNotice}
    />
  ),
  gscAuthorizeHref: (locale: string, path: string) =>
    `/api/auth/google/start?scope=gsc&next=${encodeURIComponent(
      locale === "zh" ? `/zh${path}` : path,
    )}`,
}));

vi.mock("./gsc-disconnect", () => ({
  GscDisconnect: ({ namespace }: { readonly namespace: string }) => (
    <div data-disconnect-namespace={namespace} />
  ),
}));

const { DailyBriefingTool } = await import("./daily-briefing-tool.tsx");

const PROPERTY = "sc-domain:example.com";
const SECOND_PROPERTY = "https://www.example.org/";
const originalFetch = globalThis.fetch;
let root: Root | null = null;

function completeDateRows() {
  const previous = [
    "2026-08-08",
    "2026-08-09",
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
  ];
  const current = [
    "2026-08-15",
    "2026-08-16",
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
  ];
  return [
    ...previous.map((date) => ({
      date,
      clicks: 10,
      impressions: 200,
      position: 8,
    })),
    ...current.map((date) => ({
      date,
      clicks: 12,
      impressions: 220,
      position: 7,
    })),
  ];
}

const ENVELOPE: DailyBriefingEnvelope = buildDailyBriefing({
  now: new Date("2026-08-24T20:00:00.000Z"),
  dateRows: completeDateRows(),
  currentQueryEvidence: null,
  previousQueryEvidence: null,
  brandTerms: [],
  brandTermsConfirmed: false,
});

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  trackMarketingEventMock.mockReset();
  writeToolHandoffMock.mockReset();
  writeToolHandoffMock.mockReturnValue(true);
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function renderTool(
  props: Partial<ComponentProps<typeof DailyBriefingTool>> = {},
  refreshProperties?: () => Promise<Response>,
  strict = false,
) {
  const reportFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input, init) => {
    if (input === "/api/tools/gsc-properties") {
      return refreshProperties?.() ?? Response.json({ data: {
        properties: props.properties ?? [PROPERTY],
        propertyTotal: props.propertyTotal ?? 1,
        brandCandidates: props.brandCandidates ?? { [PROPERTY]: ["example"] },
      } });
    }
    return reportFetch(input, init);
  }) as typeof fetch;
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    const tool = (
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        messages={{ tools: { dailyBriefing: en.tools.dailyBriefing } }}
      >
        <DailyBriefingTool
          locale="en"
          properties={[PROPERTY]}
          propertyTotal={1}
          connectEnabled={true}
          consentNotice="none"
          brandCandidates={{ [PROPERTY]: ["example"] }}
          {...props}
        />
      </NextIntlClientProvider>
    );
    root?.render(strict ? <StrictMode>{tool}</StrictMode> : tool);
  });
  return host;
}

function buttonWith(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((candidate) =>
    (candidate.textContent ?? "").includes(text),
  );
  if (!found) throw new Error(`no button for ${text}`);
  return found as HTMLButtonElement;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
}

async function changeValue(
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function success(
  meta: { readonly remaining: number | null; readonly limit: number } = {
    remaining: 7,
    limit: 10,
  },
): Response {
  return Response.json({ data: ENVELOPE, meta: { rateLimit: meta } });
}

function lastRequestBody(): Readonly<Record<string, unknown>> {
  const fetchMock = vi.mocked(globalThis.fetch);
  const init = fetchMock.mock.calls.at(-1)?.[1];
  return JSON.parse(String(init?.body)) as Readonly<Record<string, unknown>>;
}

describe("DailyBriefingTool connection boundary", () => {
  it("uses the shared daily-namespaced connect panel when no grant exists", async () => {
    const host = await renderTool({
      properties: null,
      propertyTotal: 0,
      consentNotice: "invite_only",
    });
    const panel = host.querySelector("[data-connect-panel]") as HTMLElement;

    expect(panel.dataset.namespace).toBe("tools.dailyBriefing");
    expect(panel.dataset.toolPath).toBe("/tools/daily-search-briefing");
    expect(panel.dataset.sectionId).toBe("daily-briefing-tool");
    expect(panel.dataset.consentNotice).toBe("invite_only");
  });

  it("keeps an empty granted property list distinct and uses the daily disconnect namespace", async () => {
    const host = await renderTool({ properties: [], propertyTotal: 0 });

    expect(host.textContent).toContain("No verified property in this grant");
    expect(
      (host.querySelector("[data-disconnect-namespace]") as HTMLElement).dataset
        .disconnectNamespace,
    ).toBe("tools.dailyBriefing");
    expect(host.querySelector("[data-connect-panel]")).toBeNull();
  });

  it("does not run automatically on mount", async () => {
    globalThis.fetch = vi.fn() as typeof fetch;

    await renderTool();

    expect(vi.mocked(globalThis.fetch).mock.calls.every(([url]) => url === "/api/tools/gsc-properties")).toBe(true);
  });

  it("shows both approved result previews before the first run without mock evidence", async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    const host = await renderTool();

    expect(host.querySelectorAll("[data-result-preview]")).toHaveLength(2);
    expect(host.textContent).toContain("Queries and pages to review today");
    expect(host.textContent).toContain("Today's recommended actions");
    expect(host.textContent).toContain("Read the latest available reporting windows");
    expect(host.querySelector("[data-change]")).toBeNull();
    expect(host.querySelector("[data-action-row]")).toBeNull();
    expect(vi.mocked(globalThis.fetch).mock.calls.every(([url]) => url === "/api/tools/gsc-properties")).toBe(true);
  });

  it("replaces both result previews after a successful run", async () => {
    globalThis.fetch = vi.fn(async () => success()) as typeof fetch;
    const host = await renderTool();

    expect(host.querySelectorAll("[data-result-preview]")).toHaveLength(2);

    await click(buttonWith(host, "Build today's briefing"));

    expect(host.querySelectorAll("[data-result-preview]")).toHaveLength(0);
    expect(host.textContent).toContain("Search performance trend");
  });
});

describe("DailyBriefingTool brand confirmation and request body", () => {
  it("does not infer confirmation from a nonempty candidate list", async () => {
    globalThis.fetch = vi.fn(async () => success()) as typeof fetch;
    const host = await renderTool();

    await click(buttonWith(host, "Build today's briefing"));

    expect(lastRequestBody()).toEqual({
      property: PROPERTY,
      brandTerms: ["example"],
      brandTermsConfirmed: false,
    });
  });

  it("allows an explicitly confirmed empty brand list", async () => {
    globalThis.fetch = vi.fn(async () => success()) as typeof fetch;
    const host = await renderTool();
    const input = host.querySelector(
      'input[name="brandTerms"]',
    ) as HTMLInputElement;
    const confirmation = host.querySelector(
      'input[name="brandTermsConfirmed"]',
    ) as HTMLInputElement;

    await changeValue(input, "");
    await click(confirmation);
    await click(buttonWith(host, "Build today's briefing"));

    expect(lastRequestBody()).toEqual({
      property: PROPERTY,
      brandTerms: [],
      brandTermsConfirmed: true,
    });
  });

  it("clears confirmation, report, self-checks, and errors when the property changes", async () => {
    globalThis.fetch = vi.fn(async () => success()) as typeof fetch;
    const host = await renderTool({
      properties: [PROPERTY, SECOND_PROPERTY],
      propertyTotal: 2,
      brandCandidates: {
        [PROPERTY]: ["example"],
        [SECOND_PROPERTY]: ["example org"],
      },
    });
    const confirmation = host.querySelector(
      'input[name="brandTermsConfirmed"]',
    ) as HTMLInputElement;

    await click(confirmation);
    await click(buttonWith(host, "Build today's briefing"));
    await click(buttonWith(host, "Mark checked for this page"));
    expect(host.textContent).toContain("Marked on this page");
    expect(host.querySelectorAll("[data-result-preview]")).toHaveLength(0);

    await changeValue(
      host.querySelector('select[name="property"]') as HTMLSelectElement,
      SECOND_PROPERTY,
    );

    expect(confirmation.checked).toBe(false);
    expect(
      (host.querySelector('input[name="brandTerms"]') as HTMLInputElement).value,
    ).toBe("example org");
    expect(host.textContent).not.toContain("Daily briefing complete");
    expect(host.textContent).not.toContain("Marked on this page");
    expect(host.querySelectorAll("[data-result-preview]")).toHaveLength(2);
  });

  it("clears an existing report and confirmation when brand terms are edited", async () => {
    globalThis.fetch = vi.fn(async () => success()) as typeof fetch;
    const host = await renderTool();
    const confirmation = host.querySelector(
      'input[name="brandTermsConfirmed"]',
    ) as HTMLInputElement;
    const input = host.querySelector(
      'input[name="brandTerms"]',
    ) as HTMLInputElement;

    await click(confirmation);
    await click(buttonWith(host, "Build today's briefing"));
    expect(host.querySelectorAll("[data-result-preview]")).toHaveLength(0);

    await changeValue(input, "example, example cloud");

    expect(confirmation.checked).toBe(false);
    expect(host.textContent).not.toContain("Daily briefing complete");
    expect(host.querySelectorAll("[data-result-preview]")).toHaveLength(2);
  });

  it("clears an existing report and restores previews when confirmation changes", async () => {
    globalThis.fetch = vi.fn(async () => success()) as typeof fetch;
    const host = await renderTool();
    const confirmation = host.querySelector(
      'input[name="brandTermsConfirmed"]',
    ) as HTMLInputElement;

    await click(confirmation);
    await click(buttonWith(host, "Build today's briefing"));
    expect(host.querySelectorAll("[data-result-preview]")).toHaveLength(0);

    await click(confirmation);

    expect(confirmation.checked).toBe(false);
    expect(host.textContent).not.toContain("Daily briefing complete");
    expect(host.querySelectorAll("[data-result-preview]")).toHaveLength(2);
  });
});

describe("DailyBriefingTool request states and errors", () => {
  it("never attaches a pending property's report to a newly selected property", async () => {
    let resolveRead: ((value: Response) => void) | undefined;
    globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => { resolveRead = resolve; })) as typeof fetch;
    const host = await renderTool({ properties: [PROPERTY, SECOND_PROPERTY], propertyTotal: 2 });
    const select = host.querySelector('select[name="property"]') as HTMLSelectElement;
    await click(buttonWith(host, "Build today's briefing"));
    expect(lastRequestBody().property).toBe(PROPERTY);

    // Reproduces a queued change while the request is pending. Disabled
    // controls prevent user edits; stale queued events must still be safe.
    await changeValue(select, SECOND_PROPERTY);
    await act(async () => { resolveRead?.(success()); });

    const facts = host.querySelector("[data-reading-facts]");
    expect(facts?.textContent ?? "").not.toContain(SECOND_PROPERTY);
    if (select.value === SECOND_PROPERTY) expect(facts).toBeNull();
  });

  it("locks every run input until its submitted request finishes", async () => {
    let resolveRead: ((value: Response) => void) | undefined;
    globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => { resolveRead = resolve; })) as typeof fetch;
    const host = await renderTool({ properties: [PROPERTY, SECOND_PROPERTY], propertyTotal: 2 });
    await click(buttonWith(host, "Build today's briefing"));
    const controls = [...host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('select[name="property"], input[name="brandTerms"], input[name="brandTermsConfirmed"]')];
    expect(controls).toHaveLength(3);
    expect(controls.every((control) => control.disabled)).toBe(true);
    await act(async () => { resolveRead?.(success()); });
    expect(controls.every((control) => !control.disabled)).toBe(true);
    expect(host.querySelector("[data-reading-facts]")?.textContent).toContain(PROPERTY);
  });

  it("ignores an older response after a newer property run has completed", async () => {
    let resolveOld: ((value: Response) => void) | undefined;
    let resolveNew: ((value: Response) => void) | undefined;
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveNew = resolve; })) as typeof fetch;
    const host = await renderTool({ properties: [PROPERTY, SECOND_PROPERTY], propertyTotal: 2 });
    await click(buttonWith(host, "Build today's briefing"));
    await changeValue(host.querySelector('select[name="property"]') as HTMLSelectElement, SECOND_PROPERTY);
    // A queued change invalidates the old response even if it raced with the
    // disabled state being painted; it must not prevent the replacement run.
    await click(buttonWith(host, "Build today's briefing"));
    const newerReadAt = "2026-08-24T20:02:00.000Z";
    await act(async () => {
      resolveNew?.(Response.json({ data: {
        ...ENVELOPE,
        result: { ...ENVELOPE.result, freshness: { ...ENVELOPE.result.freshness, readAt: newerReadAt } },
      } }));
    });
    await act(async () => { resolveOld?.(success()); });
    expect(lastRequestBody().property).toBe(SECOND_PROPERTY);
    const facts = host.querySelector("[data-reading-facts]");
    expect(facts?.textContent).toContain(SECOND_PROPERTY);
    expect(facts?.querySelector("time")?.getAttribute("dateTime")).toBe(newerReadAt);
    const gscLinks = [...host.querySelectorAll<HTMLAnchorElement>('a[href*="search.google.com/search-console/"]')];
    expect(gscLinks.length).toBeGreaterThan(0);
    expect(gscLinks.every((link) => new URL(link.href).searchParams.get("resource_id") === SECOND_PROPERTY)).toBe(true);
  });

  it("exposes an aria-busy live loading state and clears the old report on rerun", async () => {
    let resolveSecond: ((value: Response) => void) | undefined;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(success())
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveSecond = resolve;
          }),
      ) as typeof fetch;
    const host = await renderTool();

    await click(buttonWith(host, "Build today's briefing"));
    await click(buttonWith(host, "Mark checked for this page"));
    await click(buttonWith(host, "Rerun briefing"));

    const region = host.querySelector("#daily-briefing-tool") as HTMLElement;
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Reading the latest available Search Console data",
    );
    expect(host.textContent).not.toContain("Daily briefing complete");
    expect(host.textContent).not.toContain("Marked on this page");

    await act(async () => {
      resolveSecond?.(success());
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(region.getAttribute("aria-busy")).toBe("false");
  });

  it("does not surface shared-run quota facts after the result status cards were removed", async () => {
    globalThis.fetch = vi.fn(async () =>
      success({ remaining: null, limit: 10 }),
    ) as typeof fetch;
    const host = await renderTool();

    await click(buttonWith(host, "Build today's briefing"));

    expect(host.textContent).toContain("Search performance trend");
    expect(host.textContent).not.toContain("Remaining shared runs");
    expect(host.textContent).not.toContain("0/10");
  });

  it("humanizes known and unknown errors without rendering raw codes", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "rate_limited" } },
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "provider_secret_detail" } },
          { status: 502 },
        ),
      ) as typeof fetch;
    const host = await renderTool();

    await click(buttonWith(host, "Build today's briefing"));
    expect(host.textContent).toContain("shared hourly Search Console run limit");
    expect(host.textContent).not.toContain("rate_limited");

    await click(buttonWith(host, "Build today's briefing"));
    expect(host.textContent).toContain("Something went wrong");
    expect(host.textContent).not.toContain("provider_secret_detail");
  });

  it("offers the locale-safe reconnect path only for a revoked grant", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ error: { code: "gsc_revoked" } }, { status: 401 }),
    ) as typeof fetch;
    const host = await renderTool();

    await click(buttonWith(host, "Build today's briefing"));

    const reconnect = [...host.querySelectorAll("a")].find((anchor) =>
      (anchor.textContent ?? "").includes("Connect Search Console again"),
    );
    expect(reconnect?.getAttribute("href")).toBe(
      "/api/auth/google/start?scope=gsc&next=%2Ftools%2Fdaily-search-briefing",
    );
    expect(host.textContent).not.toContain("gsc_revoked");
  });
});

describe("fresh Search Console properties", () => {
  const fresh = (properties: readonly string[]) => Response.json({ data: {
    properties,
    propertyTotal: properties.length,
    brandCandidates: { [PROPERTY]: ["example"], [SECOND_PROPERTY]: ["new brand"] },
  } });

  it("loads a newly granted site on mount without logging out or running a report", async () => {
    globalThis.fetch = vi.fn(async () => success()) as typeof fetch;
    const host = await renderTool({}, async () => fresh([PROPERTY, SECOND_PROPERTY]));
    const select = host.querySelector<HTMLSelectElement>("select")!;
    expect([...select.options].map((option) => option.value)).toEqual([PROPERTY, SECOND_PROPERTY]);
    expect(select.value).toBe(PROPERTY);
    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(1);
    expect(trackMarketingEventMock).not.toHaveBeenCalled();
    await changeValue(select, SECOND_PROPERTY);
    expect(host.querySelector<HTMLInputElement>('input[name="brandTerms"]')?.value).toBe("new brand");
    await click(buttonWith(host, "Build today's briefing"));
    expect(lastRequestBody().property).toBe(SECOND_PROPERTY);
  });

  it("completes the automatic refresh under Strict Mode effect remounts", async () => {
    const host = await renderTool({}, async () => fresh([PROPERTY, SECOND_PROPERTY]), true);
    expect(host.querySelectorAll("select option")).toHaveLength(2);
    expect(buttonWith(host, "Refresh sites").disabled).toBe(false);
  });

  it("coalesces focus and click requests while a refresh is pending", async () => {
    let finish!: (response: Response) => void;
    const refresh = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const host = await renderTool({}, refresh);
    expect(buttonWith(host, "Refreshing sites").disabled).toBe(true);
    expect(buttonWith(host, "Build today's briefing").disabled).toBe(true);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(refresh).toHaveBeenCalledOnce();
    await act(async () => { finish(fresh([PROPERTY, SECOND_PROPERTY])); });
    expect(buttonWith(host, "Refresh sites").disabled).toBe(false);
  });

  it("refreshes on returning to the page and preserves the selected site's inputs and report", async () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000);
    globalThis.fetch = vi.fn(async () => success()) as typeof fetch;
    const refresh = vi.fn().mockResolvedValueOnce(fresh([PROPERTY])).mockResolvedValueOnce(fresh([SECOND_PROPERTY, PROPERTY]));
    const host = await renderTool({}, refresh);
    const brand = host.querySelector<HTMLInputElement>('input[name="brandTerms"]')!;
    await changeValue(brand, "my custom brand");
    await click(host.querySelector<HTMLInputElement>('input[name="brandTermsConfirmed"]')!);
    await click(buttonWith(host, "Build today's briefing"));
    vi.spyOn(Date, "now").mockReturnValue(131_000);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe(PROPERTY);
    expect(brand.value).toBe("my custom brand");
    expect(host.querySelector<HTMLInputElement>('input[name="brandTermsConfirmed"]')?.checked).toBe(true);
    expect(host.textContent).toContain("Search performance trend");
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("recovers from an empty saved list when the first site is added", async () => {
    const host = await renderTool({ properties: [], propertyTotal: 0 }, async () => fresh([SECOND_PROPERTY]));
    expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe(SECOND_PROPERTY);
    expect(host.querySelector<HTMLInputElement>('input[name="brandTerms"]')?.value).toBe("new brand");
  });

  it("keeps the saved list on temporary failure and offers refresh without reconnecting", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(fresh([PROPERTY, SECOND_PROPERTY]));
    const host = await renderTool({}, refresh);
    expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe(PROPERTY);
    expect(host.textContent).toContain("Could not refresh the site list");
    expect(host.querySelector('a[href*="/api/auth/google/start"]')).toBeNull();
    await click(buttonWith(host, "Refresh sites"));
    expect(host.querySelectorAll("select option")).toHaveLength(2);
    expect(host.textContent).not.toContain("Could not refresh the site list");
  });

  it("clears site-owned state and asks for a selection if access to the selected site disappears", async () => {
    globalThis.fetch = vi.fn(async () => success()) as typeof fetch;
    const refresh = vi.fn().mockResolvedValueOnce(fresh([PROPERTY])).mockResolvedValueOnce(fresh([SECOND_PROPERTY]));
    const host = await renderTool({}, refresh);
    await click(host.querySelector<HTMLInputElement>('input[name="brandTermsConfirmed"]')!);
    await click(buttonWith(host, "Build today's briefing"));
    await click(buttonWith(host, "Refresh sites"));
    expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe("");
    expect(host.querySelector<HTMLInputElement>('input[name="brandTerms"]')?.value).toBe("");
    expect(host.querySelector<HTMLInputElement>('input[name="brandTermsConfirmed"]')?.checked).toBe(false);
    expect(host.textContent).not.toContain("Search performance trend");
    expect(buttonWith(host, "Build today's briefing").disabled).toBe(true);
  });

  it("does not fetch properties for a disconnected visitor", async () => {
    const refresh = vi.fn(async () => fresh([PROPERTY]));
    await renderTool({ properties: null }, refresh);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("report shape the client accepts", () => {
  it("matches the version the package produces", async () => {
    // The client holds the version as a literal so a value import cannot pull
    // the package barrel into its bundle. This is what keeps the two equal.
    const { DAILY_BRIEFING_SCHEMA_VERSION } = await import("@sf/public-tools");
    const { CLIENT_DAILY_BRIEFING_SCHEMA_VERSION } = await import(
      "./daily-briefing-tool.tsx"
    );

    expect(CLIENT_DAILY_BRIEFING_SCHEMA_VERSION).toBe(
      DAILY_BRIEFING_SCHEMA_VERSION,
    );
  });
});
