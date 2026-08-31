// @vitest-environment jsdom
// @input  -- session status, the three brief entrances, the settings form, and the draft endpoints
// @output -- proof of handoff §8 items 19-21 plus the review rulings: the empty state refuses bare
//            keywords, a bad brief never reaches the form, a writable-less brief disables generation,
//            an unchecked section stays out of section_ids, a signed-out visitor never triggers a
//            POST (and gets the handoff back for the reload), reruns send the draft's own settings and
//            the whole previous result and are counted per POST, a failed second run keeps the last good result,
//            and a slow upload cannot overwrite a later paste; confirmed v2 follows the same private
//            channel with its real workflow/parser, while GEO and unconfirmed v2 never reach HTTP
// @pos    -- interaction contract for the Marketing Content Draft Writer form

import { act } from "react";
import { webcrypto } from "node:crypto";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTENT_BRIEF_HANDOFF_KEY,
  CONTENT_BRIEF_HANDOFF_TTL_MS,
  type ContentBrief,
  type DraftResult,
} from "@sf/public-tools/content-brief/contract";
import {
  DRAFT_REQUEST_MAX_BYTES,
  SECTION_REQUEST_MAX_BYTES,
  SECTION_RERUN_SOFT_MAX,
} from "@sf/public-tools/content-brief/constants";
import { draftFingerprint } from "@sf/public-tools/content-brief/canonical";
import {
  contentBriefFixture,
  withFingerprint,
} from "@sf/public-tools/content-brief/fixtures";
import { parseContentBriefHandoff } from "@sf/public-tools/content-brief/parse-brief";
import { confirmedDraftV2Fixture, draftResultV2Fixture } from "@sf/public-tools/content-brief/v2-draft-fixtures";
import { parseConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import { writeConfirmedBriefHandoff, parseConfirmedBriefHandoff } from "../../lib/tools/content-brief-v2-handoff.ts";
import {
  draftBrief,
  draftResultFixture,
} from "@sf/public-tools/content-brief/draft-fixtures";

const { signInDialogMock, trackMarketingEventMock, signedInResult, signedInHandler, parserGate } = vi.hoisted(() => ({
  /** What the tool's onSignedIn last returned: `false` vetoes the reload. */
  signedInResult: { current: undefined as boolean | void },
  /** The tool's latest onSignedIn, callable outside React (between a parser resolving and the commit). */
  signedInHandler: { current: undefined as (() => boolean | void) | undefined },
  /** When `defer` is set, parseContentBrief holds its result until `release` is called. */
  parserGate: { defer: false, release: null as (() => void) | null },
  // The succeed control is rendered whether the dialog is open or not: a
  // credential posted before the dialog closed still completes, and the
  // real dialog keeps its onSignedIn registered for as long as it is mounted.
  signInDialogMock: vi.fn(
    ({
      open,
      onOpenChange,
      onSignedIn,
    }: {
      readonly open: boolean;
      readonly onOpenChange: (open: boolean) => void;
      readonly onSignedIn?: () => boolean | void;
    }) => {
      signedInHandler.current = onSignedIn;
      return (
      <>
        {open ? (
          <div data-testid="sign-in-dialog">
            sign in
            <button type="button" data-testid="sign-in-cancel" onClick={() => onOpenChange(false)} />
          </div>
        ) : null}
        <button
          type="button"
          data-testid="sign-in-succeed"
          onClick={() => {
            // Mirrors the real dialog's signedInHandler: close first, then forward.
            onOpenChange(false);
            signedInResult.current = onSignedIn?.();
          }}
        />
      </>
      );
    },
  ),
  trackMarketingEventMock: vi.fn(),
}));

vi.mock("@sf/public-tools/content-brief/parse-brief", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sf/public-tools/content-brief/parse-brief")>();
  return {
    ...actual,
    parseContentBrief: async (...args: Parameters<typeof actual.parseContentBrief>) => {
      const result = await actual.parseContentBrief(...args);
      if (!parserGate.defer) return result;
      return new Promise<typeof result>((resolve) => {
        parserGate.release = () => resolve(result);
      });
    },
  };
});

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const translate = (key: string, values?: Readonly<Record<string, unknown>>) =>
      values === undefined ? key : `${key} ${JSON.stringify(values)}`;
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
// the real catalog; here it only exposes the run id and the rerun controls.
vi.mock("./content-draft-results", () => ({
  ContentDraftResults: ({
    result,
    rerun,
  }: {
    readonly result: { readonly run: { readonly run_id: string }; readonly sections: readonly { readonly id: string }[] };
    readonly rerun: { readonly used: number; readonly disabled: boolean; readonly onRerun: (id: string) => void };
  }) => (
    <div data-testid="draft-results" data-run-id={result.run.run_id} data-rerun-disabled={rerun.disabled}>
      <span data-testid="reruns-used">{rerun.used}</span>
      {result.sections.map((section) => (
        <button key={section.id} type="button" data-testid={`rerun-${section.id}`} onClick={() => rerun.onRerun(section.id)} />
      ))}
    </div>
  ),
}));

const { ContentDraftTool } = await import("./content-draft-tool.tsx");

const originalFetch = globalThis.fetch;
let root: Root | null = null;

type FetchCall = { readonly url: string; readonly body: Record<string, unknown> | null };

function fetchCalls(): readonly FetchCall[] {
  return (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) => ({
    url: String(call[0]),
    body: typeof (call[1] as RequestInit | undefined)?.body === "string"
      ? (JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>)
      : null,
  }));
}

function callsTo(url: string): readonly FetchCall[] {
  return fetchCalls().filter((call) => call.url === url);
}

const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");

function restoreSessionStorage(): void {
  if (sessionStorageDescriptor === undefined) {
    delete (window as { sessionStorage?: Storage }).sessionStorage;
  } else {
    Object.defineProperty(window, "sessionStorage", sessionStorageDescriptor);
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  signInDialogMock.mockClear();
  trackMarketingEventMock.mockReset();
  restoreSessionStorage();
  parserGate.defer = false;
  parserGate.release = null;
  signedInHandler.current = undefined;
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
  vi.unstubAllGlobals();
});

