// @vitest-environment jsdom
// @input  -- real four-stage AgentWorkbench effects with mocked session/API/dialog boundaries
// @output -- Profile confirmation, purpose-safe resume, Agent isolation, and auth-race proof
// @pos    -- browser-lifecycle guard for the account-gated SEO/Tech Agent workbench

import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_AUDIT_RECORD_CATEGORIES } from "../../lib/agents/audit-contract";
import {
  pendingAgentIntentKey,
  readPendingAgentIntent,
  storeConfirmedAgentRunIntent,
  storePendingAgentIntent,
} from "./agent-intent";
import { confirmAgentProfile, createAgentProfileDraft } from "./agent-profile";

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
    profile,
  }: {
    readonly agent: string;
    readonly data: { readonly run: { readonly agent: string } };
    readonly profile: {
      readonly agent: string;
      readonly targetUrl: string;
      readonly reviewState: string;
    };
  }) => (
    <div
      data-testid="agent-results"
      data-agent={agent}
      data-run-agent={data.run.agent}
      data-profile-agent={profile.agent}
      data-profile-url={profile.targetUrl}
      data-profile-state={profile.reviewState}
    />
  ),
}));

const { AgentWorkbench } = await import("./agent-workbench");

type AgentKind = "seo" | "tech";

function successEnvelope(agent: AgentKind, targetUrl = "example.com") {
  return {
    data: {
      run: {
        agent,
        mode: "authenticated_agent",
        persistence: "none",
        source: {
          tool: "seo_audit",
          schemaVersion: "seo_audit.sitewide.v3",
          completedAt: "2026-08-13T00:00:00.000Z",
          cache: { status: "miss", capturedAt: null },
        },
      },
      result: {
        targetUrl,
        siteOrigin: "https://example.com",
        scannedAt: "2026-08-13T00:00:00.000Z",
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
        records: Object.entries(AGENT_AUDIT_RECORD_CATEGORIES).map(
          ([id, category]) => ({
            id,
            category,
            state: "not_observed" as const,
            unit: "pages" as const,
            tested: 1,
            affected: 0,
            observations: [],
            limitation: null,
          }),
        ),
      },
    },
  } as const;
}

let root: Root | null = null;

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  });
}

