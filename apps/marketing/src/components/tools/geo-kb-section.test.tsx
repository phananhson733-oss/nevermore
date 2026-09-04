// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Input } from "../ui/input.tsx";
import { GeoKbReadout } from "./geo-kb-section.tsx";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("a value read out from another editor", () => {
  it("is drawn in the Profile editor's own box", async () => {
    await act(async () => root.render(<><Input readOnly value="Typed here" /><GeoKbReadout value="Read out here" empty="Not provided" /></>));
    const field = host.querySelector("input")?.className.split(/\s+/u) ?? [];
    const readout = host.querySelector("[data-geo-readout]")?.className.split(/\s+/u) ?? [];
    // The box, not the box's size: a readout grows with its value where an
    // input is one line tall. Each token is checked against `ui/input` in the
    // same breath, so this cannot go on describing a recipe the Profile
    // editor stopped using.
    for (const token of ["rounded-[10px]", "border", "border-brand-border-strong", "bg-brand-bg", "px-4", "text-[14px]"]) {
      expect(field).toContain(token);
      expect(readout).toContain(token);
    }
    // A dashed, half-transparent box read as a sketch of the field rather than
    // the field, which is what this panel is showing.
    expect(readout).not.toContain("border-dashed");
  });
  it("says a missing value is missing instead of hiding it in a placeholder", async () => {
    await act(async () => root.render(<GeoKbReadout value="   " empty="Not provided" />));
    const readout = host.querySelector("[data-geo-readout]");
    expect(readout?.textContent).toBe("Not provided");
    // Not a control: a read-only input still carries a caret and a focus ring
    // for someone who cannot change anything here.
    expect(host.querySelectorAll("input,textarea,select")).toHaveLength(0);
  });
});
