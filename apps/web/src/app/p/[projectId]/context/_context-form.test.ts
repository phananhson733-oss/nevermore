import { describe, expect, it } from "vitest";
import {
  EMPTY_FORM,
  buildDraftPatch,
  prepareDraftSave,
  type FormState,
} from "./_context-draft";
import { mapContextFieldErrors } from "./_context-form-errors";

function formState(overrides: Partial<FormState> = {}): FormState {
  return {
    ...EMPTY_FORM,
    personas: [{ name: "", roleOrContext: "", jobs: "", painPoints: "" }],
    ...overrides,
  };
}

describe("draft save preparation", () => {
  it("sends explicit clearing values for saved fields while omitting untouched fields", () => {
    const baseline = formState({
      productName: "Saved product",
      oneLineDescription: "This remains unchanged",
      customerModel: "b2b",
      marketCodes: "US\nGB",
      personas: [
        {
          name: "VP Growth",
          roleOrContext: "Buyer",
          jobs: "Grow qualified traffic",
          painPoints: "Weak attribution",
        },
      ],
      conversionLabel: "Request a demo",
      conversionType: "demo",
      conversionTargetUrl: "https://example.com/demo",
      competitors: "Competitor A\nCompetitor B",
    });
    const cleared = formState({
      ...baseline,
      productName: "",
      customerModel: "",
      marketCodes: "",
      personas: [{ name: "", roleOrContext: "", jobs: "", painPoints: "" }],
      conversionLabel: "",
      conversionType: "",
      conversionTargetUrl: "",
      competitors: "",
    });

    expect(buildDraftPatch(cleared, baseline)).toEqual({
      productName: null,
      customerModel: null,
      marketCodes: [],
      personas: [],
      primaryConversion: null,
      competitors: [],
    });
  });

  it("sends only the changed key instead of resubmitting inherited values", () => {
    const baseline = formState({
      productName: "Saved product",
      oneLineDescription: "Saved description",
      ninetyDayGoals: "Old goal",
    });
    const edited = formState({ ...baseline, ninetyDayGoals: "New goal" });

    expect(buildDraftPatch(edited, baseline)).toEqual({
      ninetyDayGoals: ["New goal"],
    });
  });

  it("blocks a half-filled persona instead of filtering it from a successful save", () => {
    const baseline = formState();
    const edited = formState({
      productName: "A real edit",
      personas: [
        {
          name: "VP Growth",
          roleOrContext: "",
          jobs: "Increase qualified demand",
          painPoints: "",
        },
      ],
    });

    expect(prepareDraftSave(edited, baseline)).toEqual({
      ok: false,
      fieldPointers: [
        "/personas/0/roleOrContext",
        "/personas/0/painPoints",
      ],
    });
  });

  it("allows the blank placeholder row and preserves another real edit", () => {
    const baseline = formState();
    const edited = formState({ productName: "Saved honestly" });

    expect(prepareDraftSave(edited, baseline)).toEqual({
      ok: true,
      profile: { productName: "Saved honestly" },
    });
  });
});

describe("mapContextFieldErrors", () => {
  it("replaces server field messages with the localized qualification warning", () => {
    expect(
      mapContextFieldErrors(
        [
          { pointer: "/productName" },
          { pointer: "/personas/0/name" },
        ],
        "localized-qualification-incomplete",
      ),
    ).toEqual({
      "/productName": "localized-qualification-incomplete",
      "/personas/0/name": "localized-qualification-incomplete",
    });
  });

  it("keeps the first localized message per pointer", () => {
    expect(
      mapContextFieldErrors(
        [
          { pointer: "/productName" },
          { pointer: "/productName" },
        ],
        "localized-qualification-incomplete",
      ),
    ).toEqual({
      "/productName": "localized-qualification-incomplete",
    });
  });

  it("returns an empty map when the server reported no field errors", () => {
    expect(
      mapContextFieldErrors([], "localized-qualification-incomplete"),
    ).toEqual({});
  });

  it("preserves aggregate and nested pointers exactly as the form consumes them", () => {
    expect(
      mapContextFieldErrors(
        [
          { pointer: "/profile/ninetyDayGoals" },
          { pointer: "/profile/personas" },
          { pointer: "/profile/personas/0/name" },
        ],
        "localized-qualification-incomplete",
      ),
    ).toEqual({
      "/profile/ninetyDayGoals": "localized-qualification-incomplete",
      "/profile/personas": "localized-qualification-incomplete",
      "/profile/personas/0/name": "localized-qualification-incomplete",
    });
  });
});
