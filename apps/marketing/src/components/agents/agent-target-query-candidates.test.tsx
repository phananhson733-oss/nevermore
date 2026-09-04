// @vitest-environment jsdom
// @input  -- the four shapes the Search Console read can return, plus a request that fails
// @output -- proof that "nobody found it" and "we could not ask" never render as each other
// @pos    -- client guard for the target-query candidate picker

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../i18n/messages/en.json";
import { AgentTargetQueryCandidates } from "./agent-target-query-candidates";

describe("AgentTargetQueryCandidates", () => {
  let host: HTMLDivElement;
  let root: Root;
  const picked: string[] = [];

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    picked.length = 0;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function render(url = "https://example.com/birth-chart") {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={en}>
          <AgentTargetQueryCandidates
            url={url}
            disabled={false}
            onPick={(query) => picked.push(query)}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  function respondWith(data: unknown, ok = true) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ok
          ? new Response(JSON.stringify({ data }), { status: 200 })
          : new Response("nope", { status: 500 }),
      ),
    );
  }

  async function clickLoad() {
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[data-target-query-action="load"]')
        ?.click();
    });
  }

  it("does not spend a Search Console read until it is asked to", () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    render();

    // Opening the editor must not cost the visitor a call against the shared
    // quota for a field they may not be editing.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      host.querySelector('[data-target-query-action="load"]'),
    ).not.toBeNull();
  });

  it("offers each query as a pick and reports what it actually earned", async () => {
    respondWith({
      kind: "candidates",
      property: "sc-domain:example.com",
      windowStart: "2026-08-04",
      windowEnd: "2026-09-01",
      candidates: [
        { query: "natal chart", impressions: 900, clicks: 20, position: 8.42 },
        { query: "birth chart", impressions: 120, clicks: 2, position: 31.5 },
      ],
    });
    render();
    await clickLoad();

    const options = [
      ...host.querySelectorAll<HTMLButtonElement>("[data-target-query-candidate]"),
    ];
    expect(options.map((node) => node.getAttribute("data-target-query-candidate"))).toEqual([
      "natal chart",
      "birth chart",
    ]);
    expect(options[0]?.textContent).toContain("900");
    expect(options[0]?.textContent).toContain("8.4");

    act(() => options[1]?.click());
    expect(picked).toEqual(["birth chart"]);
  });

  it("says a page nobody found and a read that failed in different words", async () => {
    /*
      The distinction the whole read exists to keep. Telling an owner their
      page earns no impressions when the truth is that Search Console could not
      be reached sends them to rewrite a page that may be fine.
    */
    respondWith({
      kind: "no_rows",
      property: "sc-domain:example.com",
      windowStart: "2026-08-04",
      windowEnd: "2026-09-01",
    });
    render();
    await clickLoad();

    const empty = host.querySelector("[data-target-query-state]");
    expect(empty?.getAttribute("data-target-query-state")).toBe("no_rows");
    expect(empty?.textContent).toContain("nobody has found it yet");

    act(() => root.unmount());
    host.remove();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    respondWith({ kind: "unavailable" });
    render();
    await clickLoad();

    const failed = host.querySelector("[data-target-query-state]");
    expect(failed?.getAttribute("data-target-query-state")).toBe("unavailable");
    expect(failed?.textContent).toContain("says nothing about this page");
  });

  it("sends an unconnected visitor to the consent screen, not to an empty list", async () => {
    respondWith({ kind: "no_grant" });
    render();
    await clickLoad();

    const connect = host.querySelector<HTMLAnchorElement>(
      '[data-target-query-action="connect"]',
    );
    expect(connect).not.toBeNull();
    expect(connect?.getAttribute("href")).toContain(
      "/api/auth/google/start?scope=gsc",
    );
  });

  it("keeps a failed request from reading as a measured answer", async () => {
    respondWith(null, false);
    render();
    await clickLoad();

    expect(
      host
        .querySelector("[data-target-query-state]")
        ?.getAttribute("data-target-query-state"),
    ).toBe("failed");
  });
});
