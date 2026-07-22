import { describe, expect, it } from "vitest";
import { projectSwitchHref } from "./_project-switcher-model.ts";

describe("project switcher route continuity", () => {
  it.each(["overview", "growth-map", "execution", "results"])(
    "keeps the canonical %s destination when switching projects",
    (section) => {
      expect(projectSwitchHref(`/p/source/${section}`, "target")).toBe(
        `/p/target/${section}`,
      );
    },
  );

  it.each([
    ["diagnosis", "growth-map"],
    ["plan", "execution"],
    ["studio", "execution"],
    ["report", "results"],
  ])("canonicalizes legacy %s when switching projects", (legacy, canonical) => {
    expect(projectSwitchHref(`/p/source/${legacy}`, "target")).toBe(
      `/p/target/${canonical}`,
    );
  });
});
