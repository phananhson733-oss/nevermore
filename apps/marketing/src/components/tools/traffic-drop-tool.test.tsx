// @vitest-environment jsdom
// @input  -- Daily Briefing handoffs plus property-owned diagnosis form state
// @output -- proof an import resets site-specific answers and never auto-runs
// @pos    -- client boundary between Daily Briefing evidence and Traffic Drop

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TOOL_HANDOFF_KEY,
  writeToolHandoff,
} from "../../lib/tools/tool-handoff.ts";

const gateHarness = vi.hoisted(() => ({ startsAnswered: false }));

vi.mock("./traffic-drop-self-check-gate", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("./traffic-drop-self-check-gate.tsx")
    >();
  return {
    ...actual,
    emptyDraft: (property: string) =>
      gateHarness.startsAnswered
        ? {
            property,
            manualAction: "reports_none" as const,
            securityIssue: "reports_none" as const,
          }
        : actual.emptyDraft(property),
  };
});

vi.mock("next-intl", async () => {
  const catalogue = (
    await import("../../i18n/messages/en.json", { with: { type: "json" } })
  ).default as unknown as Record<string, unknown>;

  return {
    useTranslations: (namespace: string) =>
      (key: string, values?: Record<string, unknown>) => {
        const path = `${namespace}.${key}`;
        const raw = path
          .split(".")
          .reduce<unknown>(
            (node, part) =>
              typeof node === "object" && node !== null
                ? (node as Record<string, unknown>)[part]
                : undefined,
            catalogue,
          );
        if (typeof raw !== "string") return path;
        if (values === undefined) return raw;
        return raw.replaceAll(
          /\{(\w+)\}/g,
          (_match: string, name: string) => String(values[name] ?? `{${name}}`),
        );
      },
  };
});

vi.mock("../layout/google-analytics", () => ({
  trackMarketingEvent: vi.fn(),
}));

vi.mock("./gsc-disconnect", () => ({
  GscDisconnect: () => null,
}));

const { TrafficDropTool } = await import("./traffic-drop-tool.tsx");

const PROPERTY_A = "sc-domain:a.example";
const PROPERTY_B = "sc-domain:b.example";
const PROPERTIES = [PROPERTY_A, PROPERTY_B] as const;
const BRAND_CANDIDATES = {
  [PROPERTY_A]: ["alpha"],
  [PROPERTY_B]: ["bravo"],
} as const;
const NOTICE =
  "Brought in from Daily Search Briefing. This tool has not been run again yet.";
const originalFetch = globalThis.fetch;
let root: Root | null = null;
let host: HTMLElement | null = null;

function stageHandoff(property = PROPERTY_B): void {
  expect(
    writeToolHandoff(sessionStorage, Date.now(), {
      source: "daily-search-briefing",
      destination: "traffic-drop-diagnosis",
      scope: "query_page",
      property,
      query: "workflow templates",
      page: "https://b.example/templates",
      evidenceId: "stable-position-click-decline:workflow-templates",
    }),
  ).toBe(true);
}

function stagePropertyHandoff(property = PROPERTY_B): void {
  expect(
    writeToolHandoff(sessionStorage, Date.now(), {
      source: "daily-search-briefing",
      destination: "traffic-drop-diagnosis",
      scope: "property",
      property,
      query: null,
      page: null,
      evidenceId: "sitewide-click-decline",
    }),
  ).toBe(true);
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  gateHarness.startsAnswered = false;
  sessionStorage.clear();
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  host = null;
  document.body.replaceChildren();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function renderTool(properties: readonly string[] = PROPERTIES) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await rerender(properties);
  return host;
}

async function rerender(properties: readonly string[]): Promise<void> {
  await act(async () => {
    root?.render(
      <TrafficDropTool
        locale="en"
        properties={properties}
        propertyTotal={properties.length}
        connectEnabled={true}
        consentNotice="none"
        brandCandidates={BRAND_CANDIDATES}
      />,
    );
  });
}

