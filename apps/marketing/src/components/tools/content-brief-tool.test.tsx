// @vitest-environment jsdom
// @input  -- session status, the brief form, and the run endpoint
// @output -- proof a signed-out visitor sees the sign-in dialog without a run POST, the count
//            line follows the field, and a signed-in run posts the contract body
// @pos    -- interaction contract for the Marketing Content Brief Builder form (handoff §8 item 17)

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUPPORTING_KEYWORDS_MAX } from "@sf/public-tools/content-brief/constants";

import { validContentBriefV2 } from "./content-brief-v2-fixture.ts";
import { validContentBrief } from "./content-brief-fixture.ts";
import { CONTENT_BRIEF_V3_SCHEMA } from "@sf/public-tools/content-brief/v2-contract";

const { signInDialogMock, trackMarketingEventMock } = vi.hoisted(() => ({
  signInDialogMock: vi.fn(({ open, onOpenChange }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) =>
    open ? <div data-testid="sign-in-dialog">sign in<button data-close-sign-in onClick={() => onOpenChange(false)}>close</button></div> : null,
  ),
  trackMarketingEventMock: vi.fn(),
}));
const parserGate = vi.hoisted(() => ({ deferred: false, release: null as (() => void) | null, confirmationPending: null as Promise<unknown> | null }));
vi.mock("@sf/public-tools/content-brief/v2-brief", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sf/public-tools/content-brief/v2-brief")>();
  return { ...actual, confirmBriefV2: (...args: Parameters<typeof actual.confirmBriefV2>) => {
    const request = actual.confirmBriefV2(...args);
    parserGate.confirmationPending = request;
    return request;
  }, parseContentBriefV2: async (...args: Parameters<typeof actual.parseContentBriefV2>) => {
    const result = await actual.parseContentBriefV2(...args);
    if (!parserGate.deferred) return result;
    return new Promise<typeof result>((resolve) => { parserGate.release = () => resolve(result); });
  } };
});

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const translate = (
      key: string,
      values?: Readonly<Record<string, unknown>>,
    ) => {
      if (key === "fields.supporting.count") {
        return `${String(values?.count ?? 0)}/${String(values?.max ?? 0)}`;
      }
      if (key === "run.resultLabel") return `Content brief result for ${String(values?.keyword)}`;
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

const { ContentBriefTool } = await import("./content-brief-tool.tsx");

const originalFetch = globalThis.fetch;
const scrollIntoViewMock = vi.fn();
let root: Root | null = null;

function fetchCalls(): readonly string[] {
  return (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
    (call) => String(call[0]),
  );
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  signInDialogMock.mockClear();
  trackMarketingEventMock.mockReset();
  parserGate.deferred = false;
  parserGate.release = null;
  parserGate.confirmationPending = null;
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoViewMock,
    writable: true,
  });
  // A fresh Response per call: a body can be read once, and the on-mount
  // website lookup already consumed the first one before any click.
  globalThis.fetch = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(Response.json({ signedIn: false })),
    ) as unknown as typeof fetch;
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
  properties: readonly string[] | null = ["sc-domain:example.com"],
): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<ContentBriefTool locale="en" properties={properties} />);
  });
  return host;
}

async function type(field: Element | null, value: string): Promise<void> {
  if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) {
    throw new Error("expected a text control");
  }
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(button: Element | null): Promise<void> {
  if (!(button instanceof HTMLElement)) throw new Error("expected a button");
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}
function serveRun(body: unknown) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/auth/session") return Response.json({ signedIn: true });
    if (url === "/api/account/websites") return Response.json({ data: { websites: [] } });
    if (url === "/api/tools/content-brief/run") return Response.json(body);
    return Response.json({}, { status: 404 });
  }) as unknown as typeof fetch;
}

