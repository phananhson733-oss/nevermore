/** @vitest-environment jsdom */

/**
 * The placeholder makes one promise per page and it must be the right one: on
 * a page with a legacy counterpart it says "the legacy page keeps working" and
 * links to it; on a page without one it must not promise that, because there
 * is nothing to link to. Driven over the whole route table so a new page id
 * cannot land with the wrong sentence.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { LEGACY_LINKS, WORKBENCH_PAGE_IDS, type WorkbenchPageId } from "@/lib/workbench/routes";
import { PlaceholderView } from "./PlaceholderView.tsx";

const en = getMessages("en");

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";
const SHELL = en.workbench.shell;

let cleanup: (() => void) | null = null;

function render(page: WorkbenchPageId): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <PlaceholderView projectId={PROJECT_ID} page={page} />
      </NextIntlClientProvider>,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

function legacyLinks(scope: ParentNode): readonly HTMLAnchorElement[] {
  return [...scope.querySelectorAll<HTMLAnchorElement>("a[data-wb-legacy-link]")];
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

const WITH_LEGACY = WORKBENCH_PAGE_IDS.filter((page) => LEGACY_LINKS[page].length > 0);
const WITHOUT_LEGACY = WORKBENCH_PAGE_IDS.filter((page) => LEGACY_LINKS[page].length === 0);

describe("PlaceholderView", () => {
  it("has pages of both kinds to drive", () => {
    expect(WITH_LEGACY.length).toBeGreaterThan(0);
    expect(WITHOUT_LEGACY.length).toBeGreaterThan(0);
  });

  it.each(WITH_LEGACY)("%s: promises the legacy page keeps working and links to it", (page) => {
    const scope = render(page);

    expect(scope.querySelector("h1[data-wb-page-title]")?.textContent).toBe(en.workbench.nav.items[page]);
    expect(scope.textContent).toContain(SHELL.inProgress);
    expect(scope.textContent).toContain(SHELL.inProgressDetail);
    expect(legacyLinks(scope).map((a) => a.getAttribute("href"))).toEqual(
      LEGACY_LINKS[page].map((segment) => `/p/${PROJECT_ID}/${segment}`),
    );
  });

  it.each(WITHOUT_LEGACY)("%s: makes no legacy promise and renders no legacy link", (page) => {
    const scope = render(page);

    expect(scope.querySelector("h1[data-wb-page-title]")?.textContent).toBe(en.workbench.nav.items[page]);
    expect(scope.textContent).toContain(SHELL.inProgressNoLegacy);
    expect(scope.textContent).not.toContain(SHELL.inProgressDetail);
    expect(legacyLinks(scope)).toHaveLength(0);
  });

  it("marks the page as sample data in the title row", () => {
    const scope = render("content");
    const chip = scope.querySelector(`span[title="${SHELL.sampleTitle}"]`);

    expect(chip?.textContent).toBe(SHELL.sampleData);
    // In the title row (the h1's own row), not somewhere down the page.
    const titleRow = scope.querySelector("h1[data-wb-page-title]")?.parentElement;
    expect(chip !== null && titleRow?.contains(chip)).toBe(true);
  });
});