async function renderTool(authenticated = true): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<ContentDraftTool locale="en" authenticated={authenticated} />);
  });
  return host;
}

function storeHandoff(brief: ContentBrief): string {
  const now = Date.now();
  const raw = JSON.stringify({ version: 1, created_at: now, expires_at: now + CONTENT_BRIEF_HANDOFF_TTL_MS, brief });
  window.sessionStorage.setItem(CONTENT_BRIEF_HANDOFF_KEY, raw);
  return raw;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * Polls until the tool is observably idle: no parse in flight (the parser's
 * fingerprint is a WebCrypto digest that completes off the microtask queue)
 * and no request in flight. Polling on state, not a fixed number of ticks,
 * is what keeps this stable under a fully parallel run.
 */
async function idle(host: HTMLElement): Promise<void> {
  await vi.waitFor(
    async () => {
      await flush();
      expect(host.querySelector('[data-intake-phase="parsing"]')).toBeNull();
      expect(host.querySelector("#content-draft-tool")?.getAttribute("aria-busy")).toBe("false");
    },
    { timeout: 5_000, interval: 5 },
  );
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

async function select(field: Element | null, value: string): Promise<void> {
  if (!(field instanceof HTMLSelectElement)) throw new Error("expected a select");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** Dispatches inside act; synchronous state changes are committed on return, async ones need `idle`. */
async function click(element: Element | null): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error("expected an element");
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function pasteBrief(host: HTMLElement, brief: ContentBrief): Promise<void> {
  await type(host.querySelector("[data-paste-brief]"), JSON.stringify(brief));
  await click(host.querySelector("[data-load-brief]"));
  await idle(host);
}

type Responder = (body: Record<string, unknown>) => Response | Promise<Response>;

function signedInFetch(onRun: Responder, onSection: Responder = onRun): typeof fetch {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/auth/session") return Promise.resolve(Response.json({ signedIn: true }));
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (url === "/api/tools/content-draft/run") {
      expect(init?.method).toBe("POST");
      return Promise.resolve(onRun(body));
    }
    if (url === "/api/tools/content-draft/section") {
      expect(init?.method).toBe("POST");
      return Promise.resolve(onSection(body));
    }
    return Promise.resolve(Response.json({ error: { code: "invalid_request" } }, { status: 400 }));
  }) as unknown as typeof fetch;
}

/** A rerun's reply: a new run id pointing at the run it replaces, re-fingerprinted. */
async function rerunOf(base: DraftResult, previous: string, runId: string): Promise<DraftResult> {
  const next: DraftResult = { ...base, run: { ...base.run, run_id: runId, reran_from: previous, fingerprint: "" } };
  return { ...next, run: { ...next.run, fingerprint: await draftFingerprint(next) } };
}

function runId(host: HTMLElement): string | null {
  return host.querySelector('[data-testid="draft-results"]')?.getAttribute("data-run-id") ?? null;
}

async function loadAndRun(host: HTMLElement, brief: ContentBrief): Promise<void> {
  await pasteBrief(host, brief);
  await click(host.querySelector("[data-run-draft]"));
  await idle(host);
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
    await idle(host);
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
    await idle(host);
    expect(host.querySelector('[data-brief-source="handoff"]')).not.toBeNull();
    expect(host.querySelector("[data-brief-keyword]")?.textContent).toBe(brief.keyword.primary);
    // One-time: the key is gone the moment it is read (handoff §8 item 32).
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
  });

  it("does not take the handoff for a visitor the server knows is signed out; it says a brief is waiting", async () => {
    const brief = await draftBrief();
    const raw = storeHandoff(brief);
    const host = await renderTool(false);
    await idle(host);
    // The hero sign-in CTA will reload the page; the page after that reload consumes it.
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBe(raw);
    expect(host.querySelector("[data-handoff-pending]")).not.toBeNull();
    expect(host.querySelector('[data-intake-phase="empty"]')).not.toBeNull();
    expect(host.querySelector("form[data-content-draft-form]")).toBeNull();
  });

  it("clears the opener's copy the moment the handoff is taken, before it is parsed", async () => {
    const brief = await draftBrief();
    const raw = storeHandoff(brief);
    const openerStore = new Map<string, string>([[CONTENT_BRIEF_HANDOFF_KEY, raw]]);
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: {
        sessionStorage: {
          getItem: (key: string) => openerStore.get(key) ?? null,
          removeItem: (key: string) => openerStore.delete(key),
          setItem: () => undefined,
        },
      },
    });
    try {
      await renderTool();
      // Synchronously after mount: not waiting on the fingerprint digest.
      expect(openerStore.has(CONTENT_BRIEF_HANDOFF_KEY)).toBe(false);
    } finally {
      Object.defineProperty(window, "opener", { configurable: true, value: null });
    }
  });

  it("reports an expired handoff in its own words", async () => {
    const brief = await draftBrief();
    const created = Date.now() - CONTENT_BRIEF_HANDOFF_TTL_MS - 1_000;
    window.sessionStorage.setItem(
      CONTENT_BRIEF_HANDOFF_KEY,
      JSON.stringify({ version: 1, created_at: created, expires_at: created + CONTENT_BRIEF_HANDOFF_TTL_MS, brief }),
    );
    const host = await renderTool();
    await idle(host);
    expect(host.querySelector("[data-intake-rejected]")?.getAttribute("data-intake-rejected")).toBe(
      "handoff_expired",
    );
  });

  it("lets a later paste win over a slower upload (intake generations)", async () => {
    const uploaded = await draftBrief();
    const pasted = await withFingerprint(contentBriefFixture());
    expect(uploaded.run.fingerprint).not.toBe(pasted.run.fingerprint);
    let resolveText: ((text: string) => void) | null = null;
    const slowFile = {
      text: () =>
        new Promise<string>((resolve) => {
          resolveText = resolve;
        }),
    };
    const host = await renderTool();
    const input = host.querySelector("[data-upload-brief]");
    if (!(input instanceof HTMLInputElement)) throw new Error("no upload input");
    Object.defineProperty(input, "files", { configurable: true, value: [slowFile] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelector('[data-intake-phase="parsing"]')).not.toBeNull();

    await pasteBrief(host, pasted);
    expect(host.querySelector("[data-brief-fingerprint]")?.textContent).toBe(pasted.run.fingerprint);

    // The slow read finally lands, for a generation that is no longer current.
    await act(async () => {
      resolveText?.(JSON.stringify(uploaded));
    });
    await idle(host);
    expect(host.querySelector("[data-brief-fingerprint]")?.textContent).toBe(pasted.run.fingerprint);
    expect(host.querySelector('[data-brief-source="paste"]')).not.toBeNull();
  });
});

