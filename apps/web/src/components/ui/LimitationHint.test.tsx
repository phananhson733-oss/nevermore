/** @vitest-environment jsdom */

import { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LimitationHint,
  limitationPopoverPosition,
} from "./LimitationHint.tsx";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function clientRender(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return {
    container,
    cleanup() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("LimitationHint", () => {
  it("keeps long limitation copy out of the default reading line", () => {
    const limitation = "Canonical source boundary that should only appear on demand.";
    const html = renderToStaticMarkup(
      <LimitationHint label="限制说明" limitations={[limitation]} />,
    );

    expect(html).toContain('data-limitation-hint=""');
    expect(html).toContain('aria-label="限制说明 (1)"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain(limitation);
  });

  it("deduplicates canonical boundaries and ignores empty entries", () => {
    const html = renderToStaticMarkup(
      <LimitationHint
        label="Limitations"
        limitations={["Bounded provider rows.", "", " Bounded provider rows. "]}
      />,
    );

    expect(html).toContain('data-limitation-count="1"');
    expect(html).toContain('aria-label="Limitations (1)"');
  });

  it("renders nothing when there is no limitation", () => {
    expect(
      renderToStaticMarkup(<LimitationHint label="限制说明" limitations={[]} />),
    ).toBe("");
  });

  it("reveals complete canonical copy on keyboard focus and closes with Escape", () => {
    const limitation = "Provider rows are bounded to the selected property.";
    const view = clientRender(
      <LimitationHint
        label="限制说明"
        limitations={[limitation]}
        contentLanguage="en"
      />,
    );
    const trigger = view.container.querySelector("button");
    expect(trigger).not.toBeNull();
    expect(document.body.textContent).not.toContain(limitation);

    act(() => trigger?.focus());

    const tooltip = document.body.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toContain("限制说明");
    expect(tooltip?.textContent).toContain(limitation);
    expect(tooltip?.querySelector("li")?.getAttribute("lang")).toBe("en");
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(trigger?.getAttribute("aria-describedby")).toBe(tooltip?.id);

    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );

    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    view.cleanup();
  });

  it("pins on click for touch-sized interactions and closes outside", () => {
    const limitation = "A complete boundary that stays available on demand.";
    const view = clientRender(
      <LimitationHint label="Limitations" limitations={[limitation]} />,
    );
    const trigger = view.container.querySelector("button");
    expect(trigger).not.toBeNull();

    act(() => trigger?.click());
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain(
      limitation,
    );

    act(() =>
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    view.cleanup();
  });

  it("returns focus without reopening after Escape closes a hover disclosure", () => {
    const limitation = "A hovered boundary must stay closed after Escape.";
    const view = clientRender(
      <LimitationHint label="Limitations" limitations={[limitation]} />,
    );
    const trigger = view.container.querySelector("button");
    expect(trigger).not.toBeNull();

    act(() =>
      trigger?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    );
    expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();

    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );

    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    view.cleanup();
  });
});

describe("limitationPopoverPosition", () => {
  it("places the popover below the trigger when there is room", () => {
    expect(
      limitationPopoverPosition({
        trigger: { top: 40, right: 68, bottom: 68, left: 40 },
        popoverWidth: 320,
        popoverHeight: 180,
        viewportWidth: 1024,
        viewportHeight: 768,
        align: "start",
      }),
    ).toEqual({ top: 76, left: 40, side: "bottom" });
  });

  it("flips above and clamps horizontally near the viewport edge", () => {
    expect(
      limitationPopoverPosition({
        trigger: { top: 700, right: 1012, bottom: 728, left: 984 },
        popoverWidth: 380,
        popoverHeight: 240,
        viewportWidth: 1024,
        viewportHeight: 768,
        align: "end",
      }),
    ).toEqual({ top: 452, left: 632, side: "top" });
  });
});
