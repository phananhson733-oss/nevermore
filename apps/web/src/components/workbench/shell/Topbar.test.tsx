/** @vitest-environment jsdom */

/**
 * The topbar's own behaviour is two things. Every route out of it has to ask
 * before a dirty Context editor is discarded: "+ new site" is a plain `Link`,
 * so nothing about the markup says whether the guard is wired — only clicking
 * it does. And "clear sample" has to ask before it wipes the project, from a
 * box that is actually reachable (裁决 Q32), in words that say what goes.
 */

import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as HooksModule from "@/lib/workbench/store/hooks";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { storageKey, WORKBENCH_SWEPT_EVENT } from "@/lib/workbench/store/persistence";
import {
  WorkbenchProvider,
  type PublicWorkbenchAction,
  type WorkbenchContextValue,
} from "@/lib/workbench/store/WorkbenchProvider";
import { initialProjectState, type ProjectSeed } from "@/lib/workbench/store/reducer";
import { PERSISTED_VERSION } from "@/lib/workbench/store/schema";
import { populatedProjectState } from "@/lib/workbench/store/test-fixtures";
import { WB_APP_ROOT_ID, WB_ROOT_ID } from "../ui/ids.ts";

const en = getMessages("en");
const zhCN = getMessages("zh-CN");

const mocks = vi.hoisted(() => ({
  hasUnsavedContextChanges: vi.fn<() => boolean>(),
  /** Every action a component handed to the provider's `dispatch`, in order. */
  dispatched: [] as unknown[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/p/[projectId]/_context-navigation-guard", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasUnsavedContextChanges: mocks.hasUnsavedContextChanges,
}));
// The real provider and reducer stay in charge; this only records what reaches
// `dispatch`. It is needed because `clearDemo` is idempotent: a second dispatch
// lands on a state that is already clear, so nothing rendered can tell one
// from two. One wrapper per real `dispatch` (React keeps that one stable), so
// the value a component sees keeps its identity from render to render.
vi.mock("@/lib/workbench/store/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof HooksModule>();
  const wrappers = new WeakMap<object, WorkbenchContextValue["dispatch"]>();
  function recording(dispatch: WorkbenchContextValue["dispatch"]): WorkbenchContextValue["dispatch"] {
    const known = wrappers.get(dispatch);
    if (known) return known;
    const wrapper = (action: PublicWorkbenchAction): void => {
      mocks.dispatched.push(action);
      dispatch(action);
    };
    wrappers.set(dispatch, wrapper);
    return wrapper;
  }
  return {
    ...actual,
    useWorkbench: (): WorkbenchContextValue => {
      const value = actual.useWorkbench();
      return { ...value, dispatch: recording(value.dispatch) };
    },
  };
});

const { Topbar } = await import("./Topbar.tsx");

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";
const SEED: ProjectSeed = {
  url: "https://example.test",
  brand: "Example",
  market: "US",
};

/** The store as the topbar sees it, so a test can dispatch into the real provider. */
const store: { current: WorkbenchContextValue | null } = { current: null };

function StoreProbe() {
  store.current = useWorkbench();
  return null;
}

function Harness({ locale }: { readonly locale: "en" | "zh-CN" }) {
  const paletteButtonRef = useRef<HTMLButtonElement>(null);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zhCN} timeZone="UTC">
      <WorkbenchProvider projectId={PROJECT_ID} seed={SEED}>
        <StoreProbe />
        {/* Nested as app/p/[projectId]/layout.tsx and ShellChrome nest them:
            `#wb-root` (never inert, the portal target) around `#wb-app` (made
            inert by an open Dialog). Both are in the first commit, before any
            test opens a box — a box open on the first frame could look up its
            portal target before these exist and prove nothing about where it
            lands. */}
        <div id={WB_ROOT_ID}>
          <div id={WB_APP_ROOT_ID}>
            <Topbar
              projectControl={null}
              accountControl={null}
              onMenu={() => {}}
              onPalette={() => {}}
              onDrawer={() => {}}
              paletteButtonRef={paletteButtonRef}
              drawerButtonRef={drawerButtonRef}
              sidebarId="wb-sidebar"
              sidebarOpen={false}
            />
          </div>
        </div>
      </WorkbenchProvider>
    </NextIntlClientProvider>
  );
}

