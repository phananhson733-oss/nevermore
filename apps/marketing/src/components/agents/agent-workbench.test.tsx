// @vitest-environment jsdom
// @input  -- real AgentWorkbench effects with mocked session/API/dialog boundaries
// @output -- StrictMode/focus resume, Agent isolation, and auth-race regression proof
// @pos    -- browser-lifecycle guard for the account-gated Agent workbench

import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  pendingAgentIntentKey,
  readPendingAgentIntent,
  storePendingAgentIntent,
} from "./agent-intent";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("../auth/sign-in-dialog", () => ({
  SignInDialog: ({
    open,
    onOpenChange,
  }: {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
  }) => (
    <div data-testid="sign-in-dialog" data-open={String(open)}>
      <button
        type="button"
        data-testid="close-sign-in-dialog"
        onClick={() => onOpenChange(false)}
      />
    </div>
  ),
}));

vi.mock("./agent-results", () => ({
  AgentResults: ({
    agent,
    data,
    selectedId,
    onSelect,
  }: {
    readonly agent: string;
    readonly data: { readonly run: { readonly agent: string } };
    readonly selectedId: string | null;
    readonly onSelect: (id: string) => void;
  }) => (
    <div
      data-testid="agent-results"
      data-agent={agent}
      data-run-agent={data.run.agent}
      data-selected-id={selectedId ?? ""}
    >
      <button
        type="button"
        data-testid="select-result"
        onClick={() => onSelect("selected-record")}
      />
    </div>
  ),
}));

const { AgentWorkbench } = await import("./agent-workbench");

const successEnvelope = {
  data: {
    run: {
      agent: "seo",
      mode: "authenticated_agent",
      persistence: "none",
      source: {
        tool: "seo_audit",
        schemaVersion: "seo_audit.sitewide.v3",
        completedAt: "2026-08-12T00:00:00.000Z",
        cache: { status: "miss", capturedAt: null },
      },
    },
    result: {
      targetUrl: "example.com",
      siteOrigin: "https://example.com",
      scannedAt: "2026-08-12T00:00:00.000Z",
      coverage: {
        availability: "available",
        pagesInspected: 1,
        linksObserved: 0,
        sitemapUrlsObserved: 0,
        urlsSkipped: 0,
        urlsBlocked: 0,
        urlsDisallowed: 0,
        urlsErrored: 0,
        stopReason: null,
      },
      siteResources: {
        robotsFetched: true,
        robotsGroupsObserved: 1,
        sitemapReferencesObserved: 0,
        sitemapFetched: false,
      },
      records: [],
    },
  },
} as const;

let root: Root | null = null;

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 5; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  });
}

function renderStrict(agent: "seo" | "tech"): void {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <StrictMode>
        <AgentWorkbench agent={agent} locale="en" />
      </StrictMode>,
    );
  });
}

function rerenderStrict(agent: "seo" | "tech"): void {
  act(() => {
    root?.render(
      <StrictMode>
        <AgentWorkbench agent={agent} locale="en" />
      </StrictMode>,
    );
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setValue) throw new Error("HTMLInputElement.value setter unavailable");
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  sessionStorage.clear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  document.body.replaceChildren();
});