describe("ContentDraftTool confirmed v2 intake with the real v2 workflow", () => {
  async function idle(host: HTMLElement) {
    const until = Date.now() + 5_000;
    do {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
      if (host.querySelector('[data-intake-phase="parsing"]') === null && host.querySelector("#content-draft-tool")?.getAttribute("aria-busy") === "false") return;
    } while (Date.now() < until);
    throw new Error("Draft parent did not settle within the test budget");
  }
  async function paste(host: HTMLElement, value: unknown) {
    await type(host.querySelector("[data-paste-brief]"), JSON.stringify(value));
    await click(host.querySelector("[data-load-brief]")); await idle(host);
  }
  async function remount(authenticated: boolean) {
    await act(async () => root?.unmount()); root = null; document.body.replaceChildren(); const host = await renderTool(authenticated); await idle(host); return host;
  }
  function v2Loaded(host: HTMLElement) { return host.querySelector("[data-draft-v2-workflow]"); }
  async function upload(host: HTMLElement, text: () => Promise<string>) {
    const input = host.querySelector("[data-upload-brief]"); if (!(input instanceof HTMLInputElement)) throw new Error("missing upload input");
    Object.defineProperty(input, "files", { configurable: true, value: [{ text }] }); await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  }

  it("loads exact confirmed paste and produces a real parsed v2 draft after the live session check", async () => {
    const confirmed = await confirmedDraftV2Fixture({ action: "update", reverse: true }); const result = await draftResultV2Fixture(confirmed, { settings: { tone: "explanatory", person: "second", product_mention: "gap_only" } });
    globalThis.fetch = signedInFetch((body) => { expect(body).toEqual({ brief: confirmed, settings: result.settings, section_ids: ["O2", "O1"] }); return Response.json(result); });
    const host = await renderTool(); await paste(host, confirmed); expect(v2Loaded(host)).not.toBeNull(); expect(host.querySelectorAll("#content-draft-tool")).toHaveLength(1); expect(host.querySelector("[data-target-page]")?.getAttribute("href")).toBe("https://owned.test/T1"); expect(fetchCalls()).toHaveLength(0);
    await click(host.querySelector("[data-generate-draft]")); await idle(host); expect(fetchCalls().map(({ url }) => url)).toEqual(["/api/auth/session", "/api/tools/content-draft/run"]); expect(host.querySelector("[data-draft-v2-result]")?.getAttribute("data-run-id")).toBe(result.run.run_id);
    expect(host.querySelector('[data-testid="draft-results"]')).toBeNull(); expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
  });
  it("accepts uploaded confirmed CJK revisions without legacy language rejection", async () => {
    const confirmed = await confirmedDraftV2Fixture({ language: "zh-CN", paaOnly: true }); const host = await renderTool(); await upload(host, async () => JSON.stringify(confirmed)); await idle(host);
    expect(v2Loaded(host)).not.toBeNull(); expect(host.querySelector("[data-brief-unsupported-language]")).toBeNull(); expect(host.querySelector("[data-confirmed-revision]")?.textContent).toContain("upload"); expect(fetchCalls()).toHaveLength(0);
  });
  it("consumes the version-2 envelope once using the existing channel and exact opener clearing", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const written = writeConfirmedBriefHandoff(window.sessionStorage, Date.now(), confirmed); if (!written.ok) throw new Error("fixture write");
    const openerStore = new Map<string, string>([[CONTENT_BRIEF_HANDOFF_KEY, written.raw]]); Object.defineProperty(window, "opener", { configurable: true, value: { sessionStorage: { getItem: (key: string) => openerStore.get(key) ?? null, removeItem: (key: string) => openerStore.delete(key) } } });
    try { const host = await renderTool(); expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull(); expect(openerStore.has(CONTENT_BRIEF_HANDOFF_KEY)).toBe(false); await idle(host); expect(v2Loaded(host)).not.toBeNull(); expect(host.querySelector("[data-confirmed-revision]")?.textContent).toContain("handoff"); const fresh = await remount(true); expect(v2Loaded(fresh)).toBeNull(); expect(fresh.querySelector('[data-intake-phase="empty"]')).not.toBeNull(); }
    finally { Object.defineProperty(window, "opener", { configurable: true, value: null }); }
  });
  it("only peeks a signed-out v2 handoff until the authenticated reload consumes it", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const written = writeConfirmedBriefHandoff(window.sessionStorage, Date.now(), confirmed); if (!written.ok) throw new Error("fixture write"); const host = await renderTool(false); await idle(host);
    expect(v2Loaded(host)).toBeNull(); expect(host.querySelector("[data-handoff-pending]")).not.toBeNull(); expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBe(written.raw); expect(fetchCalls()).toHaveLength(0);
    await click(host.querySelector('[data-testid="sign-in-succeed"]')); expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBe(written.raw);
    const signedIn = await remount(true); expect(v2Loaded(signedIn)).not.toBeNull(); expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
  });
  it("writes the confirmed v2 only after successful sign-in, then restores the exact revision on reload", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const host = await renderTool(false); await paste(host, confirmed); expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull(); await click(host.querySelector("[data-generate-draft]")); await idle(host); expect(callsTo("/api/tools/content-draft/run")).toHaveLength(0); expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
    await click(host.querySelector('[data-testid="sign-in-cancel"]')); expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull(); await click(host.querySelector('[data-testid="sign-in-succeed"]')); expect(signedInResult.current).toBe(true);
    const raw = window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)!; expect(JSON.parse(raw).version).toBe(2); expect(await parseConfirmedBriefHandoff(JSON.parse(raw))).toEqual({ ok: true, value: confirmed }); const reloaded = await remount(true); expect(v2Loaded(reloaded)).not.toBeNull(); expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
  });
  it("keeps the current v2 in place and vetoes reload when sign-in storage fails", async () => {
    const host = await renderTool(false); await paste(host, await confirmedDraftV2Fixture()); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage denied"); }); await click(host.querySelector('[data-testid="sign-in-succeed"]'));
    expect(signedInResult.current).toBe(false); expect(v2Loaded(host)).not.toBeNull(); expect(host.querySelector("[data-keep-failed]")).not.toBeNull(); expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
  });
  it("clears only its exact sign-in envelope on replacement and leaves no v2 after a plain refresh", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const host = await renderTool(false); await paste(host, confirmed); await click(host.querySelector('[data-testid="sign-in-succeed"]')); const written = window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY); expect(written).not.toBeNull(); await click(host.querySelector("[data-replace-brief]")); expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
    await paste(host, confirmed); const reloaded = await remount(true); expect(v2Loaded(reloaded)).toBeNull(); expect(reloaded.querySelector('[data-intake-phase="empty"]')).not.toBeNull();
  });
  it("does not clear a newer foreign handoff when replacing its own written v2", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const host = await renderTool(false); await paste(host, confirmed); await click(host.querySelector('[data-testid="sign-in-succeed"]')); const foreign = storeHandoff(await draftBrief()); await click(host.querySelector("[data-replace-brief]")); expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBe(foreign);
  });
  it("replaces a signed-out waiting legacy handoff with pasted v2 without writing a second slot", async () => {
    const legacy = await draftBrief(); const waiting = storeHandoff(legacy); const host = await renderTool(false); expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBe(waiting); await paste(host, await confirmedDraftV2Fixture()); expect(v2Loaded(host)).not.toBeNull(); expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull(); expect(window.sessionStorage.length).toBe(0); await click(host.querySelector("[data-replace-brief]")); await pasteBrief(host, legacy); expect(host.querySelector("[data-brief-fingerprint]")?.textContent).toBe(legacy.run.fingerprint); expect(v2Loaded(host)).toBeNull();
  });
  it.each(["geo_document", "confirmation_required"] as const)("rejects %s locally with the correct builder entry point", async (code) => {
    const confirmed = await confirmedDraftV2Fixture(); const value = code === "geo_document" ? { schemaVersion: "marketing-geo-brief.v1", brief: { topic: "sample GEO brief" } } : confirmed.brief; const host = await renderTool(); await paste(host, value);
    expect(host.querySelector("[data-intake-rejected]")?.getAttribute("data-intake-rejected")).toBe(code); expect(host.querySelector("[data-content-brief-entry]")?.getAttribute("href")).toBe("/tools/content-brief"); expect(v2Loaded(host)).toBeNull(); expect(host.querySelector("[data-run-draft]")).toBeNull(); expect(fetchCalls()).toHaveLength(0);
  });
  it("rejects an invalid confirmed fingerprint and expired v2 handoff without HTTP calls", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const host = await renderTool(); await paste(host, { ...confirmed, revision: confirmed.revision + 1 }); expect(host.querySelector("[data-intake-rejected]")?.getAttribute("data-intake-rejected")).toBe("brief_fingerprint_mismatch"); expect(fetchCalls()).toHaveLength(0);
    const written = writeConfirmedBriefHandoff(window.sessionStorage, Date.now() - CONTENT_BRIEF_HANDOFF_TTL_MS - 10, confirmed); expect(written.ok).toBe(true); const expired = await remount(true); expect(expired.querySelector("[data-intake-rejected]")?.getAttribute("data-intake-rejected")).toBe("handoff_expired"); expect(v2Loaded(expired)).toBeNull();
  });
  it("keeps later v2 paste when an earlier uploaded legacy file finally resolves", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const legacy = await draftBrief(); let finish!: (text: string) => void; const host = await renderTool(); await upload(host, () => new Promise<string>((resolve) => { finish = resolve; })); await paste(host, confirmed); expect(v2Loaded(host)).not.toBeNull(); await act(async () => finish(JSON.stringify(legacy))); await idle(host); expect(v2Loaded(host)).not.toBeNull(); expect(host.querySelector("[data-brief-loaded]")).toBeNull();
  });
  it("keeps later legacy paste when an earlier confirmed-v2 hash resolves out of order", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const legacy = await draftBrief(); let release!: () => void; let calls = 0; vi.stubGlobal("crypto", { subtle: { digest: async (algorithm: AlgorithmIdentifier, bytes: BufferSource) => { const digest = await webcrypto.subtle.digest(algorithm, bytes); calls += 1; if (calls === 1) await new Promise<void>((resolve) => { release = resolve; }); return digest; } } });
    const host = await renderTool(); await type(host.querySelector("[data-paste-brief]"), JSON.stringify(confirmed)); await click(host.querySelector("[data-load-brief]")); await act(async () => { await vi.waitFor(() => expect(release).toBeTypeOf("function")); }); await pasteBrief(host, legacy); await act(async () => release()); await idle(host); expect(v2Loaded(host)).toBeNull(); expect(host.querySelector("[data-brief-fingerprint]")?.textContent).toBe(legacy.run.fingerprint);
  });
  it("does not start a v2 parse when an uploaded file resolves after the parent unmounts", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const digest = vi.fn((algorithm: AlgorithmIdentifier, bytes: BufferSource) => webcrypto.subtle.digest(algorithm, bytes)); vi.stubGlobal("crypto", { subtle: { digest } }); let release!: (text: string) => void;
    const host = await renderTool(); await upload(host, () => new Promise<string>((resolve) => { release = resolve; })); await act(async () => root?.unmount()); root = null; await act(async () => release(JSON.stringify(confirmed))); expect(digest).not.toHaveBeenCalled(); expect(fetchCalls()).toHaveLength(0);
  });
  it("lets a parent Google callback pending across the version switch keep the current v2 revision", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const host = await renderTool(false); const callback = signedInHandler.current; expect(callback).toBeTypeOf("function"); await paste(host, confirmed); let kept: boolean | void; await act(async () => { kept = callback?.(); }); expect(kept!).toBe(true);
    const raw = window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY); const parsed = await parseConfirmedBriefHandoff(JSON.parse(raw ?? "null")); expect(parsed).toEqual({ ok: true, value: confirmed }); expect((await parseConfirmedBriefV2(confirmed)).ok).toBe(true);
  });
});

