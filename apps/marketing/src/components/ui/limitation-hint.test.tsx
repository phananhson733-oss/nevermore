// @input  — the public-tool LimitationHint disclosure primitive
// @output — regression coverage for default density, keyboard, touch, and placement
// @pos    — unit guard for compact limitation disclosures on the marketing site
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  LimitationHint,
  marketingLimitationPopoverPosition,
} from "./limitation-hint.tsx";

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

describe("marketing LimitationHint", () => {
  it("keeps copy out of the control while preserving it for print", () => {
    const limitation = "A long evidence boundary available only on demand.";
    const markup = renderToStaticMarkup(
      <LimitationHint label="限制说明" limitations={[limitation]} />,
    );

    expect(markup).toContain('data-limitation-hint=""');
    expect(markup).toContain('aria-label="限制说明 (1)"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('data-print-limitations="限制说明:');
    expect(markup).toContain(limitation);
  });

  it("deduplicates boundaries, ignores blanks, and renders nothing when empty", () => {
    const markup = renderToStaticMarkup(
      <LimitationHint
        label="Limitations"
        limitations={["Bounded rows.", "", " Bounded rows. "]}
      />,
    );
    expect(markup).toContain('data-limitation-count="1"');
    expect(
      renderToStaticMarkup(<LimitationHint label="Limitations" limitations={[]} />),
    ).toBe("");
  });

  it("reveals full copy on focus and closes with Escape", () => {
    const limitation = "Only the selected property was observed.";
    const view = clientRender(
      <LimitationHint
        label="限制说明"
        limitations={[limitation]}
        contentLanguage="en"
      />,
    );
    const trigger = view.container.querySelector("button");
    act(() => trigger?.focus());

    const tooltip = document.body.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toContain(limitation);
    expect(tooltip?.querySelector("li")?.getAttribute("lang")).toBe("en");
    expect(trigger?.getAttribute("aria-describedby")).toBe(tooltip?.id);

    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    view.cleanup();
  });

  it("pins on click for touch-sized interactions and closes outside", () => {
    const limitation = "A boundary that remains readable after tapping.";
    const view = clientRender(
      <LimitationHint label="Limitations" limitations={[limitation]} />,
    );
    const trigger = view.container.querySelector("button");
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

  it("moves keyboard focus into a long scrollable disclosure with ArrowDown", () => {
    const limitation = "A long boundary ".repeat(80);
    const view = clientRender(
      <LimitationHint label="Limitations" limitations={[limitation]} />,
    );
    const trigger = view.container.querySelector("button");
    act(() => trigger?.focus());
    const tooltip = document.body.querySelector<HTMLElement>('[role="tooltip"]');

    act(() =>
      trigger?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );

    expect(tooltip?.tabIndex).toBe(0);
    expect(document.activeElement).toBe(tooltip);
    view.cleanup();
  });

  it("does not reopen when Escape returns focus after hover", () => {
    const limitation = "A hovered boundary must stay closed after Escape.";
    const view = clientRender(
      <LimitationHint label="Limitations" limitations={[limitation]} />,
    );
    const trigger = view.container.querySelector("button");

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

  it("consumes Escape before an ancestor overlay can close", () => {
    let ancestorEscapeCount = 0;
    const onAncestorKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") ancestorEscapeCount += 1;
    };
    document.addEventListener("keydown", onAncestorKeyDown);
    const view = clientRender(
      <LimitationHint label="Limitations" limitations={["Nested boundary."]} />,
    );
    const trigger = view.container.querySelector("button");
    act(() => trigger?.focus());

    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );

    expect(ancestorEscapeCount).toBe(0);
    document.removeEventListener("keydown", onAncestorKeyDown);
    view.cleanup();
  });
});

describe("marketingLimitationPopoverPosition", () => {
  it("places below when possible and flips above near the viewport floor", () => {
    expect(
      marketingLimitationPopoverPosition({
        trigger: { top: 40, right: 68, bottom: 68, left: 40 },
        popoverWidth: 320,
        popoverHeight: 180,
        viewportWidth: 1024,
        viewportHeight: 768,
        align: "start",
      }),
    ).toEqual({ top: 76, left: 40, side: "bottom" });
    expect(
      marketingLimitationPopoverPosition({
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