describe("AgentWorkbench pending-intent lifecycle", () => {
  it("runs for a signed-in visitor when acquiring sessionStorage throws", async () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl = typeof input === "string" ? input : input.toString();
        if (requestUrl === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        expect(init?.method).toBe("POST");
        return Response.json(successEnvelope);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    const input = document.querySelector("#seo-agent-url") as HTMLInputElement;
    setInputValue(input, "seo.example.com");
    act(() => {
      input.form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await flushAsyncWork();

    expect(document.querySelector('[data-testid="agent-results"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });

  it("reports unavailable intent storage only when a signed-out run needs it", async () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ signedIn: false }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    const input = document.querySelector("#seo-agent-url") as HTMLInputElement;
    setInputValue(input, "seo.example.com");
    act(() => {
      input.form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await flushAsyncWork();

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "errors.intent_unavailable",
    );
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("false");
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);
  });

  it("resumes a pending signed-in run if sessionStorage later becomes inaccessible", async () => {
    const storage = window.sessionStorage;
    storePendingAgentIntent(storage, "seo", "example.com");
    let storageReads = 0;
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      storageReads += 1;
      if (storageReads === 1) return storage;
      throw new DOMException("Storage disabled", "SecurityError");
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl = typeof input === "string" ? input : input.toString();
        if (requestUrl === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        expect(init?.method).toBe("POST");
        return Response.json(successEnvelope);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    await flushAsyncWork();

    expect(document.querySelector('[data-testid="agent-results"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });

  it.each([
    ["invalid_url", 400, "true"],
    ["auth_required", 401, "false"],
    ["auth_unavailable", 503, "false"],
    ["rate_limited", 429, "false"],
    ["quota_unavailable", 503, "false"],
    ["scan_failed", 502, "false"],
  ] as const)(
    "sets URL aria-invalid for %s only when the URL itself is invalid",
    async (errorCode, status, expectedAriaInvalid) => {
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const requestUrl =
            typeof input === "string" ? input : input.toString();
          if (requestUrl === "/api/auth/session") {
            return Response.json({ signedIn: true });
          }
          expect(init?.method).toBe("POST");
          return Response.json({ error: { code: errorCode } }, { status });
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      renderStrict("seo");
      const input = document.querySelector(
        "#seo-agent-url",
      ) as HTMLInputElement;
      setInputValue(input, "example.com");
      act(() => {
        input.form?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      });
      await flushAsyncWork();

      expect(input.getAttribute("aria-invalid")).toBe(expectedAriaInvalid);
      expect(input.getAttribute("aria-describedby")).toContain(
        "seo-agent-error",
      );
      expect(document.querySelector('[role="alert"]')).not.toBeNull();
    },
  );

  it.each([
    [
      "the authentication service returns its unavailable envelope",
      () =>
        Response.json(
          { error: { code: "auth_unavailable" } },
          { status: 503 },
        ),
    ],
    [
      "the session endpoint returns another non-2xx response",
      () => new Response("bad gateway", { status: 502 }),
    ],
  ] as const)(
    "fails closed without a sign-in intent when %s",
    async (_scenario, sessionResponse) => {
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          sessionResponse(),
      );
      vi.stubGlobal("fetch", fetchMock);

      renderStrict("seo");
      const input = document.querySelector(
        "#seo-agent-url",
      ) as HTMLInputElement;
      setInputValue(input, "example.com");
      act(() => {
        input.form?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      });
      await flushAsyncWork();

      expect(document.querySelector('[role="alert"]')?.textContent).toBe(
        "errors.auth_unavailable",
      );
      expect(input.getAttribute("aria-invalid")).toBe("false");
      expect(
        document
          .querySelector('[data-testid="sign-in-dialog"]')
          ?.getAttribute("data-open"),
      ).toBe("false");
      expect(sessionStorage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
      expect(
        fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
      ).toHaveLength(0);
    },
  );

  it("resumes a matching StrictMode intent with exactly one Agent POST", async () => {
    storePendingAgentIntent(sessionStorage, "seo", "example.com");
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        expect(init?.body).toBe(JSON.stringify({ url: "example.com" }));
        return Response.json(successEnvelope);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    await flushAsyncWork();

    const posts = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "POST",
    );
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toBe("/api/agents/seo/audit");
    expect(sessionStorage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
    expect(document.querySelector('[data-testid="agent-results"]')).not.toBeNull();
  });

  it("does not probe or run for the other Agent's pending intent", async () => {
    storePendingAgentIntent(sessionStorage, "seo", "example.com");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    await flushAsyncWork();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(readPendingAgentIntent(sessionStorage, "seo")).not.toBeNull();
  });

  it("rechecks on focus and resumes a signed-in dialog intent exactly once", async () => {
    storePendingAgentIntent(sessionStorage, "seo", "example.com");
    let signedIn = false;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/auth/session") {
          return Response.json({ signedIn });
        }
        expect(init?.body).toBe(JSON.stringify({ url: "example.com" }));
        return Response.json(successEnvelope);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    await flushAsyncWork();

    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("true");
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);

    signedIn = true;
    act(() => window.dispatchEvent(new Event("focus")));
    await flushAsyncWork();
    act(() => window.dispatchEvent(new Event("focus")));
    await flushAsyncWork();

    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    expect(sessionStorage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("false");
  });

  it("rechecks on focus but leaves a signed-out dialog intent untouched", async () => {
    const pending = storePendingAgentIntent(
      sessionStorage,
      "seo",
      "example.com",
    )!;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ signedIn: false }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    await flushAsyncWork();
    const sessionChecksBeforeFocus = fetchMock.mock.calls.length;

    act(() => window.dispatchEvent(new Event("focus")));
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(sessionChecksBeforeFocus + 1);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);
    expect(readPendingAgentIntent(sessionStorage, "seo")).toEqual(pending);
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("true");
  });

  it("reopens sign-in and restores the original expiry after API auth_required", async () => {
    const pending = storePendingAgentIntent(
      sessionStorage,
      "seo",
      "example.com",
    )!;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        expect(init?.method).toBe("POST");
        return Response.json(
          { error: { code: "auth_required" } },
          { status: 401 },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    await flushAsyncWork();

    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("true");
    expect(readPendingAgentIntent(sessionStorage, "seo")?.expiresAt).toBe(
      pending.expiresAt,
    );
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });

  it("fails closed when a first signed-out intent cannot be stored", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage disabled", "QuotaExceededError");
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ signedIn: false }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    const input = document.querySelector("#seo-agent-url") as HTMLInputElement;
    setInputValue(input, "seo.example.com");
    act(() => {
      input.form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await flushAsyncWork();

    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("false");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "errors.intent_unavailable",
    );
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);
  });

  it("allows only one run when the form is submitted twice in one render", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl = typeof input === "string" ? input : input.toString();
        if (requestUrl === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        expect(init?.method).toBe("POST");
        return Response.json(successEnvelope);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    const input = document.querySelector("#seo-agent-url") as HTMLInputElement;
    setInputValue(input, "seo.example.com");
    act(() => {
      const submit = new Event("submit", { bubbles: true, cancelable: true });
      input.form?.dispatchEvent(submit);
      input.form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await flushAsyncWork();

    expect(
      fetchMock.mock.calls.filter(([requestUrl]) =>
        String(requestUrl).includes("/api/auth/session"),
      ),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });

  it("aborts an in-flight focus resume when the sign-in dialog is closed", async () => {
    let resolveFocusSession: ((response: Response) => void) | undefined;
    let focusSignal: AbortSignal | null | undefined;
    const focusSession = new Promise<Response>((resolve) => {
      resolveFocusSession = resolve;
    });
    let sessionChecks = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl = typeof input === "string" ? input : input.toString();
        if (requestUrl === "/api/auth/session") {
          sessionChecks += 1;
          if (sessionChecks === 1) return Response.json({ signedIn: false });
          focusSignal = init?.signal;
          return focusSession;
        }
        return Response.json(successEnvelope);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    const input = document.querySelector("#seo-agent-url") as HTMLInputElement;
    setInputValue(input, "seo.example.com");
    act(() => {
      input.form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await flushAsyncWork();
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("true");

    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => {
      await Promise.resolve();
    });
    expect(focusSignal).toBeInstanceOf(AbortSignal);

    act(() => {
      (document.querySelector(
        '[data-testid="close-sign-in-dialog"]',
      ) as HTMLButtonElement).click();
    });
    const abortedAtCancel = focusSignal?.aborted;
    resolveFocusSession?.(Response.json({ signedIn: true }));
    await flushAsyncWork();

    expect(abortedAtCancel).toBe(true);
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("false");
    expect(sessionStorage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);
  });
});

describe("AgentWorkbench route identity isolation", () => {
  it("clears completed result, selection, and URL when the Agent prop changes", async () => {
    storePendingAgentIntent(sessionStorage, "seo", "seo.example.com");
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        expect(init?.method).toBe("POST");
        return Response.json(successEnvelope);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    await flushAsyncWork();

    act(() => {
      (document.querySelector(
        '[data-testid="select-result"]',
      ) as HTMLButtonElement).click();
    });
    expect(
      document
        .querySelector('[data-testid="agent-results"]')
        ?.getAttribute("data-selected-id"),
    ).toBe("selected-record");

    rerenderStrict("tech");
    await flushAsyncWork();

    expect((document.querySelector("#tech-agent-url") as HTMLInputElement).value).toBe(
      "",
    );
    expect(document.querySelector('[data-testid="agent-results"]')).toBeNull();
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("false");
  });

  it("clears an error when the Agent prop changes", async () => {
    storePendingAgentIntent(sessionStorage, "seo", "seo.example.com");
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        expect(init?.method).toBe("POST");
        return Response.json(
          { error: { code: "scan_failed" } },
          { status: 502 },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    await flushAsyncWork();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "errors.scan_failed",
    );

    rerenderStrict("tech");
    await flushAsyncWork();

    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect((document.querySelector("#tech-agent-url") as HTMLInputElement).value).toBe(
      "",
    );
  });

  it("closes the sign-in dialog without consuming the other Agent's resume intent", async () => {
    const pending = storePendingAgentIntent(
      sessionStorage,
      "seo",
      "seo.example.com",
    )!;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ signedIn: false }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    await flushAsyncWork();
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("true");

    rerenderStrict("tech");
    await flushAsyncWork();

    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("false");
    expect((document.querySelector("#tech-agent-url") as HTMLInputElement).value).toBe(
      "",
    );
    expect(readPendingAgentIntent(sessionStorage, "seo")).toEqual(pending);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/api/agents/tech/audit"),
      ),
    ).toBe(false);
  });

  it("prevents an in-flight manual SEO response from writing into Tech UI", async () => {
    let resolvePost: ((response: Response) => void) | undefined;
    let seoPostSignal: AbortSignal | null | undefined;
    const postResponse = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        expect(url).toBe("/api/agents/seo/audit");
        expect(init?.method).toBe("POST");
        seoPostSignal = init?.signal;
        return postResponse;
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    const seoInput = document.querySelector(
      "#seo-agent-url",
    ) as HTMLInputElement;
    setInputValue(seoInput, "seo.example.com");
    act(() => {
      seoInput.form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await flushAsyncWork();
    expect(document.querySelector('[data-agent="seo"]')?.getAttribute("aria-busy")).toBe(
      "true",
    );

    rerenderStrict("tech");
    const loadingImmediatelyAfterSwitch = document
      .querySelector('[data-agent="tech"]')
      ?.getAttribute("aria-busy");
    const techUrlImmediatelyAfterSwitch = (
      document.querySelector("#tech-agent-url") as HTMLInputElement
    ).value;
    const signalAbortedImmediatelyAfterSwitch = seoPostSignal?.aborted;

    resolvePost?.(Response.json(successEnvelope));
    await flushAsyncWork();

    expect(seoPostSignal).toBeInstanceOf(AbortSignal);
    expect(signalAbortedImmediatelyAfterSwitch).toBe(true);
    expect(loadingImmediatelyAfterSwitch).toBe("false");
    expect(techUrlImmediatelyAfterSwitch).toBe("");
    expect(document.querySelector('[data-testid="agent-results"]')).toBeNull();
  });
});
