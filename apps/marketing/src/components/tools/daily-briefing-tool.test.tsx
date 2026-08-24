// @vitest-environment jsdom
// @input  -- GSC connection states, brand confirmation, API responses, and localized messages
// @output -- state-reset, request, accessibility, and error-boundary guards for the Daily Briefing form
// @pos    -- primary interaction contract for /[locale]/tools/daily-search-briefing

import { act, type ComponentProps } from "react";
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
) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
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
      </NextIntlClientProvider>,
    );
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

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("shows both approved result previews before the first run without mock evidence", async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    const host = await renderTool();

    expect(host.querySelectorAll("[data-result-preview]")).toHaveLength(2);
    expect(host.textContent).toContain("Changes above the noise threshold");
    expect(host.textContent).toContain("Today's recommended actions");
    expect(host.textContent).toContain("Run the briefing to generate");
    expect(host.querySelector("[data-change]")).toBeNull();
    expect(host.querySelector("[data-action-row]")).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("replaces both result previews after a successful run", async () => {
    globalThis.fetch = vi.fn(async () => success()) as typeof fetch;
    const host = await renderTool();

    expect(host.querySelectorAll("[data-result-preview]")).toHaveLength(2);

    await click(buttonWith(host, "Build today's briefing"));

    expect(host.querySelectorAll("[data-result-preview]")).toHaveLength(0);
    expect(host.textContent).toContain("Daily briefing complete");
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
      "Reading complete Search Console windows",
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

  it("reads shared remaining-run facts from meta and keeps null unavailable", async () => {
    globalThis.fetch = vi.fn(async () =>
      success({ remaining: null, limit: 10 }),
    ) as typeof fetch;
    const host = await renderTool();

    await click(buttonWith(host, "Build today's briefing"));

    expect(host.textContent).toContain(
      "Remaining shared runs are unavailable; this is not zero.",
    );
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
