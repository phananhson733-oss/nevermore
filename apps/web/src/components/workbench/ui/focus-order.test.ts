/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { FOCUSABLE, nextTrapIndex } from "./focus-order.ts";

describe("nextTrapIndex", () => {
  it("wraps forward and backward", () => {
    expect(nextTrapIndex(3, 2, false)).toBe(0);
    expect(nextTrapIndex(3, 0, true)).toBe(2);
    expect(nextTrapIndex(3, 1, false)).toBe(2);
  });
  it("enters from outside at the correct end", () => {
    expect(nextTrapIndex(3, -1, false)).toBe(0);
    expect(nextTrapIndex(3, -1, true)).toBe(2);
  });
  it("returns -1 when nothing is focusable", () => {
    expect(nextTrapIndex(0, 0, false)).toBe(-1);
  });
});

describe("FOCUSABLE", () => {
  function matches(html: string): readonly string[] {
    const scope = document.createElement("div");
    scope.innerHTML = html;
    return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].map((el) => el.id);
  }

  it("excludes a disabled control even when it carries an explicit tabindex", () => {
    // The generic `[tabindex]` branch would otherwise admit it, and `.focus()`
    // on a disabled control is a silent no-op that strands the trap.
    expect(
      matches(
        '<button id="on" type="button">a</button>' +
          '<button id="off" type="button" disabled tabindex="0">b</button>' +
          '<div id="generic" tabindex="0"></div>' +
          '<div id="generic-off" tabindex="0" disabled></div>',
      ),
    ).toEqual(["on", "generic"]);
  });

  it("excludes tabindex=-1 on every branch", () => {
    expect(
      matches(
        '<a id="link" href="#">a</a>' +
          '<button id="opt" type="button" tabindex="-1">b</button>' +
          '<input id="field" />' +
          '<div id="panel" tabindex="-1"></div>',
      ),
    ).toEqual(["link", "field"]);
  });
});