let cleanup: (() => void) | null = null;

function render(locale: "en" | "zh-CN" = "en") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<Harness locale={locale} />));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

function newSiteLink(scope: ParentNode): HTMLAnchorElement {
  const found = scope.querySelector<HTMLAnchorElement>('a[href="/new-project"]');
  if (!found) throw new Error("the topbar renders no new-site link");
  return found;
}

/** Returns whether the click was cancelled, the way a `Link` would see it. */
function click(target: HTMLElement): boolean {
  const observed: boolean[] = [];
  // React 19 delegates to the root container, which sits below <body>, so this
  // runs after the component's handler. Cancelling here as well keeps jsdom from
  // trying to follow the href (it cannot navigate) without hiding whether the
  // component itself cancelled.
  const observe = (event: Event): void => {
    observed.push(event.defaultPrevented);
    event.preventDefault();
  };
  document.body.addEventListener("click", observe);
  try {
    act(() => {
      target.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
  } finally {
    document.body.removeEventListener("click", observe);
  }
  const [cancelled] = observed;
  if (cancelled === undefined) throw new Error("the click never reached <body>");
  return cancelled;
}

function newerBuildBytes(): string {
  return JSON.stringify({ v: PERSISTED_VERSION, state: { ...initialProjectState(SEED), futureField: 1 } });
}

/**
 * Storage bytes for this project with every field filled. `demo` true is the
 * sample site as `loadDemo` leaves it; `demo` false is the same fields as the
 * operator's own data, which is what "clear sample" must never be offered over.
 */
function projectBytes(demo: boolean): string {
  return JSON.stringify({ v: PERSISTED_VERSION, state: { ...populatedProjectState(SEED), demo } });
}

/** The visible short label shown below `lg`, where the live region is not painted. */
function compactNotice(scope: ParentNode): HTMLElement | null {
  return scope.querySelector<HTMLElement>("[data-wb-storage-compact]");
}

/**
 * The compact label is painted only below `lg`, hidden from assistive tech (the
 * live region already announces the sentence), and never a second status.
 */
function expectCompactNotice(container: HTMLElement, text: string): void {
  const compact = compactNotice(container);
  if (!compact) throw new Error("no compact storage notice rendered");
  expect(compact.textContent).toBe(text);
  expect(compact.getAttribute("aria-hidden")).toBe("true");
  expect(compact.classList.contains("lg:hidden")).toBe(true);
  expect(compact.closest('[role="status"]')).toBeNull();
  expect(compact.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
}

function statusText(container: HTMLElement): string | null | undefined {
  return container.querySelector('[role="status"]')?.textContent;
}

/** What the confirm box says, per locale: the literal sentences, never read from the catalog. */
const CLEAR_COPY = {
  en: {
    button: "Clear sample",
    chip: "Sample site",
    chipAfter: "Sample data",
    title: "Clear the sample data?",
    body: "This clears the site's GSC rows, keyword seeds, keyword library, saved artifacts and site profile in this browser, along with every result already there (audit, visibility, knowledge base, competitor data, answer plans and link targets), including anything you added after loading the sample.",
    cancel: "Cancel",
    confirm: "Clear sample",
  },
  "zh-CN": {
    button: "清除示例",
    chip: "示例站点",
    chipAfter: "示例数据",
    title: "清除示例数据？",
    body: "会清掉这个站点在本浏览器里的 GSC 行、关键词种子与词库、产物筐与站点档案，以及所有已有的运行结果（审计、可见度、知识库、竞品数据、答案页方案与外链目标），包括载入示例之后你自己加的内容。",
    cancel: "取消",
    confirm: "清除示例",
  },
} as const;

/**
 * Claims the confirm body must never make, whatever the wording. The clear is
 * local to this site in this browser (no server, account, other sites or other
 * browsers); it takes the operator's own additions too, so it is never "only the
 * sample"; nothing brings it back; and the project itself stays. Promises only —
 * "cannot be undone" would be true, so the negative form is not listed.
 */
const FALSE_CLAIMS = {
  en: [
    /\bonly (?:the )?sample|\bsample (?:data )?only/iu,
    /\b(?:can|could|may) (?:still )?(?:be )?(?:undone|restored|recovered|retrieved)|\b(?:undo|restore|recover) (?:it|this|them)\b/iu,
    /\bserver|\baccount|\bworkspace|\bother browsers|\bevery (?:site|project|browser)|\ball (?:your |the )?(?:sites|projects|browsers)/iu,
    /\breal project|\bdeletes? (?:the|this|your) (?:project|site)\b/iu,
  ],
  "zh-CN": [
    /(?:只|仅)(?:会)?(?:清除|清掉|删除)?示例/u,
    /(?:可以|可|能|能够)(?:再)?(?:撤销|恢复|找回|还原)/u,
    /服务器|服务端|账号|账户|工作区|其他浏览器|所有浏览器|所有站点|全部站点|所有项目/u,
    /真实项目|删除(?:这个|该)?(?:项目|站点)/u,
  ],
} as const;

function topbar(container: ParentNode): HTMLElement {
  const found = container.querySelector<HTMLElement>("[data-app-shell-topbar]");
  if (!found) throw new Error("no topbar rendered");
  return found;
}

/**
 * The clear-sample control by its visible name, scoped to the topbar: the
 * confirm button inside the box carries the same words.
 */
function clearButton(header: HTMLElement, label: string = CLEAR_COPY.en.button): HTMLButtonElement | null {
  return [...header.querySelectorAll("button")].find((node) => node.textContent === label) ?? null;
}

function requireClearButton(header: HTMLElement, label: string = CLEAR_COPY.en.button): HTMLButtonElement {
  const found = clearButton(header, label);
  if (!found) throw new Error(`the topbar renders no "${label}" control`);
  return found;
}

function openBox(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function requireBox(): HTMLElement {
  const found = openBox();
  if (!found) throw new Error("no confirm box is open");
  return found;
}

function boxButton(box: HTMLElement, label: string): HTMLButtonElement {
  const found = [...box.querySelectorAll("button")].find((node) => node.textContent === label);
  if (!found) throw new Error(`the confirm box has no "${label}" button`);
  return found;
}

function sampleChip(header: HTMLElement, locale: keyof typeof CLEAR_COPY): HTMLElement | null {
  const title = locale === "en" ? en.workbench.shell.sampleTitle : zhCN.workbench.shell.sampleTitle;
  return header.querySelector<HTMLElement>(`span[title="${title}"]`);
}

function press(button: HTMLButtonElement): void {
  act(() => button.click());
}

/** A write by another tab: the bytes land in storage, then the event arrives. */
function anotherTabWrites(bytes: string): void {
  window.localStorage.setItem(storageKey(PROJECT_ID), bytes);
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: storageKey(PROJECT_ID),
        newValue: bytes,
        storageArea: window.localStorage,
      }),
    );
  });
}