describe("ContentDraftTool run flow (handoff §8 items 17 and 21)", () => {
  it("opens the sign-in dialog for a signed-out visitor and never posts the run", async () => {
    const brief = await draftBrief();
    const host = await renderTool();
    await pasteBrief(host, brief);
    await click(host.querySelector("[data-run-draft]"));
    expect(host.querySelector('[data-testid="sign-in-dialog"]')).not.toBeNull();
    expect(callsTo("/api/tools/content-draft/run")).toHaveLength(0);
    expect(trackMarketingEventMock).not.toHaveBeenCalled();
  });

  it("writes the brief for the reload only once a credential became a session, even after the dialog was closed", async () => {
    const brief = await draftBrief();
    storeHandoff(brief);
    const host = await renderTool();
    await idle(host);
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
    await click(host.querySelector("[data-run-draft]"));
    expect(host.querySelector('[data-testid="sign-in-dialog"]')).not.toBeNull();
    // Opening the dialog writes nothing: a cancelled sign-in leaves no brief behind.
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
    await click(host.querySelector('[data-testid="sign-in-cancel"]'));
    expect(host.querySelector('[data-testid="sign-in-dialog"]')).toBeNull();
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
    // The credential POST that was in flight completes after the close: the
    // brief is written immediately before the reload that follows.
    await click(host.querySelector('[data-testid="sign-in-succeed"]'));
    const raw = window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY);
    expect(raw).not.toBeNull();
    const parsed = await parseContentBriefHandoff(JSON.parse(raw ?? "null"));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.brief.run.fingerprint).toBe(brief.run.fingerprint);
  });

  it("removes the envelope written for the reload again on Replace, and leaves a newer one another tab wrote", async () => {
    const brief = await draftBrief();
    storeHandoff(brief);
    const host = await renderTool();
    await idle(host);
    await click(host.querySelector('[data-testid="sign-in-succeed"]'));
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).not.toBeNull();
    await click(host.querySelector("[data-replace-brief]"));
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();

    const pasted = await withFingerprint(contentBriefFixture());
    await pasteBrief(host, pasted);
    await click(host.querySelector('[data-testid="sign-in-succeed"]'));
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).not.toBeNull();
    window.sessionStorage.setItem(CONTENT_BRIEF_HANDOFF_KEY, "newer");
    await click(host.querySelector("[data-replace-brief]"));
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBe("newer");
  });

  it("vetoes the reload and shows the notice when the brief cannot be kept, and clears that notice on the next run or Replace", async () => {
    const brief = await draftBrief();
    storeHandoff(brief);
    const host = await renderTool();
    await idle(host);
    signedInResult.current = undefined;
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    await click(host.querySelector('[data-testid="sign-in-succeed"]'));
    // Returned false: gsi-client keeps the page, so the alert is actually seen
    // and the brief is still loaded.
    expect(signedInResult.current).toBe(false);
    expect(host.querySelector("[data-handoff-keep-failed]")).not.toBeNull();
    expect(host.querySelector("[data-brief-fingerprint]")?.textContent).toBe(brief.run.fingerprint);
    setItem.mockRestore();
    await click(host.querySelector("[data-run-draft]"));
    expect(host.querySelector("[data-handoff-keep-failed]")).toBeNull();
    await click(host.querySelector('[data-testid="sign-in-cancel"]'));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    await click(host.querySelector('[data-testid="sign-in-succeed"]'));
    expect(host.querySelector("[data-handoff-keep-failed]")).not.toBeNull();
    vi.restoreAllMocks();
    await click(host.querySelector("[data-replace-brief]"));
    expect(host.querySelector("[data-handoff-keep-failed]")).toBeNull();
  });

  async function remount(authenticated: boolean): Promise<HTMLElement> {
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    const host = await renderTool(authenticated);
    await idle(host);
    return host;
  }

  it("reads the intake as of the last transition, not the last commit, when a credential lands mid-parse", async () => {
    const waiting = await draftBrief();
    const pasted = await withFingerprint(contentBriefFixture());
    const rawA = storeHandoff(waiting);
    const host = await renderTool(false);
    await idle(host);
    const handler = signedInHandler.current;
    if (handler === undefined) throw new Error("onSignedIn was not passed to the dialog");

    // B starts parsing; the credential lands first: nothing may be written,
    // and A must not be resurrected either.
    parserGate.defer = true;
    await type(host.querySelector("[data-paste-brief]"), JSON.stringify(pasted));
    await click(host.querySelector("[data-load-brief]"));
    expect(host.querySelector('[data-intake-phase="parsing"]')).not.toBeNull();
    expect(handler()).toBeUndefined();
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBe(rawA);

    // The parser resolves, and the credential lands BEFORE React commits B:
    // the listener still saves B, because the ref was written on transition.
    // The gate is armed only once the real parser (a WebCrypto digest that
    // completes off the microtask queue) has finished; poll for that first.
    await vi.waitFor(() => expect(parserGate.release).not.toBeNull(), { timeout: 5_000, interval: 5 });
    parserGate.release?.();
    // Microtasks only, deliberately no act(): React cannot commit here, so
    // every iteration observes the window between the transition and the
    // commit. The loop is bounded by outcome, not by a tick count.
    let verdict: boolean | void = undefined;
    for (let i = 0; i < 1_000; i += 1) {
      await Promise.resolve();
      expect(host.querySelector("[data-brief-fingerprint]")).toBeNull();
      verdict = handler();
      if (verdict === true) break;
    }
    expect(verdict).toBe(true);
    const raw = window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY);
    const parsed = await parseContentBriefHandoff(JSON.parse(raw ?? "null"));
    expect(parsed.ok && parsed.value.brief.run.fingerprint).toBe(pasted.run.fingerprint);
    await idle(host);
    expect(host.querySelector("[data-brief-fingerprint]")?.textContent).toBe(pasted.run.fingerprint);
  });

  it("vetoes the reload without throwing when session storage itself is inaccessible", async () => {
    const brief = await draftBrief();
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    const host = await renderTool();
    await idle(host);
    await pasteBrief(host, brief);
    expect(host.querySelector("[data-brief-fingerprint]")?.textContent).toBe(brief.run.fingerprint);
    signedInResult.current = undefined;
    await click(host.querySelector('[data-testid="sign-in-succeed"]'));
    expect(signedInResult.current).toBe(false);
    expect(host.querySelector("[data-handoff-keep-failed]")).not.toBeNull();
    expect(host.querySelector("[data-brief-fingerprint]")?.textContent).toBe(brief.run.fingerprint);
    restoreSessionStorage();
  });

  it("closes the dialog before the keep-failed notice appears, so the notice is not behind a modal", async () => {
    const brief = await draftBrief();
    storeHandoff(brief);
    const host = await renderTool();
    await idle(host);
    await click(host.querySelector("[data-run-draft]"));
    expect(host.querySelector('[data-testid="sign-in-dialog"]')).not.toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    await click(host.querySelector('[data-testid="sign-in-succeed"]'));
    expect(host.querySelector('[data-testid="sign-in-dialog"]')).toBeNull();
    expect(host.querySelector("[data-handoff-keep-failed]")?.textContent).toBe("intake.handoffKeepFailed");
    expect(signedInResult.current).toBe(false);
  });

  it("clears the waiting handoff when a brief is loaded before sign-in, but writes nothing until a credential became a session", async () => {
    const waiting = await draftBrief();
    const pasted = await withFingerprint(contentBriefFixture());
    expect(pasted.run.fingerprint).not.toBe(waiting.run.fingerprint);
    storeHandoff(waiting);
    const host = await renderTool(false);
    await idle(host);
    expect(host.querySelector("[data-handoff-pending]")).not.toBeNull();
    await pasteBrief(host, pasted);
    expect(host.querySelector("[data-brief-fingerprint]")?.textContent).toBe(pasted.run.fingerprint);
    expect(host.querySelector("[data-handoff-pending]")).toBeNull();
    // A is gone and B was NOT written: a plain refresh (or a cancelled
    // sign-in) starts empty rather than resurrecting either brief.
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
    const reloaded = await remount(true);
    expect(reloaded.querySelector('[data-intake-phase="empty"]')).not.toBeNull();
    expect(reloaded.querySelector("[data-brief-fingerprint]")).toBeNull();
  });

  it("writes only the brief loaded before sign-in once a credential became a session, so the reload loads the visitor's choice", async () => {
    const waiting = await draftBrief();
    const pasted = await withFingerprint(contentBriefFixture());
    storeHandoff(waiting);
    const host = await renderTool(false);
    await idle(host);
    await pasteBrief(host, pasted);
    signedInResult.current = undefined;
    await click(host.querySelector('[data-testid="sign-in-succeed"]'));
    expect(signedInResult.current).toBe(true);
    const rawB = window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY);
    const parsed = await parseContentBriefHandoff(JSON.parse(rawB ?? "null"));
    expect(parsed.ok && parsed.value.brief.run.fingerprint).toBe(pasted.run.fingerprint);

    const reloaded = await remount(true);
    expect(reloaded.querySelector('[data-brief-source="handoff"]')).not.toBeNull();
    expect(reloaded.querySelector("[data-brief-fingerprint]")?.textContent).toBe(pasted.run.fingerprint);
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
  });

  it("leaves the waiting handoff alone when the brief loaded before sign-in is rejected", async () => {
    const rawA = storeHandoff(await draftBrief());
    const host = await renderTool(false);
    await idle(host);
    await type(host.querySelector("[data-paste-brief]"), "{ not json");
    await click(host.querySelector("[data-load-brief]"));
    await idle(host);
    expect(host.querySelector("[data-intake-rejected]")).not.toBeNull();
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBe(rawA);
  });

  it("leaves an unchecked section out of section_ids and renders the returned draft", async () => {
    const brief = await draftBrief();
    const result = await draftResultFixture(brief, { skipSection: "O2" });
    globalThis.fetch = signedInFetch(() => Response.json(result));

    const host = await renderTool();
    await pasteBrief(host, brief);
    const writable = brief.draft_readiness.writable;
    expect(writable.length).toBeGreaterThanOrEqual(3);
    await click(host.querySelector('[data-section-checkbox="O2"]'));
    await click(host.querySelector("[data-run-draft]"));
    await idle(host);

    const [request] = callsTo("/api/tools/content-draft/run");
    expect(request?.body).not.toBeNull();
    expect(Object.keys(request?.body ?? {}).sort()).toEqual(["brief", "section_ids", "settings"]);
    expect(request?.body?.["section_ids"]).toEqual(writable.filter((id) => id !== "O2"));
    expect(request?.body?.["settings"]).toEqual({ tone: "explanatory", person: "second", product_mention: "gap_only" });
    expect((request?.body?.["brief"] as ContentBrief).run.fingerprint).toBe(brief.run.fingerprint);
    expect(runId(host)).toBe(result.run.run_id);
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
    globalThis.fetch = signedInFetch(() => Response.json({ error: { code: "auth_required" } }, { status: 401 }));
    const host = await renderTool();
    await loadAndRun(host, brief);
    expect(host.querySelector("[data-error-code]")?.getAttribute("data-error-code")).toBe("auth_required");
    expect(host.querySelector('[data-testid="sign-in-dialog"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="draft-results"]')).toBeNull();
  });

  it("prints the Retry-After seconds for run_in_progress, and the plain line without the header", async () => {
    const brief = await draftBrief();
    globalThis.fetch = signedInFetch(() =>
      new Response(JSON.stringify({ error: { code: "run_in_progress" } }), {
        status: 409,
        headers: { "Content-Type": "application/json", "Retry-After": "7" },
      }),
    );
    const host = await renderTool();
    await loadAndRun(host, brief);
    const error = host.querySelector("[data-error-code]");
    expect(error?.getAttribute("data-error-code")).toBe("run_in_progress");
    expect(error?.textContent).toContain("errorsWithRetry.run_in_progress");
    expect(error?.textContent).toContain('"seconds":7');

    globalThis.fetch = signedInFetch(() => Response.json({ error: { code: "run_in_progress" } }, { status: 409 }));
    await click(host.querySelector("[data-run-draft]"));
    await idle(host);
    expect(host.querySelector("[data-error-code]")?.textContent).toContain("errors.run_in_progress");
  });

  it("prints the refusing route's own byte cap on payload_too_large", async () => {
    const brief = await draftBrief();
    const first = await draftResultFixture(brief);
    const runKb = Math.round(DRAFT_REQUEST_MAX_BYTES / 1024);
    const sectionKb = Math.round(SECTION_REQUEST_MAX_BYTES / 1024);
    expect(runKb).not.toBe(sectionKb);
    const tooLarge = () => Response.json({ error: { code: "payload_too_large" } }, { status: 413 });
    const replies = [tooLarge, () => Response.json(first)];
    globalThis.fetch = signedInFetch(() => replies.shift()?.() ?? tooLarge(), tooLarge);
    const host = await renderTool();
    await loadAndRun(host, brief);
    expect(host.querySelector("[data-error-code]")?.getAttribute("data-error-code")).toBe("payload_too_large");
    expect(host.querySelector("[data-error-code]")?.textContent).toContain(`"kb":${runKb}`);
    await click(host.querySelector("[data-run-draft]"));
    await idle(host);
    expect(runId(host)).toBe(first.run.run_id);
    await click(host.querySelector('[data-testid="rerun-O1"]'));
    await idle(host);
    expect(host.querySelector("[data-error-code]")?.getAttribute("data-error-code")).toBe("payload_too_large");
    expect(host.querySelector("[data-error-code]")?.textContent).toContain(`"kb":${sectionKb}`);
    expect(host.querySelector("[data-error-code]")?.textContent).not.toContain(`"kb":${runKb}`);
  });

  it("refuses a result written against another brief", async () => {
    const brief = await draftBrief();
    const other = await withFingerprint(contentBriefFixture());
    const foreign = await draftResultFixture(other);
    expect(foreign.brief_ref.fingerprint).not.toBe(brief.run.fingerprint);
    globalThis.fetch = signedInFetch(() => Response.json(foreign));
    const host = await renderTool();
    await loadAndRun(host, brief);
    expect(host.querySelector('[data-testid="draft-results"]')).toBeNull();
    expect(host.querySelector("[data-error-code]")?.getAttribute("data-error-code")).toBe("unknown");
  });
});

