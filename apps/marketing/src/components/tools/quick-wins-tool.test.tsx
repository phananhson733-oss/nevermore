// @vitest-environment jsdom
// @input  -- one tab-scoped Daily Briefing handoff and granted GSC properties
// @output -- proof Quick Wins imports only a granted property without running
// @pos    -- client boundary between Daily Briefing evidence and Quick Wins

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TOOL_HANDOFF_KEY,
  writeToolHandoff,
} from "../../lib/tools/tool-handoff.ts";

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

const { QuickWinsTool } = await import("./quick-wins-tool.tsx");

const PROPERTY_A = "sc-domain:a.example";
const PROPERTY_B = "sc-domain:b.example";
const NOTICE =
  "Brought in from Daily Search Briefing. This tool has not been run again yet.";
const originalFetch = globalThis.fetch;
let root: Root | null = null;

function stageHandoff(property = PROPERTY_B): void {
  expect(
    writeToolHandoff(sessionStorage, Date.now(), {
      source: "daily-search-briefing",
      destination: "seo-quick-wins",
      property,
      query: "pricing automation",
      page: "https://b.example/pricing",
      evidenceId: "click-opportunity:pricing-automation",
    }),
  ).toBe(true);
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
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
  properties: readonly string[] = [PROPERTY_A, PROPERTY_B],
): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <QuickWinsTool
        locale="en"
        properties={properties}
        propertyTotal={properties.length}
        connectEnabled={true}
        consentNotice="none"
      />,
    );
  });
  return host;
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

function buttonWith(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!found) throw new Error(`no button for ${text}`);
  return found as HTMLButtonElement;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("Quick Wins Daily Briefing handoff", () => {
  it("consumes once, preselects a granted property, and does not auto-run", async () => {
    stageHandoff();

    const host = await renderTool();
    const property = host.querySelector("select") as HTMLSelectElement;

    expect(property.value).toBe(PROPERTY_B);
    expect(host.textContent).toContain(NOTICE);
    expect(sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("ignores a property outside the granted list", async () => {
    stageHandoff(PROPERTY_B);

    const host = await renderTool([PROPERTY_A]);
    const property = host.querySelector("select") as HTMLSelectElement;

    expect(property.value).toBe(PROPERTY_A);
    expect(host.textContent).not.toContain(NOTICE);
    expect(sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps the normal form usable when session storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    const host = await renderTool();

    expect((host.querySelector("select") as HTMLSelectElement).value).toBe(
      PROPERTY_A,
    );
    expect(host.textContent).not.toContain(NOTICE);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("clears the source notice when a run actually starts", async () => {
    let finishRequest!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishRequest = resolve;
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    stageHandoff();
    const host = await renderTool();
    expect(host.textContent).toContain(NOTICE);

    await click(buttonWith(host, "Find the gaps"));

    expect(host.textContent).not.toContain(NOTICE);
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

  it.each(["property", "brand"] as const)(
    "clears the source notice when the visitor changes the %s input",
    async (field) => {
      stageHandoff();
      const host = await renderTool();
      expect(host.textContent).toContain(NOTICE);

      if (field === "property") {
        await change(host.querySelector("select") as HTMLSelectElement, PROPERTY_A);
      } else {
        await change(
          host.querySelector('input[type="text"]') as HTMLInputElement,
          "acme",
        );
      }

      expect(host.textContent).not.toContain(NOTICE);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );
});
