// @vitest-environment jsdom
// @input  -- session status, the three brief entrances, the settings form, and the draft endpoints
// @output -- proof of handoff §8 items 19-21: the empty state refuses bare keywords, a bad brief
//            never reaches the form, a writable-less brief disables generation, an unchecked
//            section stays out of section_ids, and a signed-out visitor never triggers a POST
// @pos    -- interaction contract for the Marketing Content Draft Writer form

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTENT_BRIEF_HANDOFF_KEY,
  CONTENT_BRIEF_HANDOFF_TTL_MS,
  type ContentBrief,
} from "@sf/public-tools/content-brief/contract";
import {
  contentBriefFixture,
  withFingerprint,
} from "@sf/public-tools/content-brief/fixtures";
import {
  draftBrief,
  draftResultFixture,
} from "@sf/public-tools/content-brief/draft-fixtures";

const { signInDialogMock, trackMarketingEventMock } = vi.hoisted(() => ({
  signInDialogMock: vi.fn(({ open }: { readonly open: boolean }) =>
    open ? <div data-testid="sign-in-dialog">sign in</div> : null,
  ),
  trackMarketingEventMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const translate = (key: string) => key;
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

// The result surface is covered by i18n/content-draft-messages.test.tsx with
// the real catalog; here it would only render key paths.
vi.mock("./content-draft-results", () => ({
  ContentDraftResults: ({ result }: { readonly result: { readonly run: { readonly run_id: string } } }) => (
    <div data-testid="draft-results">{result.run.run_id}</div>
  ),
}));

const { ContentDraftTool } = await import("./content-draft-tool.tsx");

const originalFetch = globalThis.fetch;
let root: Root | null = null;

function fetchCalls(): readonly string[] {
  return (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
    String(call[0]),
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  signInDialogMock.mockClear();
  trackMarketingEventMock.mockReset();
  window.sessionStorage.clear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
    writable: true,
  });
  globalThis.fetch = vi
    .fn()
    .mockImplementation(() => Promise.resolve(Response.json({ signedIn: false }))) as unknown as typeof fetch;
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

async function renderTool(): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<ContentDraftTool locale="en" />);
  });
  return host;
}

async function settle(): Promise<void> {
  // The parser's fingerprint is a WebCrypto digest: several microtask turns.
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function type(field: Element | null, value: string): Promise<void> {
  if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) {
    throw new Error("expected a text control");
  }
  const prototype =
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: Element | null): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error("expected an element");
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await settle();
}

async function pasteBrief(host: HTMLElement, brief: ContentBrief): Promise<void> {
  await type(host.querySelector("[data-paste-brief]"), JSON.stringify(brief));
  await click(host.querySelector("[data-load-brief]"));
}

function signedInFetch(
  onRun: (body: Record<string, unknown>) => Response | Promise<Response>,
): typeof fetch {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/auth/session") return Promise.resolve(Response.json({ signedIn: true }));
    if (url === "/api/tools/content-draft/run") {
      expect(init?.method).toBe("POST");
      return Promise.resolve(onRun(JSON.parse(String(init?.body)) as Record<string, unknown>));
    }
    return Promise.resolve(Response.json({ error: { code: "invalid_request" } }, { status: 400 }));
  }) as unknown as typeof fetch;
}

