/** @vitest-environment jsdom */

/**
 * The settings page as a whole (T11): the seams between its three blocks, which
 * each block's own test cannot see. Rendered with the real store, the real
 * sources query and the real delete block; only `fetch` and the router are
 * stubbed.
 *
 * - Exactly one real action (`[data-wb-real-action]`): the delete block. The
 *   e2e spec clicks inside it, so a second one (a sources block that grew an
 *   OAuth button, a wrapper that took the attribute) would make that locator
 *   ambiguous. Checked on a read and on CONTEXT_INCOMPLETE, where the sources
 *   panel adds a `/context` link that must not sit inside the real action.
 * - Sample markers stay out of the real action (Claude #18). The PR-1 contract
 *   "no sample chip anywhere" is narrowed to that subtree now that the notify
 *   block carries one; the page has exactly one chip, and it is in that block.
 * - The PR-1 "lands in a later batch" sentence is gone (the page is complete);
 *   there is still no legacy settings link, because that page was deleted.
 * - Q26 / Q30: the padded `.wb-reset` root at overview width, frame copy
 *   marked, and in en that copy has no Chinese and no raw key path.
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const {
  buttonByText,
  DS_MESSAGES,
  DS_PROJECT_ID,
  HAN,
  mountWithStore,
  response,
  settle,
  sourceSlot,
  sourcesOk,
  sourcesProblem,
} = await import("../data-sources/data-sources-test-harness.tsx");
const { SettingsView } = await import("./SettingsView.tsx");

const SHELL = DS_MESSAGES.en.workbench.shell;
const CHIP = `span[title="${SHELL.sampleTitle}"]`;

type Answer = "read" | "needProfile";

let sourcesAnswer: Answer = "read";
let calls: readonly { readonly url: string; readonly method: string }[] = [];
let cleanup: (() => void) | null = null;

beforeEach(() => {
  sourcesAnswer = "read";
  calls = [];
  router.replace.mockReset();
  router.refresh.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls = [...calls, { url: String(input), method }];
      if (method === "DELETE") return Promise.resolve(response(204, "", ""));
      return Promise.resolve(
        sourcesAnswer === "read"
          ? sourcesOk([
              sourceSlot("gsc", "available"),
              sourceSlot("ga4", "disconnected"),
            ])
          : sourcesProblem(422, "CONTEXT_INCOMPLETE"),
      );
    }),
  );
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function renderPage(locale: "en" | "zh-CN" = "en") {
  const view = mountWithStore(
    <SettingsView projectId={DS_PROJECT_ID} />,
    locale,
  );
  cleanup = view.unmount;
  await settle();
  return view;
}

describe("SettingsView: composition", () => {
  it("titles the page and hands the delete block the current project", async () => {
    const view = await renderPage();
    const titles = view.app.querySelectorAll("h1[data-wb-page-title]");
    expect(titles).toHaveLength(1);
    expect(titles[0]?.textContent).toBe("Settings");

    act(() => buttonByText(view.app, "Delete product").click());
    act(() => buttonByText(view.app, "Confirm deletion").click());
    await settle();
    const deletes = calls.filter((call) => call.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.url.endsWith(`/api/mvp/projects/${DS_PROJECT_ID}`)).toBe(
      true,
    );
  });

  it("renders the notify block, then the sources block, then the delete block", async () => {
    const view = await renderPage();
    const order = [
      ...view.app.querySelectorAll(
        "[data-wb-notify], [data-wb-sources-summary], [data-wb-real-action]",
      ),
    ];
    expect(
      order.map((node) =>
        node.hasAttribute("data-wb-notify")
          ? "notify"
          : node.hasAttribute("data-wb-sources-summary")
            ? "sources"
            : "delete",
      ),
    ).toEqual(["notify", "sources", "delete"]);
    expect(
      view.app.querySelectorAll('[data-wb-notify] input[role="switch"]'),
    ).toHaveLength(4);
    expect(
      view.app.querySelectorAll(
        '[data-wb-sources-summary] [data-wb-sources-panel="read"]',
      ),
    ).toHaveLength(1);
  });

  it("no longer says the module lands later, and links to no legacy settings page", async () => {
    const view = await renderPage();
    const text = view.app.textContent ?? "";
    expect(text).toContain("Notification preferences");
    expect(text).toContain("Not sample data");
    expect(text).not.toContain(SHELL.inProgressNoLegacy);
    expect(text).not.toContain("later batch");
    expect(text).not.toContain(SHELL.inProgressDetail);
    expect(
      view.app.querySelectorAll(`a[href="/p/${DS_PROJECT_ID}/sources"]`),
    ).toHaveLength(1);
    expect(view.app.querySelectorAll("a[data-wb-legacy-link]")).toHaveLength(0);
    expect(
      view.app.querySelectorAll(`a[href="/p/${DS_PROJECT_ID}/settings"]`),
    ).toHaveLength(0);
  });

  it("no longer says the module lands later (zh-CN)", async () => {
    const view = await renderPage("zh-CN");
    const text = view.app.textContent ?? "";
    expect(text).toContain("通知偏好");
    expect(text).not.toContain("后续批次");
  });
});

describe.each<Answer>(["read", "needProfile"])(
  "SettingsView: the one real action (sources %s)",
  (answer) => {
    beforeEach(() => {
      sourcesAnswer = answer;
    });

    it("has exactly one real action, and it is the delete block", async () => {
      const view = await renderPage();
      expect(
        view.app.querySelectorAll(`[data-wb-sources-panel="${answer}"]`),
      ).toHaveLength(1);
      const actions = view.app.querySelectorAll("[data-wb-real-action]");
      expect(actions).toHaveLength(1);
      expect(actions[0]?.querySelectorAll("button")).toHaveLength(1);
      expect(actions[0]?.querySelector("button")?.textContent).toBe(
        "Delete product",
      );
      expect(actions[0]?.querySelectorAll("a")).toHaveLength(0);
    });

    it("keeps every sample marker outside the real action; the one chip is in the notify block", async () => {
      const view = await renderPage();
      const chips = view.app.querySelectorAll(CHIP);
      expect(chips).toHaveLength(1);
      expect(chips[0]?.closest("[data-wb-notify]")).not.toBeNull();
      const action = view.app.querySelectorAll("[data-wb-real-action]");
      expect(action).toHaveLength(1);
      expect(action[0]?.querySelectorAll(CHIP)).toHaveLength(0);
      expect(action[0]?.textContent).not.toContain(SHELL.sampleData);
      expect(action[0]?.textContent).not.toContain(SHELL.sampleSite);
    });
  },
);

describe("SettingsView: the /context way out is not an action", () => {
  it("renders the panel's /context link outside the real action", async () => {
    sourcesAnswer = "needProfile";
    const view = await renderPage();
    const contextLinks = view.app.querySelectorAll(
      `a[href="/p/${DS_PROJECT_ID}/context"]`,
    );
    expect(contextLinks).toHaveLength(1);
    expect(
      contextLinks[0]?.closest("[data-wb-sources-summary]"),
    ).not.toBeNull();
    expect(contextLinks[0]?.closest("[data-wb-real-action]")).toBeNull();
  });
});

describe("SettingsView: page frame", () => {
  it("is the padded overview-width root with no inline style", async () => {
    const view = await renderPage();
    const rootElement = view.app.firstElementChild;
    expect(rootElement?.classList.contains("wb-reset")).toBe(true);
    expect(rootElement?.classList.contains("max-w-5xl")).toBe(true);
    expect(rootElement?.classList.contains("p-6")).toBe(true);
    expect(view.root.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("marks frame copy in every block and keeps it English in en (Q30)", async () => {
    const view = await renderPage();
    for (const region of ["[data-wb-notify]", "[data-wb-sources-summary]"]) {
      expect(
        view.app.querySelectorAll(`${region} [data-wb-frame]`).length,
        region,
      ).toBeGreaterThanOrEqual(1);
    }
    const frames = [...view.app.querySelectorAll("[data-wb-frame]")];
    expect(frames.length).toBeGreaterThanOrEqual(4);
    expect(frames.some((frame) => frame.querySelector("h1") !== null)).toBe(
      true,
    );
    for (const frame of frames) {
      const text = frame.textContent ?? "";
      expect(text.trim().length, frame.outerHTML).toBeGreaterThan(0);
      expect(HAN.test(text), text).toBe(false);
      expect(text, text).not.toMatch(/workbench\.|settings\.|dataSources\./u);
    }
  });
});
