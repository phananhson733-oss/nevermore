/**
 * Test-only: the profile page rendered inside a real `NextIntlClientProvider`
 * and a `WorkbenchContext` the test controls. Not a `*.test.tsx` file so the
 * profile suites can share it (the `week-view-test-harness.tsx` pattern).
 *
 * Two stores:
 * - `stateful: false` (default) — the state never changes; every action is
 *   recorded on `actions` and nothing else happens, so a test reads exactly
 *   what the view dispatched.
 * - `stateful: true` — actions are recorded AND run through the real reducer,
 *   so a test can read what the page shows after its own dispatches (the old
 *   profile still on screen while a run is in flight, the new one after).
 *
 * The caller fakes the clock and timers it needs and unmounts what it rendered.
 */
import { act, useReducer, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { initialProjectState, reduce, type ProjectSeed } from "@/lib/workbench/store/reducer";
import type {
  PublicWorkbenchAction,
  WorkbenchContextValue,
} from "@/lib/workbench/store/WorkbenchProvider";
import { WorkbenchContext } from "@/lib/workbench/store/WorkbenchProvider";
import type { WorkbenchProjectState } from "@/lib/workbench/types";
import { ProfileView } from "./ProfileView.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export type ProfileLocale = "en" | "zh-CN";

export const PROFILE_PROJECT_ID = "00000000-0000-4000-8000-000000000077";
export const OTHER_PROJECT_ID = "00000000-0000-4000-8000-000000000078";

export const PROFILE_SEED: ProjectSeed = { url: "https://example.test", brand: "Example", market: "US" };
export const BLANK_PROFILE: WorkbenchProjectState = initialProjectState(PROFILE_SEED);

export const HAN = /\p{Script=Han}/u;

export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("fixture is missing a value");
  return value;
}

interface Frame {
  readonly state: WorkbenchProjectState;
  readonly ready: boolean;
  readonly projectId: string;
}

export interface RenderedProfile {
  readonly container: HTMLElement;
  /** Every action the view dispatched, in order. */
  readonly actions: () => readonly PublicWorkbenchAction[];
  /** New props for the fake store (ignored for `state` when stateful). */
  readonly rerender: (patch: Partial<Frame>) => void;
  readonly unmount: () => void;
}

function contextValue(frame: Frame, dispatch: (action: PublicWorkbenchAction) => void): WorkbenchContextValue {
  return {
    projectId: frame.projectId,
    state: frame.state,
    dispatch,
    ready: frame.ready,
    storageMode: "ok",
    keywordRows: [],
    keywordRowCount: null,
    forgetProject: () => {},
  };
}

function StatefulStore({
  frame,
  record,
  children,
}: {
  readonly frame: Frame;
  readonly record: (action: PublicWorkbenchAction) => void;
  readonly children: ReactNode;
}) {
  const [state, dispatch] = useReducer(reduce, frame.state);
  const send = (action: PublicWorkbenchAction): void => {
    record(action);
    dispatch(action);
  };
  return (
    <WorkbenchContext.Provider value={contextValue({ ...frame, state }, send)}>{children}</WorkbenchContext.Provider>
  );
}

export function renderProfile(
  state: WorkbenchProjectState,
  options: {
    readonly locale?: ProfileLocale;
    readonly ready?: boolean;
    readonly stateful?: boolean;
    readonly projectId?: string;
  } = {},
): RenderedProfile {
  const locale = options.locale ?? "en";
  let recorded: readonly PublicWorkbenchAction[] = [];
  const record = (action: PublicWorkbenchAction): void => {
    recorded = [...recorded, action];
  };
  let frame: Frame = { state, ready: options.ready ?? true, projectId: options.projectId ?? PROFILE_PROJECT_ID };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = (current: Frame) =>
    options.stateful === true ? (
      <StatefulStore frame={current} record={record}>
        <ProfileView />
      </StatefulStore>
    ) : (
      <WorkbenchContext.Provider value={contextValue(current, record)}>
        <ProfileView />
      </WorkbenchContext.Provider>
    );
  const tree = (current: Frame) => (
    <NextIntlClientProvider locale={locale} messages={getMessages(locale)} timeZone="UTC">
      {store(current)}
    </NextIntlClientProvider>
  );
  act(() => root.render(tree(frame)));
  return {
    container,
    actions: () => recorded,
    rerender: (patch) => {
      frame = { ...frame, ...patch };
      act(() => root.render(tree(frame)));
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export function one(scope: ParentNode, selector: string): Element {
  return must(scope.querySelector(selector));
}

export function button(scope: ParentNode, label: string): HTMLButtonElement {
  return must([...scope.querySelectorAll("button")].find((b) => b.textContent === label));
}

/** Sets a controlled input's value the way a keystroke does, so React sees the change. */
export function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export function inputLabelled(scope: ParentNode, label: string): HTMLInputElement {
  const found = [...scope.querySelectorAll("label")].find((l) => l.textContent === label);
  const id = must(found).htmlFor;
  return must(scope.querySelector<HTMLInputElement>(`[id="${id}"]`));
}
