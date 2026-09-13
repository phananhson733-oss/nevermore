/**
 * These constants are strings, so nothing about them fails loudly: a dropped
 * `border-…` under a preflight-less Tailwind removes a line instead of falling
 * back to one, a raw hex passes the CSP but ignores the token layer, and an
 * inverted fill without its own `focus-visible:outline-*` gets a white ring on
 * cream. The sweep runs over the module's exports rather than a list written
 * here, so a constant added later is covered without editing this file; the
 * named cases pin the rules a sweep cannot express.
 */

import { describe, expect, it } from "vitest";
import * as panel from "./panel.ts";

const ENTRIES = Object.entries(panel);

describe("panel class constants", () => {
  it("exports the shells the views and the panes share", () => {
    // Guards the sweep itself: if the module ever exported nothing, every
    // `for` below would pass by iterating zero times.
    expect(ENTRIES.length).toBeGreaterThanOrEqual(10);
    for (const [name, value] of ENTRIES) {
      expect(typeof value, name).toBe("string");
      expect(value, name).not.toBe("");
    }
  });

  it("names no colour as a raw hex", () => {
    for (const [name, value] of ENTRIES) {
      expect(String(value), name).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });

  it("sets no body copy below 14px", () => {
    // PR-1's floor: 11-13px is for badges, column heads and timestamps, which
    // spell `text-xs` / `text-[11px]` at their own call sites.
    for (const [name, value] of ENTRIES) {
      expect(String(value), name).not.toMatch(/text-\[1[123]px\]/);
    }
  });

  it("spells every class once per constant", () => {
    for (const [name, value] of ENTRIES) {
      const classes = String(value).split(/\s+/).filter(Boolean);
      expect(new Set(classes).size, name).toBe(classes.length);
    }
  });

  it("draws its own border on every bordered surface", () => {
    // `.wb-reset` sets border-width: 0, so these classes are the line.
    expect(panel.PANEL_SHELL).toContain("border border-slate-200");
    expect(panel.CARD_SHELL).toContain("border border-slate-200");
    expect(panel.STAT_CARD_SHELL).toContain("border border-slate-200");
    expect(panel.PANEL_HEAD).toContain("border-b border-slate-200");
    expect(panel.PANEL_FOOT).toContain("border-t border-slate-200");
    expect(panel.FOOT_NOTE).toContain("border-t");
    expect(panel.SECTION_RULE).toContain("border-t");
    expect(panel.ROW_RULE).toContain("border-t");
    expect(panel.TABLE_HEAD_ROW).toContain("border-b");
    expect(panel.TABLE_ROW).toContain("border-b");
  });

  it("collapses table borders itself", () => {
    expect(panel.TABLE_SHELL).toContain("border-collapse");
  });

  it("gives every inverted control its own focus ring", () => {
    // `.wb-reset :focus-visible` draws the ring in currentColor; on a
    // `text-white` fill that ring is invisible on the cream shell.
    const inverted = ENTRIES.filter(([, value]) => String(value).includes("text-white"));
    expect(inverted.length).toBeGreaterThanOrEqual(1);
    for (const [name, value] of inverted) {
      expect(String(value), name).toMatch(/focus-visible:outline-/);
    }
  });

  it("pushes a footnote to the bottom of its card", () => {
    expect(panel.FOOT_NOTE).toContain("mt-auto");
    expect(panel.STAT_CARD_SHELL).toContain("flex-col");
  });

  it("fills the primary action from the ink token", () => {
    expect(panel.BUTTON_PRIMARY).toContain("bg-wb-ink");
  });

  it("keeps every action button above the 24px target floor", () => {
    for (const [name, value] of ENTRIES.filter(([key]) => key.startsWith("BUTTON_"))) {
      const found = /min-h-\[(\d+)px\]/.exec(String(value));
      expect(found, name).not.toBeNull();
      expect(Number(found?.[1] ?? 0), name).toBeGreaterThanOrEqual(24);
    }
  });
});
