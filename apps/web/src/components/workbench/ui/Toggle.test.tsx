/** @vitest-environment jsdom */

/**
 * A switch made of a `<div>` and an `onClick` looks identical and is unusable
 * from a keyboard, so these cases pin that the control is a real checkbox: the
 * Space key, the label association and the disabled state all come from the
 * platform rather than from a handler here, and jsdom does not dispatch
 * activation from key events, so the element type is the only thing that can be
 * asserted for the keyboard.
 *
 * The size comes from `panel.ts` and is asserted against that constant, because
 * the hit-area sweep in `panel.test.ts` runs over that module's exports only — a
 * width hand-written in this file would sit outside every gate we have.
 */

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SWITCH_TRACK } from "./panel.ts";
import { Toggle } from "./Toggle.tsx";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LABEL = "Weekly report";
const DESCRIPTION =
  "Covers the This week page and the artifacts from that week.";
/** WCAG 2.5.8 (AA): 24 CSS pixels in the smaller dimension. */
const TARGET_FLOOR = 24;

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

function switchOf(scope: HTMLElement): HTMLInputElement {
  const found = scope.querySelector<HTMLInputElement>('input[role="switch"]');
  if (found === null) throw new Error("no switch rendered");
  return found;
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("Toggle", () => {
  it("is a real checkbox exposed as a switch, so Space works without a handler", () => {
    const scope = render(<Toggle checked label={LABEL} onChange={vi.fn()} />);
    const control = switchOf(scope);

    expect(control.tagName).toBe("INPUT");
    expect(control.type).toBe("checkbox");
    expect(control.getAttribute("role")).toBe("switch");
    expect(control.disabled).toBe(false);
  });

  it("mirrors the checked prop in both directions of state", () => {
    const on = render(<Toggle checked label={LABEL} onChange={vi.fn()} />);
    expect(switchOf(on).checked).toBe(true);
    expect(switchOf(on).getAttribute("aria-checked")).not.toBe("false");
    cleanup?.();
    cleanup = null;

    const off = render(
      <Toggle checked={false} label={LABEL} onChange={vi.fn()} />,
    );
    expect(switchOf(off).checked).toBe(false);
  });

  it("reports the value it is being switched to", () => {
    const onChange = vi.fn<(next: boolean) => void>();
    const scope = render(
      <Toggle checked={false} label={LABEL} onChange={onChange} />,
    );

    act(() => switchOf(scope).click());

    expect(onChange.mock.calls).toEqual([[true]]);
  });

  it("switches off again from a checked state", () => {
    const onChange = vi.fn<(next: boolean) => void>();
    const scope = render(<Toggle checked label={LABEL} onChange={onChange} />);

    act(() => switchOf(scope).click());

    expect(onChange.mock.calls).toEqual([[false]]);
  });

  it("takes its accessible name from the label and its detail from a described-by", () => {
    const scope = render(
      <Toggle
        checked
        label={LABEL}
        description={DESCRIPTION}
        onChange={vi.fn()}
      />,
    );
    const control = switchOf(scope);

    expect([...(control.labels ?? [])].map((node) => node.textContent)).toEqual(
      [LABEL],
    );
    const describedBy = control.getAttribute("aria-describedby") ?? "";
    expect(scope.querySelector(`#${describedBy}`)?.textContent).toBe(
      DESCRIPTION,
    );
  });

  it("names no described-by when there is no description to point at", () => {
    const scope = render(<Toggle checked label={LABEL} onChange={vi.fn()} />);

    expect(switchOf(scope).hasAttribute("aria-describedby")).toBe(false);
  });

  it("toggles when the label text is clicked", () => {
    const onChange = vi.fn<(next: boolean) => void>();
    const scope = render(
      <Toggle checked={false} label={LABEL} onChange={onChange} />,
    );
    const label = scope.querySelector("label");

    act(() => label?.click());

    expect(onChange.mock.calls).toEqual([[true]]);
  });

  it("takes its hit area from the swept panel constant, which clears the 24px floor", () => {
    const scope = render(<Toggle checked label={LABEL} onChange={vi.fn()} />);
    const control = switchOf(scope);

    for (const name of SWITCH_TRACK.split(/\s+/u).filter(Boolean)) {
      expect(control.classList.contains(name), name).toBe(true);
    }
    const heights = [...SWITCH_TRACK.matchAll(/min-h-\[(\d+)px\]/gu)].map(
      (found) => Number(found[1]),
    );
    // Unprefixed only: `after:w-[18px]` is the knob inside the track, not the target.
    const widths = [...SWITCH_TRACK.matchAll(/(?:^|\s)w-\[(\d+)px\]/gu)].map(
      (found) => Number(found[1]),
    );
    expect(heights).toHaveLength(1);
    expect(widths).toHaveLength(1);
    for (const px of [...heights, ...widths]) {
      expect(px).toBeGreaterThanOrEqual(TARGET_FLOOR);
    }
  });

  it("does not report a change while it is disabled", () => {
    const onChange = vi.fn<(next: boolean) => void>();
    const scope = render(
      <Toggle checked={false} disabled label={LABEL} onChange={onChange} />,
    );

    expect(switchOf(scope).disabled).toBe(true);
    act(() => switchOf(scope).click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("carries no inline style (production CSP has no unsafe-inline)", () => {
    const scope = render(
      <Toggle
        checked
        label={LABEL}
        description={DESCRIPTION}
        onChange={vi.fn()}
      />,
    );

    expect(scope.querySelectorAll("[style]")).toHaveLength(0);
  });
});
