// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KeywordOpportunityResult } from "@sf/public-tools/keyword-opportunity";
import {
  KEYWORD_WORKFLOW_STORAGE_KEY,
  writeKeywordWorkflowPointer,
} from "../../lib/tools/keyword-workflow-client.ts";

vi.mock("next-intl", async () => {
  const catalogue = (
    await import("../../i18n/messages/en.json", { with: { type: "json" } })
  ).default as unknown as Record<string, unknown>;
  return {
    useTranslations: (namespace: string) =>
      (key: string, values?: Record<string, unknown>) => {
        const raw = `${namespace}.${key}`
          .split(".")
          .reduce<unknown>(
            (node, part) =>
              typeof node === "object" && node !== null
                ? (node as Record<string, unknown>)[part]
                : undefined,
            catalogue,
          );
        if (typeof raw !== "string") return `${namespace}.${key}`;
        return values === undefined
          ? raw
          : raw.replaceAll(
              /\{(\w+)\}/g,
              (_match: string, name: string) =>
                String(values[name] ?? `{${name}}`),
            );
      },
  };
});

vi.mock("../layout/google-analytics", () => ({
  trackMarketingEvent: vi.fn(),
}));
vi.mock("./gsc-disconnect", () => ({ GscDisconnect: () => null }));
vi.mock("./keyword-map-results", () => ({
  KeywordMapResults: ({ result }: { result: KeywordOpportunityResult }) => (
    <div data-testid="keyword-result">{result.rows.length} rows</div>
  ),
}));

const { KeywordMapTool } = await import("./keyword-map-tool.tsx");

const PROPERTY = "sc-domain:example.com";
const CONTEXT = {
  contextToken: "sealed-context",
  propositions: [
    {
      statement: "Automate clinic appointments",
      sourceUrl: "https://example.com/product",
    },
  ],
  pagesFetched: 5,
  productPagesFetched: 1,
  contextSufficient: true,
  stopReason: "max_urls",
};
const RESULT = {
  availability: "available",
  rows: [{ keyword: "clinic appointment automation" }],
  withheld: [],
  clusters: [],
  unavailableStages: [],
  nextStepSuggestions: [],
} as unknown as KeywordOpportunityResult;

let root: Root | null = null;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  sessionStorage.clear();
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function renderTool(): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <KeywordMapTool
        locale="en"
        properties={[PROPERTY]}
        propertyTotal={1}
        connectEnabled={true}
        consentNotice="none"
        markets={["US"]}
      />,
    );
  });
  return host;
}

