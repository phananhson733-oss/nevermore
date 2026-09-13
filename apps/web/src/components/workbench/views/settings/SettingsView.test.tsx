/** @vitest-environment jsdom */

/**
 * Settings is the one PR-1 page with a real action and no mock content, so its
 * page-level contract is what it must NOT show: no sample-data chip (nothing
 * here is sample), no legacy link and no "legacy page keeps working" sentence
 * (the legacy settings page was deleted). The delete block has its own
 * behavioural test; here it is a stub that records the project it was given.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";

const en = getMessages("en");

vi.mock("./DeleteProjectSection.tsx", () => ({
  DeleteProjectSection: ({ projectId }: { readonly projectId: string }) => (
    <section data-test-delete-section={projectId} />
  ),
}));

const { SettingsView } = await import("./SettingsView.tsx");

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";
const SHELL = en.workbench.shell;

let cleanup: (() => void) | null = null;

function render(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SettingsView projectId={PROJECT_ID} />
      </NextIntlClientProvider>,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("SettingsView", () => {
  it("titles the page and hands the delete block the current project", () => {
    const scope = render();

    expect(scope.querySelector("h1[data-wb-page-title]")?.textContent).toBe(en.workbench.nav.items.settings);
    expect(scope.querySelector("[data-test-delete-section]")?.getAttribute("data-test-delete-section")).toBe(
      PROJECT_ID,
    );
  });

  it("states the module is in progress without promising a legacy page", () => {
    const scope = render();

    expect(scope.textContent).toContain(SHELL.inProgressNoLegacy);
    expect(scope.textContent).not.toContain(SHELL.inProgressDetail);
    expect(scope.querySelector("a[data-wb-legacy-link]")).toBeNull();
  });

  it("carries no sample-data chip", () => {
    const scope = render();

    expect(scope.querySelector(`span[title="${SHELL.sampleTitle}"]`)).toBeNull();
    expect(scope.textContent).not.toContain(SHELL.sampleData);
    expect(scope.textContent).not.toContain(SHELL.sampleSite);
  });
});