describe("ContentDraftTool intake (handoff §8 items 19-20)", () => {
  it("opens on the empty state with no settings form and no keyword field", async () => {
    const host = await renderTool();
    expect(host.querySelector('[data-intake-phase="empty"]')).not.toBeNull();
    expect(host.querySelector("[data-empty-state]")?.textContent).toBe("empty.body");
    expect(host.querySelector("form[data-content-draft-form]")).toBeNull();
    expect(host.querySelector('input[type="text"]')).toBeNull();
  });

  it("refuses a brief whose outline cites a question that does not exist", async () => {
    const base = contentBriefFixture();
    if (base.outline.status !== "available") throw new Error("fixture outline unavailable");
    const [first, ...rest] = base.outline.items;
    if (first === undefined) throw new Error("fixture outline empty");
    const brief = await withFingerprint({
      ...base,
      outline: { status: "available", items: [{ ...first, answers: ["Q99"] }, ...rest] },
    });
    const host = await renderTool();
    await pasteBrief(host, brief);
    expect(host.querySelector("[data-intake-rejected]")?.getAttribute("data-intake-rejected")).toBe(
      "brief_reference_invalid",
    );
    expect(host.querySelector("form[data-content-draft-form]")).toBeNull();
  });

  it("refuses a brief whose counts were edited after the fingerprint was stamped", async () => {
    const stamped = await withFingerprint(contentBriefFixture());
    const llm = stamped.run.reads.llm;
    const edited: ContentBrief = {
      ...stamped,
      run: {
        ...stamped.run,
        reads: { ...stamped.run.reads, llm: { ...llm, input_tokens: (llm.input_tokens ?? 0) + 1 } },
      },
    };
    const host = await renderTool();
    await pasteBrief(host, edited);
    expect(host.querySelector("[data-intake-rejected]")?.getAttribute("data-intake-rejected")).toBe(
      "brief_fingerprint_mismatch",
    );
    expect(host.querySelector("form[data-content-draft-form]")).toBeNull();
  });

  it("refuses text that is not JSON without calling the parser's code table", async () => {
    const host = await renderTool();
    await type(host.querySelector("[data-paste-brief]"), "{ not json");
    await click(host.querySelector("[data-load-brief]"));
    expect(host.querySelector("[data-intake-rejected]")?.getAttribute("data-intake-rejected")).toBe(
      "invalid_json",
    );
  });

  it("loads a brief with nothing writable into the form but disables generation", async () => {
    const brief = await withFingerprint(contentBriefFixture({ language: "zh" }));
    expect(brief.draft_readiness.writable).toEqual([]);
    const host = await renderTool();
    await pasteBrief(host, brief);
    expect(host.querySelector('[data-intake-phase="loaded"]')).not.toBeNull();
    expect(host.querySelector("form[data-content-draft-form]")).not.toBeNull();
    const run = host.querySelector("[data-run-draft]");
    expect(run instanceof HTMLButtonElement && run.disabled).toBe(true);
    expect(host.querySelector("[data-brief-unsupported-language]")).not.toBeNull();
  });

  it("consumes the sessionStorage handoff once and starts from it", async () => {
    const brief = await draftBrief();
    const now = Date.now();
    window.sessionStorage.setItem(
      CONTENT_BRIEF_HANDOFF_KEY,
      JSON.stringify({ version: 1, created_at: now, expires_at: now + CONTENT_BRIEF_HANDOFF_TTL_MS, brief }),
    );
    const host = await renderTool();
    await settle();
    expect(host.querySelector('[data-brief-source="handoff"]')).not.toBeNull();
    expect(host.querySelector("[data-brief-keyword]")?.textContent).toBe(brief.keyword.primary);
    // One-time: the key is gone the moment it is read (handoff §8 item 32).
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
  });

  it("reports an expired handoff in its own words", async () => {
    const brief = await draftBrief();
    const created = Date.now() - CONTENT_BRIEF_HANDOFF_TTL_MS - 1_000;
    window.sessionStorage.setItem(
      CONTENT_BRIEF_HANDOFF_KEY,
      JSON.stringify({ version: 1, created_at: created, expires_at: created + CONTENT_BRIEF_HANDOFF_TTL_MS, brief }),
    );
    const host = await renderTool();
    await settle();
    expect(host.querySelector("[data-intake-rejected]")?.getAttribute("data-intake-rejected")).toBe(
      "handoff_expired",
    );
  });
});

describe("ContentDraftTool run flow (handoff §8 items 17 and 21)", () => {
  it("opens the sign-in dialog for a signed-out visitor and never posts the run", async () => {
    const brief = await draftBrief();
    const host = await renderTool();
    await pasteBrief(host, brief);
    await click(host.querySelector("[data-run-draft]"));
    expect(host.querySelector('[data-testid="sign-in-dialog"]')).not.toBeNull();
    expect(fetchCalls()).not.toContain("/api/tools/content-draft/run");
    expect(trackMarketingEventMock).not.toHaveBeenCalled();
  });

  it("leaves an unchecked section out of section_ids and renders the returned draft", async () => {
    const brief = await draftBrief();
    const result = await draftResultFixture(brief, { skipSection: "O2" });
    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = signedInFetch((body) => {
      requestBody = body;
      return Response.json(result);
    });

    const host = await renderTool();
    await pasteBrief(host, brief);
    const writable = brief.draft_readiness.writable;
    expect(writable.length).toBeGreaterThanOrEqual(3);
    await click(host.querySelector('[data-section-checkbox="O2"]'));
    await click(host.querySelector("[data-run-draft]"));
    await settle();

    expect(requestBody).not.toBeNull();
    const body = requestBody as unknown as {
      section_ids: string[];
      settings: Record<string, string>;
      brief: { run: { fingerprint: string } };
    };
    expect(body.section_ids).toEqual(writable.filter((id) => id !== "O2"));
    expect(body.settings).toEqual({ tone: "explanatory", person: "second", product_mention: "gap_only" });
    expect(body.brief.run.fingerprint).toBe(brief.run.fingerprint);
    expect(host.querySelector('[data-testid="draft-results"]')?.textContent).toBe(result.run.run_id);
    expect(trackMarketingEventMock).toHaveBeenCalledWith("tool_complete", { tool_name: "content_draft" });
  });

  it("refuses to run with every section unchecked before touching the network", async () => {
    const brief = await draftBrief();
    const host = await renderTool();
    await pasteBrief(host, brief);
    const before = fetchCalls().length;
    for (const id of brief.draft_readiness.writable) {
      await click(host.querySelector(`[data-section-checkbox="${id}"]`));
    }
    await click(host.querySelector("[data-run-draft]"));
    expect(host.querySelector("#content-draft-validation")?.textContent).toBe("validation.sectionsRequired");
    expect(fetchCalls().length).toBe(before);
  });

  it("renders the server's error code and opens sign-in on auth_required", async () => {
    const brief = await draftBrief();
    globalThis.fetch = signedInFetch(() =>
      Response.json({ error: { code: "auth_required" } }, { status: 401 }),
    );
    const host = await renderTool();
    await pasteBrief(host, brief);
    await click(host.querySelector("[data-run-draft]"));
    await settle();
    expect(host.querySelector("[data-error-code]")?.getAttribute("data-error-code")).toBe("auth_required");
    expect(host.querySelector('[data-testid="sign-in-dialog"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="draft-results"]')).toBeNull();
  });
});
