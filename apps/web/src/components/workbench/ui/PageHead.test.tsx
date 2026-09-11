/** @vitest-environment jsdom */

/**
 * The page-header contract every workbench view relies on: exactly one
 * `<h1 data-wb-page-title>` (the e2e and the skip link locate it), an aside
 * slot that only exists when something is put in it, and a subtitle that is
 * not rendered as an empty paragraph.
 */

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PageHead } from "./PageHead.tsx";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | null = null;

function render(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
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

describe("PageHead", () => {
  it("renders the title as the page's single h1", () => {
    const scope = render(<PageHead title="Keyword library" />);
    const headings = scope.querySelectorAll("h1");

    expect(headings).toHaveLength(1);
    expect(headings[0]?.hasAttribute("data-wb-page-title")).toBe(true);
    expect(headings[0]?.textContent).toBe("Keyword library");
    // The legacy global rule keyed on this attribute forces 32-48px; the
    // workbench title is 24px, so it must not be present.
    expect(scope.querySelector("[data-app-page-title]")).toBeNull();
  });

  it("renders the aside next to the title only when one is given", () => {
    const scope = render(<PageHead title="T" aside={<button type="button">Act</button>} />);
    const h1 = scope.querySelector("h1");
    const aside = scope.querySelector("button");

    expect(aside?.textContent).toBe("Act");
    // Same row as the title, not a sibling of the header block.
    expect(aside?.parentElement?.parentElement).toBe(h1?.parentElement);
    cleanup?.();

    const bare = render(<PageHead title="T" />);
    expect(bare.querySelector("h1")?.parentElement?.childElementCount).toBe(1);
  });

  it("renders the subtitle under the title row only when one is given", () => {
    const scope = render(<PageHead title="T" subtitle="What this page is for" />);
    expect(scope.querySelector("p")?.textContent).toBe("What this page is for");
    cleanup?.();

    const bare = render(<PageHead title="T" subtitle={undefined} />);
    expect(bare.querySelector("p")).toBeNull();
  });
});