function buttonWith(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (button === undefined) throw new Error(`button not found: ${text}`);
  return button;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
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

async function readAndConfirm(host: HTMLElement): Promise<void> {
  await click(buttonWith(host, "Read my site"));
  expect(host.textContent).toContain("What we read off your site");
  expect(host.textContent).toContain(
    "The 20-page context limit was reached; later eligible pages were not read",
  );
}

describe("KeywordMapTool durable run", () => {
  it("invalidates confirmed context when an authority-bearing field changes", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: CONTEXT }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();
    await readAndConfirm(host);

    await change(
      host.querySelector('input[type="url"]') as HTMLInputElement,
      "https://different.example/",
    );

    expect(host.textContent).not.toContain("What we read off your site");
    expect(
      [...host.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("Run the opportunity map"),
      ),
    ).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the legacy 200 result path compatible", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: CONTEXT }))
      .mockResolvedValueOnce(Response.json({ data: { result: RESULT } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();

    await readAndConfirm(host);
    await click(buttonWith(host, "Run the opportunity map"));

    expect(host.querySelector('[data-testid="keyword-result"]')?.textContent).toBe(
      "1 rows",
    );
    expect(sessionStorage.getItem(KEYWORD_WORKFLOW_STORAGE_KEY)).toBeNull();
  });

  it("accepts 202, polls one run, and renders the completed result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: CONTEXT }))
      .mockResolvedValueOnce(
        Response.json(
          { data: { status: "running", runToken: "sealed-run" } },
          { status: 202, headers: { "Retry-After": "2" } },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ data: { status: "completed", result: RESULT } }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();

    await readAndConfirm(host);
    await click(buttonWith(host, "Run the opportunity map"));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(host.querySelector('[data-testid="keyword-result"]')).not.toBeNull();
    expect(sessionStorage.getItem(KEYWORD_WORKFLOW_STORAGE_KEY)).toBeNull();
    expect(
      (fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.headers,
    ).toMatchObject({ "X-Keyword-Workflow-Version": "keyword_workflow.v1" });
  });

  it("restores a tracking pointer after refresh without starting paid work again", async () => {
    expect(
      writeKeywordWorkflowPointer(sessionStorage, {
        version: "keyword_workflow_pointer.v1",
        requestId: "2f7b5985-75b9-44c0-9b53-2b54b7901f2f",
        property: PROPERTY,
        siteUrl: "https://example.com/",
        marketCode: "US",
        languageCode: "en",
        seedInput: "",
        context: {
          token: CONTEXT.contextToken,
          propositions: CONTEXT.propositions,
          pagesFetched: CONTEXT.pagesFetched,
          productPagesFetched: CONTEXT.productPagesFetched,
          contextSufficient: true,
          stopReason: "max_urls",
        },
        createdAt: Date.now(),
        runToken: "sealed-run",
      }),
    ).toBe(true);
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toContain("/opportunities/status");
      return Response.json({
        data: { status: "completed", result: RESULT },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const host = await renderTool();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="keyword-result"]')).not.toBeNull();
    expect(sessionStorage.getItem(KEYWORD_WORKFLOW_STORAGE_KEY)).toBeNull();
  });

  it("stops tracking after repeated unavailable status responses", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: CONTEXT }))
      .mockResolvedValueOnce(
        Response.json(
          { data: { status: "running", runToken: "sealed-run" } },
          { status: 202 },
        ),
      )
      .mockImplementation(async () =>
        Response.json(
          { error: { code: "keyword_run_unavailable" } },
          { status: 503 },
        ),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();

    await readAndConfirm(host);
    await click(buttonWith(host, "Run the opportunity map"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(host.textContent).toContain("This saved run cannot be read right now");
    expect(buttonWith(host, "Run the opportunity map").disabled).toBe(false);
    const startBody = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body),
    ) as { requestId: string };
    const stored = JSON.parse(
      String(sessionStorage.getItem(KEYWORD_WORKFLOW_STORAGE_KEY)),
    ) as { requestId: string; runToken: unknown };
    expect(stored).toMatchObject({
      requestId: startBody.requestId,
      runToken: null,
    });
  });

  it("stops tracking after repeated unreadable status responses", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: CONTEXT }))
      .mockResolvedValueOnce(
        Response.json(
          { data: { status: "running", runToken: "sealed-run" } },
          { status: 202 },
        ),
      )
      .mockImplementation(async () =>
        new Response("<html>bad gateway</html>", { status: 502 }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();

    await readAndConfirm(host);
    await click(buttonWith(host, "Run the opportunity map"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(host.textContent).toContain("This saved run cannot be read right now");
    expect(buttonWith(host, "Run the opportunity map").disabled).toBe(false);
    expect(
      JSON.parse(
        String(sessionStorage.getItem(KEYWORD_WORKFLOW_STORAGE_KEY)),
      ),
    ).toMatchObject({ runToken: null });
  });

  it("reuses the request id when the start response is lost", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: CONTEXT }))
      .mockRejectedValueOnce(new TypeError("connection closed"))
      .mockResolvedValueOnce(
        Response.json(
          { data: { status: "running", runToken: "sealed-run" } },
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ data: { status: "completed", result: RESULT } }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();
    await readAndConfirm(host);

    await click(buttonWith(host, "Run the opportunity map"));
    await click(buttonWith(host, "Run the opportunity map"));

    const firstBody = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body),
    ) as { requestId: string };
    const secondBody = JSON.parse(
      String((fetchMock.mock.calls[2]?.[1] as RequestInit | undefined)?.body),
    ) as { requestId: string };
    expect(secondBody.requestId).toBe(firstBody.requestId);
    expect(host.querySelector('[data-testid="keyword-result"]')).not.toBeNull();
  });
});