/** Opens the confirm box on a project holding the sample and returns the pieces. */
function askToClear(locale: keyof typeof CLEAR_COPY = "en") {
  window.localStorage.setItem(storageKey(PROJECT_ID), projectBytes(true));
  const container = render(locale);
  const header = topbar(container);
  const button = requireClearButton(header, CLEAR_COPY[locale].button);
  // Closed until asked: a box open on the first frame would also dodge the
  // portal-target check below (see Harness).
  expect(openBox()).toBeNull();
  press(button);
  return { container, header, button, box: requireBox() };
}

beforeEach(() => {
  window.localStorage.clear();
  store.current = null;
  mocks.dispatched.splice(0);
  mocks.hasUnsavedContextChanges.mockReset();
  mocks.hasUnsavedContextChanges.mockReturnValue(false);
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.restoreAllMocks();
  Reflect.deleteProperty(window.navigator, "platform");
});

/**
 * jsdom reports `navigator.platform` as "" and ships no `userAgentData`, so the
 * topbar would otherwise always render the non-Mac spelling. The own property is
 * deleted in `afterEach`, which puts the prototype's answer back.
 */
function fakePlatform(platform: string): void {
  Object.defineProperty(window.navigator, "platform", {
    value: platform,
    configurable: true,
  });
}

