/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { FOCUSABLE, focusCandidates, nextTrapIndex } from "./focus-order.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("focusCandidates", () => {
  function scopeOf(html: string): HTMLElement {
    const scope = document.createElement("div");
    scope.innerHTML = html;
    return scope;
  }

  function ids(elements: readonly HTMLElement[]): readonly string[] {
    return elements.map((el) => el.id);
  }

  it("leaves out a control under hidden, under inert, or in a disabled fieldset", () => {
    expect(
      ids(
        focusCandidates(
          scopeOf(
            '<button id="on" type="button">a</button>' +
              '<button id="hidden" type="button" hidden>b</button>' +
              '<div hidden><button id="under-hidden" type="button">c</button></div>' +
              '<div inert><button id="under-inert" type="button">d</button></div>' +
              '<fieldset disabled><button id="in-fieldset" type="button">e</button></fieldset>' +
              '<a id="link" href="#">f</a>',
          ),
        ),
      ),
    ).toEqual(["on", "link"]);
  });

  it("asks for a box only when the scope itself has one", () => {
    const scope = scopeOf(
      '<button id="boxed" type="button">a</button><button id="boxless" type="button">b</button>',
    );
    // jsdom: no element has a box, the scope included, so boxes are not asked.
    expect(ids(focusCandidates(scope))).toEqual(["boxed", "boxless"]);

    // A laid-out document: the scope has a box, and so does all but one control.
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
      return (this.id === "boxless" ? [] : [{}]) as unknown as DOMRectList;
    });

    expect(ids(focusCandidates(scope))).toEqual(["boxed"]);
  });
});
