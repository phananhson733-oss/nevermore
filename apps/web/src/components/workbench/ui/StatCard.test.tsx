/** @vitest-environment jsdom */

/**
 * Two things must hold no matter how the card is restyled: an unknown value
 * prints an em dash and never a zero (裁决 Q10 — the fixtures below deliberately
 * contain no other "0" so the assertion cannot be satisfied by the label or the
 * footnote), and a navigable card is an anchor rather than a button, because the
 * Studio unsaved-changes guard watches link clicks and a `router.push` walks
 * past it (PR-1 red-team A1).
 *
 * Without an app router context `next/link` still renders its anchor, which is
 * all this file reads (Sidebar.test.tsx and CommandPalette.test.tsx rely on the
 * same thing).
 */

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { StatCard } from "./StatCard.tsx";
import { STAT_CARD_SHELL } from "./panel.ts";
import { UNKNOWN_TEXT } from "./stat-format.ts";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("StatCard", () => {
  it("prints an em dash for an unknown value and no zero anywhere", () => {
    const scope = render(
      <StatCard value={null} label="Health" foot="No audit run yet" />,
    );

    expect(scope.textContent).toContain(UNKNOWN_TEXT);
    // The lie this card must never tell: an unmeasured metric reading as zero.
    expect(scope.textContent).not.toContain("0");
  });

  it("does not accent an unknown value", () => {
    // A fuchsia dash implies there is a number behind it.
    const scope = render(
      <StatCard
        value={null}
        label="AI mentions"
        foot="No check run yet"
        accent="fuchsia"
      />,
    );
    const value = scope.querySelector("span");

    expect(value?.textContent).toBe(UNKNOWN_TEXT);
    expect(value?.className).not.toContain("fuchsia");
  });

  it("prints a measured zero as a zero", () => {
    const scope = render(
      <StatCard value="0" label="Artifacts" foot="This session" />,
    );

    expect(scope.querySelector("span")?.textContent).toBe("0");
    expect(scope.textContent).not.toContain(UNKNOWN_TEXT);
  });

  it("uses the rail's GEO tone for the AI-mention accent, never violet", () => {
    // 裁决 Q19, a recorded deviation from the appearance reference.
    const scope = render(
      <StatCard
        value="35%"
        label="AI mentions"
        foot="14 of 40 answers"
        accent="fuchsia"
      />,
    );
    const value = scope.querySelector("span");

    expect(value?.className).toContain("text-fuchsia-500");
    expect(value?.className).not.toContain("violet");
  });

  it("builds its surface from the shared shell, borders included", () => {
    // Not decoration: `.wb-reset` zeroes border widths, so a card that stops
    // using STAT_CARD_SHELL does not get a thinner line, it gets no line. A
    // locally rewritten shell without `border border-slate-200` used to pass
    // every other test in this file.
    const scope = render(
      <StatCard value="56" label="Health" foot="9 findings" />,
    );
    const root = scope.firstElementChild;

    expect(root?.className).toContain("border border-slate-200");
    expect(root?.className).toContain(STAT_CARD_SHELL);
  });

  it("appends the delta unit the caller gives, and omits it otherwise", () => {
    // The week view's mention-rate card is `35% / +6pt` (appearance authority).
    const scope = render(
      <StatCard
        value="35%"
        label="AI mentions"
        foot="14 of 40"
        delta={6}
        deltaUnit="pt"
      />,
    );

    expect(scope.textContent).toContain("+6pt");
    cleanup?.();

    const bare = render(
      <StatCard value="35%" label="AI mentions" foot="14 of 40" delta={6} />,
    );
    expect(bare.textContent).toContain("+6");
    expect(bare.textContent).not.toContain("+6pt");
  });

  it("renders the delta when one is given and nothing when it is not", () => {
    const scope = render(
      <StatCard value="56" label="Health" foot="9 findings" delta={7} />,
    );

    expect(scope.textContent).toContain("+7");
    cleanup?.();

    const bare = render(
      <StatCard value="56" label="Health" foot="9 findings" />,
    );
    expect(bare.textContent).not.toContain("+");
  });

  it("keeps the label and the footnote the caller passed", () => {
    const scope = render(
      <StatCard
        value="12"
        label="Keyword candidates"
        foot={<span>8 from GSC</span>}
      />,
    );

    expect(scope.textContent).toContain("Keyword candidates");
    expect(scope.textContent).toContain("8 from GSC");
  });

  it("becomes one anchor over the whole card when a href is given", () => {
    const scope = render(
      <StatCard
        value="5"
        label="Borderline"
        foot="Positions 11-30"
        href="/p/abc/keywords"
      />,
    );
    const anchor = scope.querySelector("a");

    expect(anchor?.getAttribute("href")).toBe("/p/abc/keywords");
    expect(anchor?.textContent).toContain("Borderline");
    // A button here would drive router.push and bypass the navigation guard.
    expect(scope.querySelector("button")).toBeNull();
  });

  it("is not a link when no href is given", () => {
    const scope = render(
      <StatCard value="5" label="Borderline" foot="Positions 11-30" />,
    );

    expect(scope.querySelector("a")).toBeNull();
    expect(scope.querySelector("button")).toBeNull();
  });

  it("carries no inline style (production CSP has no unsafe-inline)", () => {
    const scope = render(
      <StatCard
        value="56"
        label="Health"
        foot="9 findings"
        delta={-2}
        href="/p/abc/audit"
      />,
    );

    expect(scope.querySelectorAll("[style]")).toHaveLength(0);
  });
});
