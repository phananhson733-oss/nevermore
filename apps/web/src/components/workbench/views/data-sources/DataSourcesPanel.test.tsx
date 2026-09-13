/** @vitest-environment jsdom */

/**
 * The shared real-connections block (T10 Step 5; T11 mounts it on settings),
 * driven through the real `useProjectSources`, the real problem+json parsing
 * and the real `ApiError`, with only `fetch` stubbed. A hand-built view model
 * handed to the component would prove nothing about what a 422 does on screen.
 *
 * What it must never do: show "not connected" for something it could not read
 * (Q4), name a cause for a failure other than CONTEXT_INCOMPLETE, decide that
 * by HTTP status, print 0 for a missing count, or offer an action.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceConnection } from "@/lib/api/hooks-sources";
import { DataSourcesPanel } from "./DataSourcesPanel.tsx";
import {
  DS_MESSAGES,
  DS_PROJECT_ID,
  mountPlain,
  settle,
  snapshot,
  sourceSlot,
  sourcesOk,
  sourcesProblem,
  type DsLocale,
} from "./data-sources-test-harness.tsx";

const REAL = DS_MESSAGES.en.workbench.dataSources.real;

let answer: () => Promise<Response> = () => new Promise<Response>(() => {});
let requested: readonly string[] = [];
let cleanup: (() => void) | null = null;

beforeEach(() => {
  requested = [];
  answer = () => new Promise<Response>(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      requested = [...requested, String(input)];
      return answer();
    }),
  );
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.unstubAllGlobals();
});

async function render(locale: DsLocale = "en"): Promise<HTMLElement> {
  const mounted = mountPlain(<DataSourcesPanel projectId={DS_PROJECT_ID} />, locale);
  cleanup = mounted.unmount;
  await settle();
  return mounted.container;
}

function answerWith(sources: readonly SourceConnection[]): void {
  answer = () => Promise.resolve(sourcesOk(sources));
}

function card(scope: HTMLElement, provider: "gsc" | "ga4"): HTMLElement {
  const found = scope.querySelector(`[data-wb-source="${provider}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`no ${provider} card`);
  return found;
}

function fact(scope: HTMLElement, id: string): string | null {
  return scope.querySelector(`[data-wb-fact="${id}"]`)?.textContent ?? null;
}

describe("DataSourcesPanel: loading", () => {
  it("renders a skeleton while the first read is in flight, never unknown or not connected", async () => {
    const scope = await render();
    expect(requested.some((url) => url.endsWith(`/projects/${DS_PROJECT_ID}/sources`))).toBe(true);
    expect(scope.querySelector('[data-wb-sources-panel="loading"][aria-busy="true"]')).not.toBeNull();
    expect(scope.textContent).not.toContain(REAL.unknown);
    expect(scope.textContent).not.toContain(REAL.notConnected);
  });
});

describe("DataSourcesPanel: a read", () => {
  it("shows each provider from its own slot, with the latest snapshot's facts", async () => {
    answerWith([
      sourceSlot("crawl", "available"),
      sourceSlot("gsc", "available", { latestSnapshot: snapshot() }),
      sourceSlot("ga4", "disconnected"),
    ]);
    const scope = await render();
    const gsc = card(scope, "gsc");
    expect(gsc.getAttribute("data-wb-status")).toBe("connected");
    expect(gsc.querySelector("h3")?.textContent).toBe("Google Search Console");
    expect(gsc.textContent).toContain("Connected");
    expect(fact(gsc, "state")).toBe("Available");
    expect(fact(gsc, "lastCollected")).toBe("2026-09-10 08:30");
    expect(gsc.querySelector("time")?.getAttribute("dateTime")).toBe(snapshot().capturedAt);
    expect(fact(gsc, "availability")).toBe("Available");
    expect(fact(gsc, "rows")).toBe("1,234");
    expect(fact(gsc, "limitation")).toBe("Sampled query data.");

    const ga4 = card(scope, "ga4");
    expect(ga4.getAttribute("data-wb-status")).toBe("notConnected");
    expect(ga4.textContent).toContain(REAL.notConnected);
    expect(fact(ga4, "state")).toBe("Disconnected");
    expect(ga4.querySelector("[data-wb-no-snapshot]")?.textContent).toBe(REAL.noSnapshot);
    expect(ga4.textContent).toContain(REAL.ga4NoConsumer);
    expect(gsc.textContent).not.toContain(REAL.ga4NoConsumer);

    expect(scope.querySelector("[data-wb-sources-notice]")).toBeNull();
  });

  it("offers no action: no button, no form control", async () => {
    answerWith([sourceSlot("gsc", "permission_denied"), sourceSlot("ga4", "connected")]);
    const scope = await render();
    expect(scope.querySelectorAll("button, input, select, textarea, form")).toHaveLength(0);
  });

  it("shows a connection whose data has gone bad as connected, with the state that says so", async () => {
    answerWith([sourceSlot("gsc", "permission_denied"), sourceSlot("ga4", "connected")]);
    const gsc = card(await render(), "gsc");
    expect(gsc.getAttribute("data-wb-status")).toBe("connected");
    expect(fact(gsc, "state")).toBe("Permission denied");
  });

  it("keeps a row count of 0 and prints a dash for what it cannot read", async () => {
    answerWith([
      sourceSlot("gsc", "available", {
        latestSnapshot: snapshot({ rowCount: 0, availability: "mostly" as never, limitation: "" }),
      }),
      sourceSlot("ga4", "connected"),
    ]);
    const gsc = card(await render(), "gsc");
    expect(fact(gsc, "rows")).toBe("0");
    expect(fact(gsc, "availability")).toBe("—");
    expect(fact(gsc, "limitation")).toBe("—");
  });

  it("reads a missing provider slot as unknown and says unknown is not not-connected", async () => {
    answerWith([sourceSlot("gsc", "available", { latestSnapshot: snapshot() })]);
    const scope = await render();
    const ga4 = card(scope, "ga4");
    expect(ga4.getAttribute("data-wb-status")).toBe("unknown");
    expect(ga4.textContent).toContain(REAL.unknown);
    expect(ga4.querySelector("dl")).toBeNull();
    expect(scope.querySelector('[data-wb-sources-notice="read"]')?.textContent).toBe(REAL.unknownHint);
  });
});

describe("DataSourcesPanel: failures are judged by problem code (Q4)", () => {
  it("names the product profile gate for CONTEXT_INCOMPLETE and links to it", async () => {
    answer = () => Promise.resolve(sourcesProblem(422, "CONTEXT_INCOMPLETE"));
    const scope = await render();
    const notice = scope.querySelector('[data-wb-sources-notice="needProfile"]');
    expect(notice?.textContent).toContain(REAL.needProfile);
    const link = notice?.querySelector("a");
    expect(link?.getAttribute("href")).toBe(`/p/${DS_PROJECT_ID}/context`);
    expect(link?.textContent).toBe(REAL.needProfileCta);
    expect(scope.textContent).not.toContain(REAL.otherError);
    expect(scope.textContent).not.toContain(REAL.notConnected);
    expect(card(scope, "gsc").getAttribute("data-wb-status")).toBe("unknown");
    expect(card(scope, "ga4").getAttribute("data-wb-status")).toBe("unknown");
  });

  it("treats a 422 with another code as the neutral failure, with no profile gate", async () => {
    answer = () => Promise.resolve(sourcesProblem(422, "VALIDATION_FAILED"));
    const scope = await render();
    const notice = scope.querySelector('[data-wb-sources-notice="failed"]');
    expect(notice?.textContent).toBe(`${REAL.otherError}${REAL.unknownHint}`);
    expect(scope.textContent).not.toContain(REAL.needProfile);
    expect(scope.querySelector(`a[href="/p/${DS_PROJECT_ID}/context"]`)).toBeNull();
  });

  it("never turns a server failure into not connected", async () => {
    answer = () => Promise.resolve(sourcesProblem(500, "INTERNAL"));
    const scope = await render();
    expect(card(scope, "gsc").textContent).toContain(REAL.unknown);
    expect(card(scope, "ga4").textContent).toContain(REAL.unknown);
    expect(scope.textContent).not.toContain(REAL.notConnected);
    expect(scope.textContent).not.toContain(REAL.connected);
  });

  it("names the gate in zh-CN as the product profile", async () => {
    answer = () => Promise.resolve(sourcesProblem(422, "CONTEXT_INCOMPLETE"));
    const scope = await render("zh-CN");
    expect(scope.querySelector('[data-wb-sources-notice="needProfile"]')?.textContent).toContain("产品画像");
  });
});
