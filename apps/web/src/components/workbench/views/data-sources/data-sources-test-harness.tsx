/**
 * Test-only: shared setup for the data-sources suites. Not a `*.test.tsx` file,
 * so several suites can import it; it imports nothing from vitest.
 *
 * - `mountWithStore` renders inside a real `WorkbenchProvider` (the import pane,
 *   the clear confirmation and the view all write to it) and inside the two
 *   shell roots `ConfirmDialog` and `Dialog` look up: `#wb-root` is the portal
 *   target and `#wb-app` is what the dialog makes inert, so a confirmation that
 *   landed inside the inert subtree would show here.
 * - `mountPlain` renders with intl and a QueryClient only (the table, the panel).
 * - The response builders are the four members of `Response` the api client
 *   reads, so a stubbed `fetch` drives the real `useProjectSources` and the real
 *   `ApiError` (the rail site card's test does the same).
 */
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getMessages } from "@sf/i18n";
import type { DataSnapshot, SourceConnection, SourceState } from "@/lib/api/hooks-sources";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import type { ProjectSeed } from "@/lib/workbench/store/reducer";
import {
  WorkbenchProvider,
  type PublicWorkbenchAction,
  type WorkbenchContextValue,
} from "@/lib/workbench/store/WorkbenchProvider";
import type { GscRow } from "@/lib/workbench/types";
import { WB_APP_ROOT_ID, WB_ROOT_ID } from "../../ui/ids.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type DsLocale = "en" | "zh-CN";

export const DS_MESSAGES = { en: getMessages("en"), "zh-CN": getMessages("zh-CN") } as const;

export const DS_PROJECT_ID = "00000000-0000-4000-8000-000000000042";

export const DS_SEED: ProjectSeed = { url: "https://example.test", brand: "Example", market: "US" };

export const HAN = /\p{Script=Han}/u;

export function gscRow(
  query: string,
  clicks: number | null,
  impressions: number | null,
  ctr: number | null,
  position: number | null,
): GscRow {
  return { query, clicks, impressions, ctr, position };
}

interface Holder {
  current: WorkbenchContextValue | null;
}

function Probe({ holder }: { readonly holder: Holder }) {
  holder.current = useWorkbench();
  return null;
}

function queryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

export interface MountedStore {
  /** `#wb-root`: the portal target, outside the inert `#wb-app`. */
  readonly root: HTMLElement;
  /** `#wb-app`: the React container. */
  readonly app: HTMLElement;
  readonly store: () => WorkbenchContextValue;
  readonly dispatch: (action: PublicWorkbenchAction) => void;
  readonly unmount: () => void;
}

export function mountWithStore(ui: ReactNode, locale: DsLocale = "en"): MountedStore {
  const holder: Holder = { current: null };
  const shell = document.createElement("div");
  shell.id = WB_ROOT_ID;
  const app = document.createElement("div");
  app.id = WB_APP_ROOT_ID;
  shell.append(app);
  document.body.append(shell);
  const root = createRoot(app);
  act(() =>
    root.render(
      <NextIntlClientProvider locale={locale} messages={DS_MESSAGES[locale]} timeZone="UTC">
        <QueryClientProvider client={queryClient()}>
          <WorkbenchProvider projectId={DS_PROJECT_ID} seed={DS_SEED}>
            <Probe holder={holder} />
            {ui}
          </WorkbenchProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    ),
  );
  const store = (): WorkbenchContextValue => {
    if (holder.current === null) throw new Error("provider never rendered");
    return holder.current;
  };
  return {
    root: shell,
    app,
    store,
    dispatch: (action) => act(() => store().dispatch(action)),
    unmount: () => {
      act(() => root.unmount());
      shell.remove();
    },
  };
}

export interface MountedPlain {
  readonly container: HTMLElement;
  readonly unmount: () => void;
}

export function mountPlain(ui: ReactNode, locale: DsLocale = "en"): MountedPlain {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale={locale} messages={DS_MESSAGES[locale]} timeZone="UTC">
        <QueryClientProvider client={queryClient()}>{ui}</QueryClientProvider>
      </NextIntlClientProvider>,
    ),
  );
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Lets fetch promises, query state and the renders they trigger settle. */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 10; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

export function response(status: number, contentType: string, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

export function sourcesOk(sources: readonly SourceConnection[]): Response {
  return response(200, "application/json", JSON.stringify({ data: sources }));
}

/** A real problem+json body, so a real `ApiError` with this `code` is thrown. */
export function sourcesProblem(status: number, code: string): Response {
  return response(
    status,
    "application/problem+json",
    JSON.stringify({ type: "about:blank", title: "Request failed", status, code, detail: "Request failed.", requestId: "req-test" }),
  );
}

export function snapshot(overrides: Partial<DataSnapshot> = {}): DataSnapshot {
  return {
    id: "snap-1",
    siteId: "site-1",
    provider: "gsc",
    datasetKey: "gsc.search_analytics",
    schemaVersion: "1",
    methodVersion: "1",
    capturedAt: new Date(2026, 8, 10, 8, 30).toISOString(),
    sourceWindow: { start: "2026-08-10", end: "2026-09-09" } as DataSnapshot["sourceWindow"],
    availability: "available",
    limitation: "Sampled query data.",
    rowCount: 1234,
    checksum: "abc",
    ...overrides,
  };
}

export function sourceSlot(
  provider: SourceConnection["provider"],
  state: SourceState,
  overrides: Partial<SourceConnection> = {},
): SourceConnection {
  return {
    id: `conn-${provider}`,
    projectId: DS_PROJECT_ID,
    provider,
    connectionType: "oauth",
    state,
    externalRef: null,
    scopes: [],
    connectedAt: null,
    latestSnapshot: null,
    latestMetricSummary: null,
    activeRun: null,
    limitation: "",
    featureEnabled: true,
    updatedAt: "2026-09-13T00:00:00.000Z",
    ...overrides,
  };
}

export function buttonByText(scope: ParentNode, text: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find((button) => button.textContent === text);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no button "${text}"`);
  return found;
}

/** Sets a controlled textarea's value the way typing does, so React sees the change. */
export function typeInto(field: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export function pickFile(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