describe("ContentBriefTool", () => {
  it("requests the SERP-preserving v3 response for new runs while accepting an older valid v2 receipt", async () => {
    const brief = await validContentBriefV2();
    serveRun(brief);
    const host = await renderTool();
    await type(host.querySelector("#content-brief-primary"), brief.context.input.primary);
    await click(host.querySelector("[data-run-brief]"));
    await vi.waitFor(async () => { await act(async () => { await Promise.resolve(); }); expect(host.querySelector("[data-content-brief-result]")).not.toBeNull(); });
    const request = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([input]) => String(input) === "/api/tools/content-brief/run");
    expect(JSON.parse(String((request?.[1] as RequestInit).body)).response_schema).toBe("gengrowth.content_brief/v3");
  });

  it("returns a failed generation to visible current settings without overwriting edits or starting a run", async () => {
    const brief = await validContentBriefV2({ unavailable: true });
    serveRun(brief);
    const host = await renderTool();
    await type(host.querySelector("#content-brief-primary"), brief.context.input.primary);
    await click(host.querySelector("[data-run-brief]"));
    await vi.waitFor(async () => { await act(async () => { await Promise.resolve(); }); expect(host.querySelector("[data-return-to-settings]")).not.toBeNull(); });
    await click(host.querySelector("[data-brief-settings] > summary"));
    await type(host.querySelector("#content-brief-primary"), "my newer keyword");
    await click(host.querySelector("[data-brief-settings] > summary"));
    const before = fetchCalls().length;
    await click(host.querySelector("[data-return-to-settings]"));
    expect(host.querySelector<HTMLDetailsElement>("[data-brief-settings]")?.open).toBe(true);
    expect(document.activeElement).toBe(host.querySelector("#content-brief-primary"));
    expect(host.querySelector<HTMLInputElement>("#content-brief-primary")?.value).toBe("my newer keyword");
    expect(fetchCalls()).toHaveLength(before);
    expect(host.querySelector("[data-generation-failure]")).not.toBeNull();
  });

  it("focuses the settings disclosure when returning from a previous failure during a pending run", async () => {
    const brief = await validContentBriefV2({ unavailable: true });
    serveRun(brief);
    const host = await renderTool();
    await type(host.querySelector("#content-brief-primary"), brief.context.input.primary);
    await click(host.querySelector("[data-run-brief]"));
    await vi.waitFor(async () => { await act(async () => { await Promise.resolve(); }); expect(host.querySelector("[data-return-to-settings]")).not.toBeNull(); });
    await click(host.querySelector("[data-return-to-settings]"));
    globalThis.fetch = vi.fn(async () => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    await click(host.querySelector("[data-run-brief]"));
    const button = host.querySelector<HTMLElement>("[data-return-to-settings]")!;
    button.focus();
    await click(button);
    expect(document.activeElement).toBe(host.querySelector("[data-brief-settings] > summary"));
    expect(fetchCalls()).toHaveLength(1);
  });

  it("preserves the last confirmed/exportable result when a rerun fails or needs sign-in", async () => {
    const brief = await validContentBriefV2();
    serveRun(brief);
    const host = await renderTool();
    await type(host.querySelector("#content-brief-primary"), brief.context.input.primary);
    await click(host.querySelector("[data-run-brief]"));
    await vi.waitFor(async () => { await act(async () => { await Promise.resolve(); }); expect(host.querySelector("[data-confirm-brief]")).not.toBeNull(); });
    await click(host.querySelector("[data-confirm-brief]"));
    await act(async () => { await parserGate.confirmationPending; });
    expect(host.querySelector("[data-confirmed-json]")).not.toBeNull();
    const frozen = host.querySelector("[data-confirmed-json]")!.textContent;
    for (const failure of ["signed_out", "auth_required", "rate_limited", "malformed", "network"]) {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/auth/session") return Response.json({ signedIn: failure !== "signed_out" });
        if (failure === "network") throw new Error("offline");
        if (failure === "malformed") return Response.json({ schema: "wrong" });
        return Response.json({ error: { code: failure } }, { status: failure === "auth_required" ? 401 : 429 });
      }) as unknown as typeof fetch;
      if (!host.querySelector("[data-brief-settings]")?.hasAttribute("open")) await click(host.querySelector("[data-brief-settings] > summary"));
      await click(host.querySelector("[data-run-brief]"));
      await vi.waitFor(async () => { await act(async () => { await Promise.resolve(); }); expect(host.querySelector("#content-brief-tool")?.getAttribute("aria-busy")).toBe("false"); });
      expect(host.querySelector("[data-content-brief-result]")).not.toBeNull();
      expect(host.querySelector("[data-previous-brief]")).not.toBeNull();
      expect(host.querySelector("[data-confirmed-json]")?.textContent).toBe(frozen);
      expect(host.querySelector("[data-download-confirmed-json]")?.hasAttribute("disabled")).toBe(false);
      const close = host.querySelector("[data-close-sign-in]");
      if (close) await click(close);
    }
    expect(trackMarketingEventMock.mock.calls.filter(([event]) => event === "tool_complete")).toHaveLength(1);
  });
  it("uses the v2 research and supporting-scope explanations in the actual form", async () => {
    const host = await renderTool();
    expect(host.querySelector("[data-content-brief-form]")?.textContent).toContain("v2.formIntro");
    expect(host.querySelector("[data-supporting-hint]")?.textContent).toBe("v2.supportingHint");
  });
  it("rejects a mismatched fingerprint and a legacy result instead of silently rendering either", async () => {
    const brief = await validContentBriefV2();
    for (const body of [{ ...brief, run: { ...brief.run, fingerprint: "f".repeat(64) } }, validContentBrief()]) {
      serveRun(body);
      const host = await renderTool();
      await type(host.querySelector("#content-brief-primary"), "reporting delays");
      await click(host.querySelector("[data-run-brief]"));
      await vi.waitFor(async () => { await act(async () => { await Promise.resolve(); }); expect(host.querySelector("[data-error-code]")).not.toBeNull(); });
      expect(host.querySelector("[data-content-brief-result]")).toBeNull();
      expect(host.querySelector("[data-brief-settings]")?.hasAttribute("open")).toBe(true);
      expect(trackMarketingEventMock).not.toHaveBeenCalledWith("tool_complete", expect.anything());
      await act(async () => root?.unmount());
      root = null;
      host.remove();
    }
  });
  it("does not publish completion when fingerprint validation resolves after unmount", async () => {
    const brief = await validContentBriefV2();
    parserGate.deferred = true;
    serveRun(brief);
    const host = await renderTool();
    await type(host.querySelector("#content-brief-primary"), brief.context.input.primary);
    await click(host.querySelector("[data-run-brief]"));
    await vi.waitFor(() => expect(parserGate.release).not.toBeNull());
    expect(host.querySelector("[data-content-brief-result]")).toBeNull();
    await act(async () => { root?.unmount(); root = null; });
    await act(async () => { parserGate.release?.(); await Promise.resolve(); });
    expect(trackMarketingEventMock).not.toHaveBeenCalledWith("tool_complete", expect.anything());
  });
  it("offers Chinese generation without the historical v1 unsupported-language warning", async () => {
    const host = await renderTool();
    const language = host.querySelector("#content-brief-language");
    if (!(language instanceof HTMLSelectElement)) throw new Error("no language select");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(language, "zh");
      language.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(language.value).toBe("zh");
    expect(host.querySelector("[data-language-unsupported]")).toBeNull();
  });
  it("opens the sign-in dialog for a signed-out visitor and never posts the run", async () => {
    const host = await renderTool();
    await type(host.querySelector("#content-brief-primary"), "approval workflow");
    await click(host.querySelector("[data-run-brief]"));

    expect(host.querySelector('[data-testid="sign-in-dialog"]')).not.toBeNull();
    expect(fetchCalls()).not.toContain("/api/tools/content-brief/run");
    expect(trackMarketingEventMock).not.toHaveBeenCalled();
  });

  it("is a real form: submitting it (Enter in a field) runs the same flow", async () => {
    const host = await renderTool();
    await type(host.querySelector("#content-brief-primary"), "approval workflow");
    const form = host.querySelector("form[data-content-brief-form]");
    expect(form).not.toBeNull();
    expect(host.querySelector("[data-run-brief]")?.getAttribute("type")).toBe("submit");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="sign-in-dialog"]')).not.toBeNull();
    expect(fetchCalls()).not.toContain("/api/tools/content-brief/run");
  });

  it("refuses an empty primary keyword before touching the network", async () => {
    const host = await renderTool();
    const before = fetchCalls().length;
    await click(host.querySelector("[data-run-brief]"));
    expect(host.querySelector("#content-brief-validation")?.textContent).toBe(
      "validation.primaryRequired",
    );
    // Only the on-mount website lookup ran; the click added nothing.
    expect(fetchCalls().length).toBe(before);
  });

  it("counts separated pieces under the supporting field with the engine's cap", async () => {
    const host = await renderTool();
    expect(host.querySelector("[data-supporting-count]")?.textContent).toBe(
      `0/${SUPPORTING_KEYWORDS_MAX}`,
    );
    await type(host.querySelector("#content-brief-supporting"), "a, b，c\nd,");
    expect(host.querySelector("[data-supporting-count]")?.textContent).toBe(
      `4/${SUPPORTING_KEYWORDS_MAX}`,
    );
  });

  it("disables the property select and explains when no property is connected", async () => {
    const host = await renderTool(null);
    const select = host.querySelector("#content-brief-property");
    expect(select instanceof HTMLSelectElement && select.disabled).toBe(true);
    expect(host.querySelector("[data-property-not-connected]")).not.toBeNull();
  });

  it("disables the product-profile select for a signed-out visitor", async () => {
    const host = await renderTool();
    const select = host.querySelector("#content-brief-website");
    expect(select instanceof HTMLSelectElement && select.disabled).toBe(true);
    expect(host.querySelector("[data-website-signed-out]")).not.toBeNull();
  });

  it("posts the contract body and renders a valid brief for a signed-in visitor", async () => {
    const brief = await validContentBriefV2();
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/auth/session") {
        return Promise.resolve(Response.json({ signedIn: true }));
      }
      if (url === "/api/account/websites") {
        return Promise.resolve(
          Response.json({
            data: {
              websites: [
                {
                  websiteId: "site_1",
                  origin: "https://example.com",
                  host: "example.com",
                  canonicalSiteKey: "example.com",
                  displayName: "Example",
                  isPrimary: true,
                  profileState: "confirmed",
                  confirmedSnapshotId: "snap_1",
                  confirmedSnapshotRevision: 3,
                  confirmedAt: "2026-08-01T00:00:00.000Z",
                  createdAt: "2026-08-01T00:00:00.000Z",
                  updatedAt: "2026-08-01T00:00:00.000Z",
                },
              ],
            },
          }),
        );
      }
      if (url === "/api/tools/content-brief/run") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toEqual({
          primary: "reporting delays",
          supporting: ["reporting dates"],
          market: "US",
          language: "en",
          gsc_property: "sc-domain:owned.example",
          response_schema: CONTENT_BRIEF_V3_SCHEMA,
        });
        return Promise.resolve(Response.json(brief));
      }
      return Promise.resolve(Response.json({ error: { code: "invalid_request" } }, { status: 400 }));
    }) as unknown as typeof fetch;

    const host = await renderTool(["sc-domain:owned.example"]);
    await type(host.querySelector("#content-brief-primary"), " reporting  delays ");
    await type(host.querySelector("#content-brief-supporting"), "reporting dates");
    const property = host.querySelector("#content-brief-property");
    if (!(property instanceof HTMLSelectElement)) throw new Error("no property select");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        property,
        "sc-domain:owned.example",
      );
      property.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const submit = host.querySelector("[data-run-brief]");
    if (!(submit instanceof HTMLButtonElement)) throw new Error("no submit button");
    submit.focus();
    await click(submit);
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchCalls()).toContain("/api/tools/content-brief/run");
    await vi.waitFor(() => expect(host.querySelector("[data-content-brief-result]")).not.toBeNull());
    expect(host.querySelector("[data-content-brief-result]")?.textContent).toContain(brief.context.input.primary);
    const result = host.querySelector("[data-content-brief-result]");
    expect(document.activeElement === result).toBe(true);
    expect(result?.getAttribute("tabindex")).toBe("-1");
    expect(result?.getAttribute("role")).toBe("region");
    expect(result?.getAttribute("aria-label")).toBe("Content brief result for " + brief.context.input.primary);
    expect(result?.closest("details:not([open])") === null).toBe(true);
    expect(trackMarketingEventMock).toHaveBeenCalledWith("tool_complete", {
      tool_name: "content_brief",
    });

    const settings = host.querySelector("details[data-brief-settings]");
    expect(settings).not.toBeNull();
    expect(settings?.hasAttribute("open")).toBe(false);
    const submitted = fetchCalls().filter((url) => url === "/api/tools/content-brief/run").length;
    await click(settings?.querySelector("summary") ?? null);
    expect(settings?.hasAttribute("open")).toBe(true);
    await type(host.querySelector("#content-brief-primary"), "a different keyword");
    expect(host.querySelector("[data-content-brief-result]")?.textContent).toContain(brief.context.input.primary);
    expect(fetchCalls().filter((url) => url === "/api/tools/content-brief/run")).toHaveLength(submitted);
  });

  it("renders the server's error code and opens sign-in on auth_required", async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/session") {
        return Promise.resolve(Response.json({ signedIn: true }));
      }
      if (url === "/api/account/websites") {
        return Promise.resolve(Response.json({ data: { websites: [] } }));
      }
      return Promise.resolve(
        Response.json({ error: { code: "auth_required" } }, { status: 401 }),
      );
    }) as unknown as typeof fetch;

    const host = await renderTool();
    await type(host.querySelector("#content-brief-primary"), "approval workflow");
    await click(host.querySelector("[data-run-brief]"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(host.querySelector("[data-error-code]")?.getAttribute("data-error-code")).toBe(
      "auth_required",
    );
    expect(host.querySelector('[data-testid="sign-in-dialog"]')).not.toBeNull();
    expect(host.querySelector('[data-content-brief-result]')).toBeNull();
  });

  it.each([
    { stage: "auth", failure: "response", code: "auth_unavailable", runs: 0 },
    { stage: "auth", failure: "network", code: "auth_unavailable", runs: 0 },
    { stage: "tool", failure: "response", code: "rate_limited", runs: 1 },
    { stage: "tool", failure: "network", code: "unknown", runs: 1 },
    { stage: "tool", failure: "response", code: "auth_required", runs: 1 },
  ])("reveals a deferred $stage/$failure/$code failure after settings were closed while running", async ({ stage, failure, code, runs }) => {
    let resolveResponse!: (value: Response) => void;
    let rejectResponse!: (error: Error) => void;
    const pending = new Promise<Response>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/session") {
        return stage === "auth" ? pending.then((response) => response.clone()) : Promise.resolve(Response.json({ signedIn: true }));
      }
      if (url === "/api/account/websites") {
        return Promise.resolve(Response.json({ data: { websites: [] } }));
      }
      if (url === "/api/tools/content-brief/run") return pending;
      return Promise.resolve(Response.json({}, { status: 400 }));
    }) as unknown as typeof fetch;

    const host = await renderTool();
    await type(host.querySelector("#content-brief-primary"), "approval workflow");
    await click(host.querySelector("[data-run-brief]"));
    expect(host.querySelector("#content-brief-tool")?.getAttribute("aria-busy")).toBe("true");
    const settings = host.querySelector("details[data-brief-settings]");
    await click(settings?.querySelector("summary") ?? null);
    expect(settings?.hasAttribute("open")).toBe(false);

    await act(async () => {
      if (failure === "network") rejectResponse(new Error("fixture network failure"));
      else resolveResponse(Response.json({ error: { code } }, { status: code === "auth_required" ? 401 : 429 }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const error = host.querySelector(`[data-error-code="${code}"]`);
    expect(error).not.toBeNull();
    expect(error?.closest("details:not([open])") === null).toBe(true);
    expect(settings?.hasAttribute("open")).toBe(true);
    const submit = host.querySelector("[data-run-brief]");
    expect(submit instanceof HTMLButtonElement && submit.disabled).toBe(false);
    expect(fetchCalls().filter((url) => url === "/api/tools/content-brief/run")).toHaveLength(runs);
    expect(host.querySelector('[data-content-brief-result]')).toBeNull();
  });

  it("reopens settings after deferred signed-out auth so cancelling sign-in leaves the form usable", async () => {
    let resolveSession!: (value: Response) => void;
    const session = new Promise<Response>((resolve) => { resolveSession = resolve; });
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/session") return session.then((response) => response.clone());
      return Promise.resolve(Response.json({ data: { websites: [] } }));
    }) as unknown as typeof fetch;

    const host = await renderTool();
    await type(host.querySelector("#content-brief-primary"), "approval workflow");
    await click(host.querySelector("[data-run-brief]"));
    const settings = host.querySelector("details[data-brief-settings]");
    await click(settings?.querySelector("summary") ?? null);
    expect(settings?.hasAttribute("open")).toBe(false);
    await act(async () => {
      resolveSession(Response.json({ signedIn: false }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="sign-in-dialog"]')).not.toBeNull();
    await click(host.querySelector("[data-close-sign-in]"));
    expect(host.querySelector('[data-testid="sign-in-dialog"]')).toBeNull();
    expect(settings?.hasAttribute("open")).toBe(true);
    const input = host.querySelector("#content-brief-primary");
    expect(input instanceof HTMLInputElement && !input.disabled && input.value === "approval workflow").toBe(true);
    const submit = host.querySelector("[data-run-brief]");
    expect(submit instanceof HTMLButtonElement && !submit.disabled).toBe(true);
    expect(submit?.closest("details:not([open])") === null).toBe(true);
    expect(fetchCalls().filter((url) => url === "/api/tools/content-brief/run")).toHaveLength(0);
  });
});
