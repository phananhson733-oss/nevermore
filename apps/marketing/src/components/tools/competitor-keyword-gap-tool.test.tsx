// @vitest-environment jsdom
// @input  -- authenticated session status and a valid competitor-gap form
// @output -- proof signed-out visitors see sign-in without a billable tool POST
// @pos    -- interaction contract for the Marketing competitor keyword gap tool

import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompetitorKeywordGapEnvelope } from "@sf/public-tools/competitor-keyword-gap";

type ToolProps = {
  readonly locale: string;
  readonly properties: readonly string[] | null;
  readonly markets: readonly string[];
};

const { signInDialogMock, trackMarketingEventMock } = vi.hoisted(() => ({
  signInDialogMock: vi.fn(
    ({ open }: { readonly open: boolean }) =>
      open ? <div data-testid="sign-in-dialog">sign in</div> : null,
  ),
  trackMarketingEventMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const translate = (
      key: string,
      values?: Readonly<Record<string, unknown>>,
    ) => {
      if (key === "competitors.count") return `${String(values?.count ?? 0)}/5`;
      if (key === "running.elapsed") {
        return `running.elapsed:${String(values?.seconds ?? 0)}`;
      }
      return key;
    };
    translate.has = () => true;
    return translate;
  },
}));

vi.mock("../auth/sign-in-dialog", () => ({
  SignInDialog: signInDialogMock,
}));

vi.mock("../layout/google-analytics", () => ({
  trackMarketingEvent: trackMarketingEventMock,
}));

let Tool: ComponentType<ToolProps>;
try {
  const modulePath = "./competitor-keyword-gap-tool.tsx";
  ({ CompetitorKeywordGapTool: Tool } = await import(
    /* @vite-ignore */ modulePath
  ));
} catch {
  const MissingTool: ComponentType<ToolProps> = () => (
    <button type="button">actions.run</button>
  );
  Tool = MissingTool;
}

const originalFetch = globalThis.fetch;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
const scrollIntoViewMock = vi.fn();
let root: Root | null = null;

const ENVELOPE: CompetitorKeywordGapEnvelope = {
  run: {
    tool: "competitor_keyword_gap",
    schemaVersion: "competitor_keyword_gap.v1",
    mode: "public_preview",
    scope: "site",
    persistence: "none",
    completedAt: "2026-08-24T12:00:00.000Z",
    status: "complete",
  },
  result: {
    capturedAt: "2026-08-24T12:00:00.000Z",
    siteDomain: "example.com",
    competitorDomains: ["rival.example"],
    marketCode: "US",
    languageCode: "en",
    requestedCompetitors: 1,
    completedCompetitors: 1,
    unavailableCompetitors: 0,
    competitors: [
      {
        domain: "rival.example",
        status: "complete",
        returnedRows: 0,
        totalCount: 0,
        truncated: false,
        failureCode: null,
      },
    ],
    rows: [],
    resultTruncated: false,
    overlayStatus: "not_requested",
    gscQueryTruncated: false,
    gscQueryPageTruncated: false,
  },
};

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  signInDialogMock.mockClear();
  trackMarketingEventMock.mockReset();
  scrollIntoViewMock.mockReset();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoViewMock,
    writable: true,
  });
  globalThis.fetch = vi.fn().mockResolvedValue(
    Response.json({ signedIn: false }),
  ) as unknown as typeof fetch;
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
  globalThis.fetch = originalFetch;
  if (originalScrollIntoView === undefined) {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  } else {
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScrollIntoView,
    );
  }
  vi.restoreAllMocks();
});

