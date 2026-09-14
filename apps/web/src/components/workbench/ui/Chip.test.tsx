/** @vitest-environment jsdom */

/**
 * The chip exists to hold the tone→colour mapping in one place, so the tests
 * are about the mapping being complete and total: the tone list is pinned as a
 * literal (dropping a tone from the union has to be visible here), and every
 * tone in the list is then rendered and must come out with a background, a
 * border and a text colour of its own. Deleting one row of the mapping leaves
 * that tone with base classes only, which the loop catches.
 */

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Chip, CHIP_TONES, type ChipTone } from "./Chip.tsx";

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

function chipClasses(tone: ChipTone): string {
  const scope = render(<Chip tone={tone}>label</Chip>);
  const className = scope.querySelector("span")?.className ?? "";
  cleanup?.();
  cleanup = null;
  return className;
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("Chip", () => {
  it("offers exactly the five tones the workbench names", () => {
    expect([...CHIP_TONES]).toEqual(["neutral", "seo", "geo", "warn", "bad"]);
  });

  it("gives every tone its own fill, border and text colour", () => {
    for (const tone of CHIP_TONES) {
      const className = chipClasses(tone);
      expect(className, tone).toMatch(/(?:^|\s)bg-[a-z]+-\d+(?:\s|$)/);
      expect(className, tone).toMatch(/(?:^|\s)border-[a-z]+-\d+(?:\s|$)/);
      expect(className, tone).toMatch(/(?:^|\s)text-[a-z]+-\d+(?:\s|$)/);
    }
  });

  it("gives no two tones the same colours", () => {
    const seen = CHIP_TONES.map((tone) => {
      const classes = chipClasses(tone).split(/\s+/).filter((c) => /^(?:bg|border|text)-[a-z]+-\d+$/.test(c));
      return classes.sort().join(" ");
    });

    expect(new Set(seen).size).toBe(CHIP_TONES.length);
  });

  it("uses the rail's GEO tone for geo, never violet", () => {
    // 裁决 Q19: one concept, one colour. violet would read as a second thing.
    expect(chipClasses("geo")).toContain("fuchsia");
    for (const tone of CHIP_TONES) {
      expect(chipClasses(tone), tone).not.toContain("violet");
    }
  });

  it("draws a border even though .wb-reset zeroes border widths", () => {
    expect(chipClasses("neutral")).toMatch(/(?:^|\s)border(?:\s|$)/);
  });

  it("renders its children and sets a title only when one is given", () => {
    const scope = render(
      <Chip tone="warn" title="Positions 11-30">
        Near page one
      </Chip>,
    );
    const span = scope.querySelector("span");

    expect(span?.textContent).toBe("Near page one");
    expect(span?.getAttribute("title")).toBe("Positions 11-30");
    cleanup?.();

    const bare = render(<Chip tone="warn">Near page one</Chip>);
    expect(bare.querySelector("span")?.hasAttribute("title")).toBe(false);
  });

  it("carries no inline style (production CSP has no unsafe-inline)", () => {
    const scope = render(<Chip tone="bad">Gap</Chip>);

    expect(scope.querySelectorAll("[style]")).toHaveLength(0);
  });
});
