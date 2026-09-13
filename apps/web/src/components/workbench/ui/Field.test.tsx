/** @vitest-environment jsdom */

/**
 * The field's contract is the label-to-control association (a test, an error
 * message and a screen reader all reach the control through it) and a meta slot
 * that survives falsy values: "0 chars" is a count, not an absent one.
 */

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Field } from "./Field.tsx";

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

describe("Field", () => {
  it("ties its label to the control the caller gave the id to", () => {
    const scope = render(
      <Field label="Positioning" htmlFor="wb-positioning">
        <input id="wb-positioning" />
      </Field>,
    );
    const label = scope.querySelector("label");

    expect(label?.textContent).toBe("Positioning");
    expect(label?.htmlFor).toBe("wb-positioning");
    // The association itself, not just the matching strings.
    expect(label?.control).toBe(scope.querySelector("input"));
  });

  it("renders the meta note beside the label when there is one", () => {
    const scope = render(
      <Field label="Site" meta="gengrowth.ai" htmlFor="wb-site">
        <input id="wb-site" />
      </Field>,
    );

    expect(scope.querySelector("span")?.textContent).toBe("gengrowth.ai");
  });

  it("renders a meta of 0, which a truthiness check would drop", () => {
    const scope = render(
      <Field label="Competitors" meta={0} htmlFor="wb-comp">
        <input id="wb-comp" />
      </Field>,
    );

    expect(scope.querySelector("span")?.textContent).toBe("0");
  });

  it("renders no meta element when none is given", () => {
    const scope = render(
      <Field label="Site" htmlFor="wb-site">
        <input id="wb-site" />
      </Field>,
    );

    expect(scope.querySelector("span")).toBeNull();
  });

  it("carries no inline style (production CSP has no unsafe-inline)", () => {
    const scope = render(
      <Field label="Site" meta="x" htmlFor="wb-site">
        <input id="wb-site" />
      </Field>,
    );

    expect(scope.querySelectorAll("[style]")).toHaveLength(0);
  });
});