function buttonWith(text: string): HTMLButtonElement {
  const found = [...(host?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!found) throw new Error(`no button for ${text}`);
  return found as HTMLButtonElement;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function change(
  field: HTMLInputElement | HTMLSelectElement,
  value: string,
): Promise<void> {
  const prototype =
    field instanceof HTMLSelectElement
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}

function propertyField(): HTMLSelectElement {
  return host?.querySelector("#traffic-drop-property") as HTMLSelectElement;
}

function brandField(): HTMLInputElement {
  return host?.querySelector(
    "#traffic-drop-brand-terms",
  ) as HTMLInputElement;
}

function brandConfirmation(): HTMLInputElement {
  return host?.querySelector('input[type="checkbox"]') as HTMLInputElement;
}

describe("Traffic Drop Daily Briefing handoff", () => {
  it("consumes once and resets every property-owned input before selecting the granted site", async () => {
    await renderTool();
    const noIssueButtons = [...(host?.querySelectorAll("button") ?? [])].filter(
      (button) => button.textContent?.trim() === "It says “No issues detected”",
    );
    expect(noIssueButtons).toHaveLength(2);
    await click(noIssueButtons[0] as HTMLButtonElement);
    await click(noIssueButtons[1] as HTMLButtonElement);
    await click(brandConfirmation());
    expect(buttonWith("Run analysis").disabled).toBe(false);

    stageHandoff();
    await rerender([...PROPERTIES]);

    expect(propertyField().value).toBe(PROPERTY_B);
    expect(brandField().value).toBe("bravo");
    expect(brandConfirmation().checked).toBe(false);
    expect(
      [...(host?.querySelectorAll('button[aria-pressed="true"]') ?? [])],
    ).toHaveLength(0);
    expect(buttonWith("Run analysis").disabled).toBe(true);
    expect(host?.textContent).toContain(NOTICE);
    expect(sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("imports property scope and resets every property-owned input without running", async () => {
    await renderTool();
    const noIssueButtons = [...(host?.querySelectorAll("button") ?? [])].filter(
      (button) => button.textContent?.trim() === "It says “No issues detected”",
    );
    await click(noIssueButtons[0] as HTMLButtonElement);
    await click(noIssueButtons[1] as HTMLButtonElement);
    await click(brandConfirmation());
    expect(buttonWith("Run analysis").disabled).toBe(false);

    stagePropertyHandoff();
    await rerender([...PROPERTIES]);

    expect(propertyField().value).toBe(PROPERTY_B);
    expect(brandField().value).toBe("bravo");
    expect(brandConfirmation().checked).toBe(false);
    expect(
      [...(host?.querySelectorAll('button[aria-pressed="true"]') ?? [])],
    ).toHaveLength(0);
    expect(buttonWith("Run analysis").disabled).toBe(true);
    expect(host?.textContent).toContain(NOTICE);
    expect(sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("ignores a property outside the granted list", async () => {
    stageHandoff(PROPERTY_B);

    await renderTool([PROPERTY_A]);

    expect(propertyField().value).toBe(PROPERTY_A);
    expect(host?.textContent).not.toContain(NOTICE);
    expect(sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps the normal form usable when session storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    await renderTool();

    expect(propertyField().value).toBe(PROPERTY_A);
    expect(host?.textContent).not.toContain(NOTICE);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("clears the source notice when a run actually starts", async () => {
    gateHarness.startsAnswered = true;
    let finishRequest!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishRequest = resolve;
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    stageHandoff();
    await renderTool();
    expect(host?.textContent).toContain(NOTICE);
    expect(buttonWith("Run analysis").disabled).toBe(false);

    await click(buttonWith("Run analysis"));

    expect(host?.textContent).not.toContain(NOTICE);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishRequest(
        Response.json(
          { error: { code: "gsc_unavailable" } },
          { status: 502 },
        ),
      );
      await Promise.resolve();
    });
  });

  it.each(["property", "brand", "self-check"] as const)(
    "clears the source notice when the visitor changes the %s input",
    async (field) => {
      stageHandoff();
      await renderTool();
      expect(host?.textContent).toContain(NOTICE);

      if (field === "property") {
        await change(propertyField(), PROPERTY_A);
      } else if (field === "brand") {
        await change(brandField(), "changed brand");
      } else {
        await click(buttonWith("It lists a manual action"));
      }

      expect(host?.textContent).not.toContain(NOTICE);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );
});