function shortcutKbd(scope: ParentNode): HTMLElement {
  const found = scope.querySelector<HTMLElement>("kbd");
  if (!found) throw new Error("the topbar renders no shortcut hint");
  return found;
}

describe("Topbar", () => {
  // The palette opener says which chord opens it, and on a PC "⌘K" is a
  // chord that does not exist. Pinned at both spellings and in both locales:
  // the key names are not translated, and a locale that hardcoded one would
  // only show up here.
  it("spells the palette shortcut ⌘K for a Mac reader", () => {
    fakePlatform("MacIntel");

    expect(shortcutKbd(render()).textContent).toBe("⌘K");
  });

  it("spells the palette shortcut Ctrl+K off a Mac", () => {
    fakePlatform("Win32");

    expect(shortcutKbd(render()).textContent).toBe("Ctrl+K");
  });

  it("leaves the key names alone in zh-CN", () => {
    fakePlatform("Win32");

    expect(shortcutKbd(render("zh-CN")).textContent).toBe("Ctrl+K");
  });

  it("cancels the new-site navigation when the Context leave-confirm is declined", () => {
    mocks.hasUnsavedContextChanges.mockReturnValue(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = render();

    expect(click(newSiteLink(container))).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("lets the new-site navigation through once the confirm is accepted", () => {
    mocks.hasUnsavedContextChanges.mockReturnValue(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const container = render();

    expect(click(newSiteLink(container))).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("never asks when the Context editor is clean", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = render();

    expect(click(newSiteLink(container))).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("keeps exactly one live region, empty while storage is healthy", () => {
    // The shell e2e locates it as `[data-app-shell-topbar] [role="status"]`; a
    // second status element would make that locator ambiguous, and a live region
    // added only once it has something to say is announced by nobody.
    const container = render();
    const statuses = container.querySelectorAll('[role="status"]');

    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toBe("");
    expect(compactNotice(container)).toBeNull();
  });

  it("says results will not be saved, in that one live region, when storage holds a newer build's data", () => {
    window.localStorage.setItem(storageKey(PROJECT_ID), newerBuildBytes());
    const container = render();
    const statuses = container.querySelectorAll('[role="status"]');

    // The literal sentence, not "something rendered": next-intl renders a
    // missing key as its path instead of throwing.
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toBe(
      "This browser holds data saved by a newer version. Results from this session will not be saved",
    );
  });

  it("stays silent after a sweep", () => {
    const container = render();
    act(() => window.dispatchEvent(new Event(WORKBENCH_SWEPT_EVENT)));
    const statuses = container.querySelectorAll('[role="status"]');

    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toBe("");
    expect(compactNotice(container)).toBeNull();
  });

  describe("visible notice below lg, where the sentence is screen-reader only", () => {
    it("shows it in read-only mode, in both languages", () => {
      window.localStorage.setItem(storageKey(PROJECT_ID), newerBuildBytes());
      const container = render();
      expect(store.current?.storageMode).toBe("readonly");
      expectCompactNotice(container, "Not saved");
      cleanup?.();

      window.localStorage.setItem(storageKey(PROJECT_ID), newerBuildBytes());
      expectCompactNotice(render("zh-CN"), "未保存");
    });

    it("shows it when storage is unavailable (volatile)", () => {
      const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
      Object.defineProperty(window, "localStorage", {
        get() { throw new Error("denied"); },
        configurable: true,
      });
      try {
        const container = render();
        expect(store.current?.storageMode).toBe("volatile");
        expect(statusText(container)).toBe("Results will not be saved in this browser");
        expectCompactNotice(container, "Not saved");
      } finally {
        if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
        else Reflect.deleteProperty(window, "localStorage");
      }
    });

    it("shows it once a write hits the storage quota", () => {
      const container = render();
      expect(compactNotice(container)).toBeNull();
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });

      act(() => store.current?.dispatch({ type: "setSeeds", seeds: "does not fit" }));

      expect(store.current?.storageMode).toBe("quota");
      expect(statusText(container)).toBe("Browser storage is full; new results are not being saved");
      expectCompactNotice(container, "Not saved");
    });
  });

  describe("clear sample", () => {
    it("is not offered while the project holds the operator's own data", () => {
      window.localStorage.setItem(storageKey(PROJECT_ID), projectBytes(false));
      const header = topbar(render());

      // Hydrated, and not the sample: the absence below is an answer, not a
      // render that has not read storage yet.
      expect(store.current?.ready).toBe(true);
      expect(store.current?.state.demo).toBe(false);
      expect(store.current?.state.artifacts).toHaveLength(1);
      expect(clearButton(header)).toBeNull();
    });

    it("sits right after the sample chip once the sample is loaded, in both languages", () => {
      window.localStorage.setItem(storageKey(PROJECT_ID), projectBytes(true));
      const button = requireClearButton(topbar(render()));
      expect(button.type).toBe("button");
      expect(button.previousElementSibling).toBe(sampleChip(topbar(document), "en"));
      expect(button.previousElementSibling?.textContent).toBe(CLEAR_COPY.en.chip);
      cleanup?.();

      window.localStorage.setItem(storageKey(PROJECT_ID), projectBytes(true));
      const header = topbar(render("zh-CN"));
      const zhButton = requireClearButton(header, CLEAR_COPY["zh-CN"].button);
      expect(zhButton.previousElementSibling).toBe(sampleChip(header, "zh-CN"));
      expect(zhButton.previousElementSibling?.textContent).toBe(CLEAR_COPY["zh-CN"].chip);
    });

    it("sizes itself explicitly: 44x44 below md, where it is a touch target", () => {
      // jsdom has no layout, so this can only pin the classes that decide the
      // box; the box itself is measured in the mock e2e (plan T17 Step 1). The
      // size is the button's own, not padding round a 12px label, and
      // `shrink-0` keeps the tight 390px row from squeezing it — the menu
      // button next door was measured at 0x44 for want of exactly that.
      window.localStorage.setItem(storageKey(PROJECT_ID), projectBytes(true));
      const button = requireClearButton(topbar(render()));

      for (const utility of ["h-11", "w-11", "shrink-0", "md:h-[26px]", "md:w-auto"]) {
        expect(button.classList.contains(utility), utility).toBe(true);
      }
    });

    it("asks first, from a box portalled out of #wb-app and out of the topbar, and changes nothing yet", () => {
      const { header, box } = askToClear();
      const layoutRoot = document.getElementById(WB_ROOT_ID);
      const appRoot = document.getElementById(WB_APP_ROOT_ID);
      // Dialog's outermost element is the dialog panel's parent; the portal
      // inserted *that*, so its parent is where the box landed. A "somewhere
      // under #wb-root" check would hold without the portal too: the topbar
      // itself is under #wb-root.
      const inserted = box.parentElement;

      expect(inserted?.parentElement).toBe(layoutRoot);
      // The danger is real here, not hypothetical: the app root is inert.
      expect(appRoot?.hasAttribute("inert")).toBe(true);
      expect(appRoot?.contains(box)).toBe(false);
      expect(header.contains(box)).toBe(false);
      expect(box.closest("[inert]")).toBeNull();
      expect(mocks.dispatched).toEqual([]);
      expect(store.current?.state.demo).toBe(true);
    });

    for (const locale of ["en", "zh-CN"] as const) {
      it(`says what goes, as the whole sentence, in ${locale}`, () => {
        const { box } = askToClear(locale);
        const copy = CLEAR_COPY[locale];
        const titleId = box.getAttribute("aria-labelledby") ?? "";

        expect(document.getElementById(titleId)?.textContent).toBe(copy.title);
        // Whole sentences, never substrings: this one names four things (GSC
        // rows, keyword library, artifacts, site profile) plus the operator's
        // own additions, and a substring pin on any of them survives the others
        // being dropped.
        expect(box.querySelector("p")?.textContent).toBe(copy.body);
        expect([...box.querySelectorAll("button")].map((node) => node.textContent)).toEqual([
          copy.cancel,
          copy.confirm,
        ]);
      });

      it(`makes no false promise about what is cleared or kept, in ${locale}`, () => {
        const { box } = askToClear(locale);
        const body = box.querySelector("p")?.textContent ?? "";

        // Not vacuous: the sentence rendered, and it is not a key path.
        expect(body).toBe(CLEAR_COPY[locale].body);
        for (const claim of FALSE_CLAIMS[locale]) {
          expect(body, String(claim)).not.toMatch(claim);
        }
      });
    }

    it("clears exactly once on confirm, then hands focus to the next control in the row", () => {
      const { header } = askToClear();

      press(boxButton(requireBox(), CLEAR_COPY.en.confirm));

      expect(mocks.dispatched).toEqual([{ type: "clearDemo" }]);
      expect(store.current?.state.demo).toBe(false);
      expect(store.current?.state.artifacts).toEqual([]);
      expect(openBox()).toBeNull();
      expect(document.getElementById(WB_APP_ROOT_ID)?.hasAttribute("inert")).toBe(false);
      expect(clearButton(header)).toBeNull();
      expect(sampleChip(header, "en")?.textContent).toBe(CLEAR_COPY.en.chipAfter);
      // The button that asked is gone with the sample, so focus would otherwise
      // fall to <body>.
      expect(document.activeElement).toBe(header.querySelector("[data-wb-drawer-button]"));
    });

    it("keeps everything on cancel and returns focus to the control that asked", () => {
      const { header, button } = askToClear();

      press(boxButton(requireBox(), CLEAR_COPY.en.cancel));

      expect(openBox()).toBeNull();
      expect(mocks.dispatched).toEqual([]);
      expect(store.current?.state.demo).toBe(true);
      expect(store.current?.state.artifacts).toHaveLength(1);
      expect(clearButton(header)).toBe(button);
      expect(document.activeElement).toBe(button);
    });

    it("closes, and stays closed, when another tab swaps the sample for real data while it is open", () => {
      // The confirm would run `clearDemo` over whatever the project holds by
      // then; once that is the operator's own data it must not be one click away.
      const { header } = askToClear();

      anotherTabWrites(projectBytes(false));

      expect(store.current?.state.demo).toBe(false);
      expect(openBox()).toBeNull();
      expect(clearButton(header)).toBeNull();
      expect(mocks.dispatched).toEqual([]);
      expect(store.current?.state.artifacts).toHaveLength(1);

      // Nor does an old "asked" come back with the sample: nobody asked again.
      anotherTabWrites(projectBytes(true));

      expect(store.current?.state.demo).toBe(true);
      expect(openBox()).toBeNull();
      expect(mocks.dispatched).toEqual([]);
    });

    it("adds no second live region, with the control shown and the box open", () => {
      askToClear();

      expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    });
  });
});
