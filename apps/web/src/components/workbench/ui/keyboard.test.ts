import { describe, expect, it } from "vitest";
import { isComposingKey } from "./keyboard.ts";

describe("isComposingKey", () => {
  it("is true for the spec'd flag", () => {
    expect(isComposingKey({ isComposing: true, keyCode: 27 })).toBe(true);
  });
  it("is true for the legacy 229 keyCode even when the flag is missing or false", () => {
    expect(isComposingKey({ keyCode: 229 })).toBe(true);
    expect(isComposingKey({ isComposing: false, keyCode: 229 })).toBe(true);
  });
  it("is false for an ordinary keydown", () => {
    expect(isComposingKey({ isComposing: false, keyCode: 13 })).toBe(false);
    expect(isComposingKey({})).toBe(false);
  });
});
