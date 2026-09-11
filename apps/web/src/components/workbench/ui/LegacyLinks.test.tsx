/** @vitest-environment jsdom */

/**
 * Rendered counterpart of `LegacyLinks.test.ts` (which pins the label-key map
 * against the catalogs without a DOM). What matters on screen: one link per
 * legacy destination, pointing at the legacy path and reading as a page name,
 * and nothing at all - not even the wrapper - when a page has no legacy
 * counterpart.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { LEGACY_LINKS, type LegacySegment } from "@/lib/workbench/routes";
import { LegacyLinks } from "./LegacyLinks.tsx";

const en = getMessages("en");

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";

let cleanup: (() => void) | null = null;

function render(segments: readonly LegacySegment[]): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <LegacyLinks projectId={PROJECT_ID} segments={segments} />
      </NextIntlClientProvider>,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

function links(scope: ParentNode): readonly HTMLAnchorElement[] {
  return [...scope.querySelectorAll<HTMLAnchorElement>("a[data-wb-legacy-link]")];
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("LegacyLinks", () => {
  it("renders one link per segment, in order, pointing at the legacy path", () => {
    const scope = render(LEGACY_LINKS.profile);
    const found = links(scope);

    expect(found.map((a) => a.getAttribute("data-wb-legacy-link"))).toEqual(["context", "setup-sources"]);
    expect(found.map((a) => a.getAttribute("href"))).toEqual([
      `/p/${PROJECT_ID}/context`,
      `/p/${PROJECT_ID}/setup-sources`,
    ]);
  });

  it("labels each link with the legacy page's nav name, not its path segment", () => {
    const scope = render(LEGACY_LINKS.profile);

    expect(links(scope).map((a) => a.textContent)).toEqual([
      `${en.workbench.shell.legacy} · ${en.nav.context} →`,
      `${en.workbench.shell.legacy} · ${en.nav.sourceSetup} →`,
    ]);
    expect(scope.textContent).not.toContain("setup-sources");
  });

  it("keeps the nested legacy overview path intact", () => {
    const scope = render(LEGACY_LINKS.overview);

    expect(links(scope).map((a) => a.getAttribute("href"))).toEqual([`/p/${PROJECT_ID}/legacy/overview`]);
  });

  it("renders nothing for a page without a legacy counterpart", () => {
    const scope = render(LEGACY_LINKS.week);

    expect(links(scope)).toHaveLength(0);
    expect(scope.childElementCount).toBe(0);
  });
});
