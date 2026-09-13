/** @vitest-environment jsdom */

/**
 * Step 3b: the sample site's artifacts must carry the operator's own wording of
 * the provenance declaration, not a second one.
 *
 * `mock/provenance.fs.test.ts` sweeps for the NAME `stampArtifact`, and
 * `mock/demo-artifacts.ts` is on its allowlist because it stamps with a line the
 * caller injects (`DemoDeps.provenanceLine`). The loader is that caller, so any
 * string it injects passes the sweep. The only thing that can tell a second
 * wording from the first is behaviour across the seam: for every sample
 * artifact, stamp an artifact of the same type at the same minute through
 * `useAddArtifact` and compare the declarations byte for byte.
 *
 * Nothing here is mocked: the real provider, the real `mock/demo.ts` behind the
 * loader's dynamic import, and the real message catalogue in both locales.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseLocalStamp } from "@/lib/workbench/mock/time";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import type { ProjectSeed } from "@/lib/workbench/store/reducer";
import {
  WorkbenchProvider,
  type WorkbenchContextValue,
} from "@/lib/workbench/store/WorkbenchProvider";
import type { ArtifactType } from "@/lib/workbench/types";
import {
  useAddArtifact,
  type ArtifactDraft,
  type PreparedArtifact,
} from "../../hooks/useAddArtifact.ts";
import { LoadDemoButton } from "./LoadDemoButton.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const PID = "00000000-0000-4000-8000-000000000042";
const SEED: ProjectSeed = {
  url: "https://example.test",
  brand: "Example",
  market: "US",
};
type Locale = "en" | "zh-CN";

interface Holder {
  prepare: ((draft: ArtifactDraft) => PreparedArtifact) | null;
  store: WorkbenchContextValue | null;
}

function Probe({ holder }: { readonly holder: Holder }) {
  holder.prepare = useAddArtifact();
  holder.store = useWorkbench();
  return null;
}

let cleanup: (() => void) | null = null;

function mount(locale: Locale): {
  readonly scope: HTMLElement;
  readonly holder: Holder;
} {
  const holder: Holder = { prepare: null, store: null };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider
        locale={locale}
        messages={getMessages(locale)}
        timeZone="UTC"
      >
        <WorkbenchProvider projectId={PID} seed={SEED}>
          <Probe holder={holder} />
          <LoadDemoButton />
        </WorkbenchProvider>
      </NextIntlClientProvider>,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { scope: container, holder };
}

/** The declaration part of a stamped text, by the shape `stampArtifact` gives each type. */
function declaration(type: ArtifactType, content: string): string {
  if (type === "json") {
    const parsed = JSON.parse(content) as { readonly _sampleData?: unknown };
    return typeof parsed._sampleData === "string" ? parsed._sampleData : "";
  }
  const lines = content.split("\n");
  return type === "csv" ? lines.slice(0, 2).join("\n") : (lines[0] ?? "");
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup?.();
  cleanup = null;
});

describe.each(["en", "zh-CN"] as const)(
  "sample artifacts carry the operator's declaration (%s)",
  (locale) => {
    it("stamps every sample artifact with the line useAddArtifact writes for the same type and minute", async () => {
      const { scope, holder } = mount(locale);
      const button = scope.querySelector("button");
      if (!button) throw new Error("no loader button");

      act(() => button.click());
      // Polled OUTSIDE act: updates queued inside an async act are flushed only
      // when it returns, so a waitFor inside one never sees the re-render.
      for (
        let tick = 0;
        tick < 200 && holder.store?.state.demo !== true;
        tick += 1
      ) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
        });
      }
      expect(holder.store?.state.demo).toBe(true);

      const artifacts = holder.store?.state.artifacts ?? [];
      // Positive controls: there is something to compare, and both declaration
      // shapes that differ (a csv's two header lines, a prompt's first line) occur.
      expect(artifacts.length).toBeGreaterThan(0);
      const types = new Set(artifacts.map((artifact) => artifact.type));
      expect(types.has("csv")).toBe(true);
      expect(types.has("prompt") || types.has("md")).toBe(true);

      vi.useFakeTimers({ toFake: ["Date"] });
      for (const artifact of artifacts) {
        const at = parseLocalStamp(artifact.at);
        if (at === null) throw new Error(`unparseable stamp ${artifact.at}`);
        vi.setSystemTime(at);
        const prepare = holder.prepare;
        if (prepare === null) throw new Error("useAddArtifact is not ready");
        const prepared = prepare({
          module: artifact.module,
          type: artifact.type,
          engine: artifact.engine,
          title: artifact.title,
          body: artifact.type === "json" ? "{}" : "body",
        });

        // Same minute, or the comparison below would be between two stamps.
        expect(prepared.artifact.at, artifact.id).toBe(artifact.at);
        const expected = declaration(artifact.type, prepared.content);
        expect(expected, artifact.id).not.toBe("");
        expect(expected, artifact.id).not.toContain("workbench.");
        expect(declaration(artifact.type, artifact.content), artifact.id).toBe(
          expected,
        );
      }
    });
  },
);
