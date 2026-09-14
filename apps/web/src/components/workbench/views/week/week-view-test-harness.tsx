/**
 * Test-only: the week page rendered against a store stuck at one state, for the
 * week view suites that do not fit in `WeekView.test.tsx` (which keeps its own
 * copy of this setup). Not a `*.test.tsx` file so several suites can share it.
 * The caller fakes `Date` (the view reads the clock through `useNowStamp`) and
 * unmounts what it rendered.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { initialProjectState, type ProjectSeed } from "@/lib/workbench/store/reducer";
import { populatedProjectState } from "@/lib/workbench/store/test-fixtures";
import type {
  PublicWorkbenchAction,
  WorkbenchContextValue,
} from "@/lib/workbench/store/WorkbenchProvider";
import { WorkbenchContext } from "@/lib/workbench/store/WorkbenchProvider";
import type {
  Artifact,
  AuditReport,
  Finding,
  GscRow,
  VisResult,
  WorkbenchProjectState,
} from "@/lib/workbench/types";
import { WeekView } from "./WeekView.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export type WeekLocale = "en" | "zh-CN";

export const WEEK_PROJECT_ID = "00000000-0000-4000-8000-000000000042";

const SEED: ProjectSeed = { url: "https://example.test", brand: "Example", market: "US" };
const POPULATED = populatedProjectState(SEED);

export const BLANK_WEEK: WorkbenchProjectState = initialProjectState(SEED);

export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("fixture is missing a value");
  return value;
}

export function finding(t: string, sev: Finding["sev"]): Finding {
  return { ...must(POPULATED.lastAudit?.findings[0]), id: t, t, sev };
}

/** The populated fixture's report, so every report here lists the same checked pages. */
export function report(at: string, score: number, findings: readonly Finding[]): AuditReport {
  return { ...must(POPULATED.lastAudit), at, score, findings };
}

export function result(p: string, platform: string, hit: boolean): VisResult {
  return { ...must(POPULATED.lastVis?.results[0]), p, platform, hit };
}

/** `total` prompts on one platform, the first `count` of them hits. */
export function hits(count: number, total: number): readonly VisResult[] {
  return Array.from({ length: total }, (_, i) => result(`prompt ${i}`, "ChatGPT", i < count));
}

export function gsc(query: string, position: number | null): GscRow {
  return { query, clicks: 3, impressions: 90, ctr: 0.03, position };
}

export function artifact(id: string, at: string, overrides: Partial<Artifact> = {}): Artifact {
  return { ...must(POPULATED.artifacts[0]), id, at, ...overrides };
}

export interface RenderedWeek {
  readonly container: HTMLElement;
  readonly rerender: (state: WorkbenchProjectState) => void;
  readonly unmount: () => void;
}

function context(
  state: WorkbenchProjectState,
  dispatch: (action: PublicWorkbenchAction) => void,
): WorkbenchContextValue {
  return {
    projectId: WEEK_PROJECT_ID,
    state,
    dispatch,
    ready: true,
    storageMode: "ok",
    keywordRows: [],
    keywordRowCount: null,
    forgetProject: () => {},
  };
}

export function renderWeek(
  state: WorkbenchProjectState,
  options: {
    readonly locale?: WeekLocale;
    readonly dispatch?: (action: PublicWorkbenchAction) => void;
  } = {},
): RenderedWeek {
  const locale = options.locale ?? "en";
  const dispatch = options.dispatch ?? (() => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const tree = (current: WorkbenchProjectState) => (
    <NextIntlClientProvider locale={locale} messages={getMessages(locale)} timeZone="UTC">
      <WorkbenchContext.Provider value={context(current, dispatch)}>
        <WeekView />
      </WorkbenchContext.Provider>
    </NextIntlClientProvider>
  );
  act(() => root.render(tree(state)));
  return {
    container,
    rerender: (next) => act(() => root.render(tree(next))),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export function one(scope: ParentNode, selector: string): Element {
  return must(scope.querySelector(selector));
}

export function text(scope: ParentNode, selector: string): string {
  return one(scope, selector).textContent ?? "";
}