async function renderTool(
  properties: readonly string[] = ["sc-domain:example.com"],
): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <Tool
        locale="en"
        properties={properties}
        markets={["US"]}
      />,
    );
  });
  return host;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function change(
  field: HTMLInputElement | HTMLSelectElement | null,
  value: string,
): Promise<void> {
  if (
    !(field instanceof HTMLInputElement) &&
    !(field instanceof HTMLSelectElement)
  ) {
    expect(field, "expected the requested form control to render").not.toBeNull();
    return;
  }
  const prototype =
    field instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function pressEnter(field: HTMLInputElement): Promise<void> {
  await act(async () => {
    field.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

function buttonWith(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) throw new Error(`no button containing ${text}`);
  return button as HTMLButtonElement;
}

async function addCompetitor(
  host: HTMLElement,
  value: string,
  method: "button" | "enter" = "button",
): Promise<void> {
  const input = host.querySelector(
    'input[name="competitorDomain"]',
  ) as HTMLInputElement;
  await change(input, value);
  if (method === "enter") await pressEnter(input);
  else await click(buttonWith(host, "competitors.add"));
}

describe("CompetitorKeywordGapTool", () => {
  it("opens sign-in for a signed-out visitor without posting the tool request", async () => {
    const host = await renderTool();

    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "example.com",
    );
    await addCompetitor(host, "rival.example");

    await click(buttonWith(host, "actions.run"));

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/auth/session", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(host.querySelector('[data-testid="sign-in-dialog"]')).not.toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      "/api/tools/competitor-keyword-gap",
      expect.anything(),
    );
  });

  it("normalizes chips added by button or Enter, removes them, and shows the bounded count", async () => {
    const host = await renderTool();

    await addCompetitor(host, " https://WWW.Rival.Example/ ");
    await addCompetitor(host, "second.example", "enter");

    expect(host.textContent).toContain("rival.example");
    expect(host.textContent).toContain("second.example");
    expect(host.textContent).toContain("2/5");

    await click(
      host.querySelector(
        'button[data-remove-competitor="rival.example"]',
      ) as HTMLButtonElement,
    );
    expect(host.textContent).not.toContain("rival.example");
    expect(host.textContent).toContain("1/5");
  });

  it("seeds the editable site domain from domain and URL-prefix properties without clearing it on deselect", async () => {
    const host = await renderTool([
      "sc-domain:acme.com",
      "https://www.prefix.example/reports/",
    ]);
    const property = host.querySelector(
      'select[name="property"]',
    ) as HTMLSelectElement;
    const site = host.querySelector(
      'input[name="siteDomain"]',
    ) as HTMLInputElement;

    expect(site.value).toBe("");
    await change(property, "sc-domain:acme.com");
    expect(site.value).toBe("acme.com");

    await change(property, "https://www.prefix.example/reports/");
    expect(site.value).toBe("prefix.example");

    await change(property, "");
    expect(site.value).toBe("prefix.example");

    await change(site, "edited.example");
    expect(site.value).toBe("edited.example");
  });

  it("turns browser autofill off for the two non-auth domain inputs", async () => {
    const host = await renderTool();

    expect(
      (host.querySelector('input[name="siteDomain"]') as HTMLInputElement)
        .autocomplete,
    ).toBe("off");
    expect(
      (
        host.querySelector(
          'input[name="competitorDomain"]',
        ) as HTMLInputElement
      ).autocomplete,
    ).toBe("off");
  });

  it("rejects invalid, duplicate, self, and sixth competitors inline", async () => {
    const host = await renderTool();
    const site = host.querySelector(
      'input[name="siteDomain"]',
    ) as HTMLInputElement;
    const competitor = host.querySelector(
      'input[name="competitorDomain"]',
    ) as HTMLInputElement;

    expect(site.getAttribute("aria-describedby")).toBeNull();
    expect(site.getAttribute("aria-invalid")).toBeNull();
    expect(competitor.getAttribute("aria-describedby")).toBeNull();
    expect(competitor.getAttribute("aria-invalid")).toBeNull();

    await change(site, "not a domain");
    await click(buttonWith(host, "actions.run"));
    expect(site.getAttribute("aria-describedby")).toBe(
      "competitor-gap-validation",
    );
    expect(site.getAttribute("aria-invalid")).toBe("true");
    expect(competitor.getAttribute("aria-describedby")).toBeNull();
    expect(competitor.getAttribute("aria-invalid")).toBeNull();

    await change(site, "https://www.example.com/");
    await click(buttonWith(host, "actions.run"));
    expect(site.getAttribute("aria-describedby")).toBeNull();
    expect(site.getAttribute("aria-invalid")).toBeNull();
    expect(competitor.getAttribute("aria-describedby")).toBe(
      "competitor-gap-validation",
    );
    expect(competitor.getAttribute("aria-invalid")).toBe("true");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "validation.competitorsRequired",
    );

    await addCompetitor(host, "not a domain");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "validation.competitorInvalid",
    );
    expect(site.getAttribute("aria-describedby")).toBeNull();
    expect(site.getAttribute("aria-invalid")).toBeNull();
    expect(competitor.getAttribute("aria-describedby")).toBe(
      "competitor-gap-validation",
    );
    expect(competitor.getAttribute("aria-invalid")).toBe("true");

    await addCompetitor(host, "example.com");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "validation.competitorSelf",
    );
    expect(competitor.getAttribute("aria-invalid")).toBe("true");

    await addCompetitor(host, "one.example");
    await addCompetitor(host, "www.ONE.example");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "validation.competitorDuplicate",
    );
    expect(competitor.getAttribute("aria-invalid")).toBe("true");

    for (const domain of [
      "two.example",
      "three.example",
      "four.example",
      "five.example",
    ]) {
      await addCompetitor(host, domain);
    }
    expect(host.textContent).toContain("5/5");

    await addCompetitor(host, "six.example");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "validation.competitorLimit",
    );
    expect(competitor.getAttribute("aria-invalid")).toBe("true");
    expect(host.querySelectorAll("[data-competitor-chip]")).toHaveLength(5);
  });

  it("sends the exact normalized signed-in request, including an optional property, then renders done", async () => {
    const requestAnimationFrameMock = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockResolvedValueOnce(Response.json({ data: ENVELOPE }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();

    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "https://www.Example.com/",
    );
    await addCompetitor(host, "HTTPS://WWW.RIVAL.EXAMPLE/");
    await change(
      host.querySelector('select[name="property"]') as HTMLSelectElement,
      "sc-domain:example.com",
    );
    await click(buttonWith(host, "actions.run"));

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/auth/session", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/tools/competitor-keyword-gap",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: expect.any(AbortSignal),
        body: JSON.stringify({
          property: "sc-domain:example.com",
          siteDomain: "example.com",
          competitorDomains: ["rival.example"],
          marketCode: "US",
          languageCode: "en",
        }),
      },
    );
    expect(trackMarketingEventMock).toHaveBeenNthCalledWith(1, "tool_start", {
      tool_name: "competitor_keyword_gap",
    });
    expect(trackMarketingEventMock).toHaveBeenNthCalledWith(
      2,
      "tool_complete",
      { tool_name: "competitor_keyword_gap" },
    );
    expect(host.querySelector('[data-run-status="complete"]')).not.toBeNull();
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenLastCalledWith({ block: "start" });
    expect(requestAnimationFrameMock).not.toHaveBeenCalled();
    const form = host.querySelector("[data-competitor-gap-form]");
    const results = host.querySelector("[data-competitor-gap-results]");
    const shell = host.querySelector("#competitor-keyword-gap-tool");
    expect(form).not.toBeNull();
    expect(results).not.toBeNull();
    expect(form?.parentElement).toBe(results?.parentElement);
    expect(form?.contains(results)).toBe(false);
    expect(form?.className).toContain("bg-brand-panel");
    expect(results?.classList.contains("scroll-mt-24")).toBe(true);
    expect(shell?.className).not.toContain("bg-brand-panel");

    await change(
      host.querySelector('select[name="property"]') as HTMLSelectElement,
      "",
    );
    expect(
      (host.querySelector('select[name="property"]') as HTMLSelectElement)
        .value,
    ).toBe("");
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      root?.render(
        <Tool
          locale="en"
          properties={["sc-domain:example.com"]}
          markets={["US"]}
        />,
      );
    });
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    fetchMock
      .mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockResolvedValueOnce(Response.json({ data: ENVELOPE }));
    await click(buttonWith(host, "actions.run"));

    const deselectedRequest = fetchMock.mock.calls[3]?.[1] as
      | RequestInit
      | undefined;
    expect(deselectedRequest).toBeDefined();
    const deselectedBody = JSON.parse(
      String(deselectedRequest?.body),
    ) as Record<string, unknown>;
    expect(Object.hasOwn(deselectedBody, "property")).toBe(false);
    expect(deselectedBody).toEqual({
      siteDomain: "example.com",
      competitorDomains: ["rival.example"],
      marketCode: "US",
      languageCode: "en",
    });
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
    expect(scrollIntoViewMock.mock.calls).toEqual([
      [{ block: "start" }],
      [{ block: "start" }],
    ]);
    expect(requestAnimationFrameMock).not.toHaveBeenCalled();
  });

  it("keeps old results for local validation errors but clears them before rerun authentication", async () => {
    const rerunAuth = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockResolvedValueOnce(Response.json({ data: ENVELOPE }))
      .mockImplementationOnce(() => rerunAuth.promise);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();
    const site = host.querySelector(
      'input[name="siteDomain"]',
    ) as HTMLInputElement;

    await change(site, "example.com");
    await addCompetitor(host, "rival.example");
    await click(buttonWith(host, "actions.run"));
    expect(host.querySelector("[data-competitor-gap-results]")).not.toBeNull();

    await change(site, "not a domain");
    await click(buttonWith(host, "actions.run"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "validation.siteInvalid",
    );
    expect(host.querySelector("[data-competitor-gap-results]")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await change(site, "example.com");
    await click(buttonWith(host, "actions.run"));
    expect(host.querySelector("[data-competitor-gap-results]")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    rerunAuth.resolve(Response.json({ signedIn: false }));
    await flushPromises();

    expect(host.querySelector("[data-competitor-gap-results]")).toBeNull();
    expect(host.querySelector('[data-testid="sign-in-dialog"]')).not.toBeNull();
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/tools/competitor-keyword-gap",
      ),
    ).toHaveLength(1);
  });

  it("keeps the form busy with an elapsed live status while the tool request runs", async () => {
    let resolveTool!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveTool = resolve;
          }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();
    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "example.com",
    );
    await addCompetitor(host, "rival.example");

    await click(buttonWith(host, "actions.run"));

    expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "running.elapsed:0",
    );
    expect(host.querySelector('[role="progressbar"]')).toBeNull();

    await act(async () => {
      resolveTool(Response.json({ data: ENVELOPE }));
      await Promise.resolve();
    });
  });

  it("locks synchronously so a double click creates one auth read and one tool request", async () => {
    const auth = deferred<Response>();
    const fetchMock = vi.fn((input: string | URL | Request) =>
      String(input) === "/api/auth/session"
        ? auth.promise
        : Promise.resolve(Response.json({ data: ENVELOPE })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();
    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "example.com",
    );
    await addCompetitor(host, "rival.example");
    const run = buttonWith(host, "actions.run");

    await act(async () => {
      run.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      run.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(run.disabled).toBe(true);

    auth.resolve(Response.json({ signedIn: true }));
    await flushPromises();

    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/tools/competitor-keyword-gap",
      ),
    ).toHaveLength(1);
  });

  it("aborts a pending auth read on unmount without issuing a late tool request", async () => {
    const auth = deferred<Response>();
    const fetchMock = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) => auth.promise,
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();
    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "example.com",
    );
    await addCompetitor(host, "rival.example");
    await click(buttonWith(host, "actions.run"));
    const authSignal = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)
      ?.signal;

    await act(async () => {
      root?.unmount();
      root = null;
    });

    expect(authSignal?.aborted).toBe(true);
    auth.resolve(Response.json({ signedIn: true }));
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(trackMarketingEventMock).not.toHaveBeenCalled();
  });

  it("aborts a pending tool request on unmount without late result, error, or completion analytics", async () => {
    const tool = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockImplementationOnce(() => tool.promise);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();
    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "example.com",
    );
    await addCompetitor(host, "rival.example");
    await click(buttonWith(host, "actions.run"));
    const toolSignal = (fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)
      ?.signal;

    await act(async () => {
      root?.unmount();
      root = null;
    });

    expect(toolSignal?.aborted).toBe(true);
    tool.resolve(Response.json({ data: ENVELOPE }));
    await flushPromises();
    expect(host.querySelector("[data-run-status]")).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(trackMarketingEventMock).toHaveBeenCalledTimes(1);
    expect(trackMarketingEventMock).not.toHaveBeenCalledWith(
      "tool_complete",
      expect.anything(),
    );
  });

  it("reports auth unavailability without posting and uses the known-error allow-list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 503 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();
    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "example.com",
    );
    await addCompetitor(host, "rival.example");
    await click(buttonWith(host, "actions.run"));

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "errors.auth_unavailable",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock
      .mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockResolvedValueOnce(
        Response.json({ error: { code: "brand_new_private_error" } }, { status: 502 }),
      );
    await click(buttonWith(host, "actions.run"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "errors.unknown",
    );
  });
});