describe("ContentDraftTool reruns and result replacement", () => {
  it("reruns with the whole previous result (its own settings, not the form's) and flags changed form settings", async () => {
    const brief = await draftBrief();
    const first = await draftResultFixture(brief, { failSection: "O2" });
    const second = await rerunOf(await draftResultFixture(brief), first.run.run_id, "draft_01J6RERUN0000000000000002");
    globalThis.fetch = signedInFetch(() => Response.json(first), () => Response.json(second));
    const host = await renderTool();
    await loadAndRun(host, brief);
    expect(runId(host)).toBe(first.run.run_id);

    await select(host.querySelector("#content-draft-tone"), "technical");
    expect(host.querySelector("[data-settings-changed]")).not.toBeNull();

    await click(host.querySelector('[data-testid="rerun-O2"]'));
    await idle(host);
    const [request] = callsTo("/api/tools/content-draft/section");
    expect(Object.keys(request?.body ?? {}).sort()).toEqual(["brief", "previous", "section_id"]);
    expect(request?.body?.["section_id"]).toBe("O2");
    expect((request?.body?.["brief"] as ContentBrief).run.fingerprint).toBe(brief.run.fingerprint);
    // The whole previous result, verbatim: its settings are the draft's own,
    // not the form's (which now says "technical").
    expect(request?.body?.["previous"]).toEqual(first);
    expect((request?.body?.["previous"] as DraftResult).settings).toEqual(first.settings);
    expect(runId(host)).toBe(second.run.run_id);
    expect(host.querySelector('[data-testid="reruns-used"]')?.textContent).toBe("1");
    // Still flagged: the new result carries the old settings too.
    expect(host.querySelector("[data-settings-changed]")).not.toBeNull();
  });

  it("renders the section endpoint's previous_draft_invalid refusal and keeps the result on screen", async () => {
    const brief = await draftBrief();
    const first = await draftResultFixture(brief);
    globalThis.fetch = signedInFetch(
      () => Response.json(first),
      () => Response.json({ error: { code: "previous_draft_invalid" } }, { status: 422 }),
    );
    const host = await renderTool();
    await loadAndRun(host, brief);
    await click(host.querySelector('[data-testid="rerun-O1"]'));
    await idle(host);
    expect(host.querySelector("[data-error-code]")?.getAttribute("data-error-code")).toBe("previous_draft_invalid");
    expect(host.querySelector("[data-error-code]")?.textContent).toContain("errors.previous_draft_invalid");
    expect(runId(host)).toBe(first.run.run_id);
  });

  it("counts every section POST against the soft cap, failures included, and stops sending at the cap", async () => {
    const brief = await draftBrief();
    const first = await draftResultFixture(brief);
    globalThis.fetch = signedInFetch(
      () => Response.json(first),
      () => Response.json({ error: { code: "quota_unavailable" } }, { status: 503 }),
    );
    const host = await renderTool();
    await loadAndRun(host, brief);
    for (let i = 0; i < SECTION_RERUN_SOFT_MAX; i += 1) {
      await click(host.querySelector('[data-testid="rerun-O1"]'));
      await idle(host);
    }
    expect(callsTo("/api/tools/content-draft/section")).toHaveLength(SECTION_RERUN_SOFT_MAX);
    expect(host.querySelector('[data-testid="reruns-used"]')?.textContent).toBe(String(SECTION_RERUN_SOFT_MAX));
    expect(host.querySelector("[data-error-code]")?.getAttribute("data-error-code")).toBe("quota_unavailable");
    // The last good result is still on screen after every failed rerun.
    expect(runId(host)).toBe(first.run.run_id);

    await click(host.querySelector('[data-testid="rerun-O1"]'));
    await idle(host);
    expect(callsTo("/api/tools/content-draft/section")).toHaveLength(SECTION_RERUN_SOFT_MAX);
  });

  it("keeps the last good result through a failed second run and replaces it atomically on success", async () => {
    const brief = await draftBrief();
    const first = await draftResultFixture(brief);
    const rerun = await rerunOf(first, first.run.run_id, "draft_01J6RERUN0000000000000002");
    const third = await rerunOf(first, null as unknown as string, "draft_01J6THIRD0000000000000003");
    const replies: Response[] = [
      Response.json(first),
      Response.json({ error: { code: "rate_limited" } }, { status: 429 }),
      Response.json({ ...third, run: { ...third.run, reran_from: null } }),
    ];
    globalThis.fetch = signedInFetch(() => replies.shift() ?? Response.json({ error: { code: "invalid_request" } }, { status: 400 }), () => Response.json(rerun));
    const host = await renderTool();
    await loadAndRun(host, brief);
    await click(host.querySelector('[data-testid="rerun-O1"]'));
    await idle(host);
    expect(runId(host)).toBe(rerun.run.run_id);
    expect(host.querySelector('[data-testid="reruns-used"]')?.textContent).toBe("1");

    // A refused second run: the rerun result stays, the counter stays, the error shows.
    await click(host.querySelector("[data-run-draft]"));
    await idle(host);
    expect(runId(host)).toBe(rerun.run.run_id);
    expect(host.querySelector('[data-testid="reruns-used"]')?.textContent).toBe("1");
    expect(host.querySelector("[data-error-code]")?.getAttribute("data-error-code")).toBe("rate_limited");

    // A successful one replaces the result and resets the rerun budget.
    await click(host.querySelector("[data-run-draft]"));
    await idle(host);
    expect(runId(host)).toBe(third.run.run_id);
    expect(host.querySelector('[data-testid="reruns-used"]')?.textContent).toBe("0");
    expect(host.querySelector("[data-error-code]")).toBeNull();
  });

  it("disables the old result's rerun controls while a full generation is in flight", async () => {
    const brief = await draftBrief();
    const first = await draftResultFixture(brief);
    let release: ((response: Response) => void) | null = null;
    const replies: (() => Promise<Response>)[] = [
      () => Promise.resolve(Response.json(first)),
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    ];
    globalThis.fetch = signedInFetch(() => replies.shift()?.() ?? Promise.resolve(Response.json({ error: { code: "invalid_request" } }, { status: 400 })));
    const host = await renderTool();
    await loadAndRun(host, brief);
    expect(host.querySelector('[data-testid="draft-results"]')?.getAttribute("data-rerun-disabled")).toBe("false");
    await click(host.querySelector("[data-run-draft]"));
    expect(host.querySelector('[data-testid="draft-results"]')?.getAttribute("data-rerun-disabled")).toBe("true");
    // A click on the old result's rerun during the run sends nothing.
    await click(host.querySelector('[data-testid="rerun-O1"]'));
    expect(callsTo("/api/tools/content-draft/section")).toHaveLength(0);
    await act(async () => {
      release?.(Response.json({ error: { code: "rate_limited" } }, { status: 429 }));
    });
    await idle(host);
    expect(host.querySelector('[data-testid="draft-results"]')?.getAttribute("data-rerun-disabled")).toBe("false");
    // A failed run returns to idle: no completion announcement replays.
    expect(host.querySelector('[role="status"]')?.textContent ?? "").not.toContain("running.complete");
    expect(runId(host)).toBe(first.run.run_id);
  });

  it("replacing the brief drops the result, resets the phase, and aborts nothing that matters later", async () => {
    const brief = await draftBrief();
    const result = await draftResultFixture(brief);
    globalThis.fetch = signedInFetch(() => Response.json(result));
    const host = await renderTool();
    await loadAndRun(host, brief);
    expect(host.querySelector('[data-testid="draft-results"]')).not.toBeNull();
    await click(host.querySelector("[data-replace-brief]"));
    expect(host.querySelector('[data-intake-phase="empty"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="draft-results"]')).toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
    await pasteBrief(host, brief);
    const run = host.querySelector("[data-run-draft]");
    expect(run instanceof HTMLButtonElement && !run.disabled).toBe(true);
    expect(run?.textContent).toBe("actions.run");
  });
});