function renderStrict(agent: AgentKind): void {
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

function rerenderStrict(agent: AgentKind): void {
  act(() => {
    root?.render(
      <StrictMode>
        <AgentWorkbench agent={agent} locale="en" />
      </StrictMode>,
    );
  });
}

function setProfileUrl(agent: AgentKind, value: string): void {
  const input = document.querySelector(
    `#${agent}-profile-target-url`,
  ) as HTMLInputElement;
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

function confirmProfile(): void {
  act(() => {
    (
      document.querySelector(
        '[data-profile-action="confirm"]',
      ) as HTMLButtonElement
    ).click();
  });
}

function postCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
}

beforeEach(() => {
  sessionStorage.clear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
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

describe("AgentWorkbench Profile gate and purpose-safe lifecycle", () => {
  it("consumes a homepage preparation intent into Stage 01 without probing or posting", async () => {
    storePendingAgentIntent(
      sessionStorage,
      "seo",
      "astrologywiki.com/chart",
      "prepare_profile",
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    await flushAsyncWork();

    expect(
      (document.querySelector("#seo-profile-target-url") as HTMLInputElement)
        .value,
    ).toBe("astrologywiki.com/chart");
    expect(document.body.textContent).toContain("AstrologyWiki");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
  });

  it("runs once only after a signed-in visitor confirms the exact Profile", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        expect(input).toBe("/api/agents/seo/audit");
        expect(init?.body).toBe(JSON.stringify({ url: "example.com/docs" }));
        return Response.json(successEnvelope("seo", "example.com/docs"));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com/docs");
    expect(fetchMock).not.toHaveBeenCalled();
    confirmProfile();
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(1);
    expect(
      document.querySelector('[data-testid="agent-results"]'),
    ).toMatchObject({
      dataset: expect.objectContaining({
        agent: "seo",
        runAgent: "seo",
        profileAgent: "seo",
        profileUrl: "example.com/docs",
        profileState: "confirmed",
      }),
    });
  });

  it("stores a confirmed Profile and opens sign-in without an audit POST", async () => {
    const fetchMock = vi.fn(async () => Response.json({ signedIn: false }));
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    setProfileUrl("tech", "example.com");
    confirmProfile();
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(0);
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("true");
    expect(readPendingAgentIntent(sessionStorage, "tech")).toMatchObject({
      purpose: "run_confirmed_profile",
      agent: "tech",
      url: "example.com",
      confirmedProfile: {
        agent: "tech",
        targetUrl: "example.com",
        reviewState: "confirmed",
      },
    });
  });

  it("resumes a confirmed StrictMode intent exactly once", async () => {
    const profile = confirmAgentProfile(
      createAgentProfileDraft("seo", "example.com"),
    );
    storeConfirmedAgentRunIntent(sessionStorage, profile);
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        expect(init?.body).toBe(JSON.stringify({ url: "example.com" }));
        return Response.json(successEnvelope("seo"));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(1);
    expect(sessionStorage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
    expect(document.querySelector('[data-testid="agent-results"]')).not.toBeNull();
  });

  it("never probes, prefills, or consumes the other Agent's intent", async () => {
    storePendingAgentIntent(
      sessionStorage,
      "seo",
      "seo-only.example",
      "prepare_profile",
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    await flushAsyncWork();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      (document.querySelector("#tech-profile-target-url") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(readPendingAgentIntent(sessionStorage, "seo")?.url).toBe(
      "seo-only.example",
    );
  });

  it("runs signed-in even when sessionStorage access is unavailable", async () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) =>
        String(input) === "/api/auth/session"
          ? Response.json({ signedIn: true })
          : Response.json(successEnvelope("seo", "example.com")),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    confirmProfile();
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(1);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("fails closed when a signed-out auth handoff cannot be stored", async () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    const fetchMock = vi.fn(async () => Response.json({ signedIn: false }));
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    confirmProfile();
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(0);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "errors.intent_unavailable",
    );
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("false");
  });

  it("does not post when authentication status is unavailable", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { code: "auth_unavailable" } },
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    setProfileUrl("tech", "example.com");
    confirmProfile();
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(0);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "errors.auth_unavailable",
    );
  });

  it.each([
    ["invalid_url", 400, "true"],
    ["rate_limited", 429, "false"],
    ["scan_failed", 502, "false"],
  ] as const)(
    "marks the URL invalid for %s only when the URL caused the failure",
    async (errorCode, status, expectedAriaInvalid) => {
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL) =>
          String(input) === "/api/auth/session"
            ? Response.json({ signedIn: true })
            : Response.json({ error: { code: errorCode } }, { status }),
      );
      vi.stubGlobal("fetch", fetchMock);

      renderStrict("seo");
      setProfileUrl("seo", "example.com");
      confirmProfile();
      await flushAsyncWork();

      const input = document.querySelector(
        "#seo-profile-target-url",
      ) as HTMLInputElement;
      expect(input.getAttribute("aria-invalid")).toBe(expectedAriaInvalid);
      expect(input.getAttribute("aria-describedby")).toContain(
        "seo-agent-error",
      );
      expect(document.querySelector('[role="alert"]')).not.toBeNull();
    },
  );

  it("rechecks a confirmed dialog intent on focus and runs once after sign-in", async () => {
    let signedIn = false;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) => {
        if (String(input) === "/api/auth/session") {
          return Response.json({ signedIn });
        }
        return Response.json(successEnvelope("seo"));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    confirmProfile();
    await flushAsyncWork();
    expect(postCalls(fetchMock)).toHaveLength(0);

    signedIn = true;
    act(() => window.dispatchEvent(new Event("focus")));
    await flushAsyncWork();
    act(() => window.dispatchEvent(new Event("focus")));
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(1);
    expect(document.querySelector('[data-testid="agent-results"]')).not.toBeNull();
  });

  it("allows only one session probe and POST for rapid double confirmation", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) =>
        String(input) === "/api/auth/session"
          ? Response.json({ signedIn: true })
          : Response.json(successEnvelope("seo")),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    act(() => {
      const confirm = document.querySelector(
        '[data-profile-action="confirm"]',
      ) as HTMLButtonElement;
      confirm.click();
      confirm.click();
    });
    await flushAsyncWork();

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/api/auth/session"),
      ),
    ).toHaveLength(1);
    expect(postCalls(fetchMock)).toHaveLength(1);
  });

  it("resets Profile, result, error, and dialog when the Agent identity changes", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) =>
        String(input) === "/api/auth/session"
          ? Response.json({ signedIn: true })
          : Response.json(successEnvelope("seo")),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "seo.example.com");
    confirmProfile();
    await flushAsyncWork();
    expect(document.querySelector('[data-testid="agent-results"]')).not.toBeNull();

    rerenderStrict("tech");
    await flushAsyncWork();

    expect(
      (document.querySelector("#tech-profile-target-url") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(document.querySelector('[data-testid="agent-results"]')).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("false");
  });
});
