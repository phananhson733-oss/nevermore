import { describe, expect, it } from "vitest";
import { DraftIcpProfilePatch } from "@sf/contracts";
import {
  buildDraftPatch,
  emptyPersona,
  EMPTY_FORM,
  incompletePersonaPointers,
  prepareDraftSave,
  type FormState,
  type PersonaDraft,
} from "./_context-draft";

/**
 * The draft patch is where "the operator cleared this field" and "the operator
 * did not touch this field" have to stay distinguishable. Spec §6.2 and
 * `DraftIcpProfilePatch` (`packages/contracts/src/zod/icp.ts:115-118`) put it
 * plainly: a present `null` clears the field, an ABSENT KEY INHERITS the
 * current value. Emitting the wrong one of those is silent data loss on one
 * side and a silently ignored edit on the other, and neither shows up in the
 * UI. These tests assert that contract, not the shape of the builder.
 */

const persona = (over: Partial<PersonaDraft> = {}): PersonaDraft => ({
  name: "Ops lead",
  roleOrContext: "Runs onboarding",
  jobs: "Cut time to value",
  painPoints: "Manual setup",
  ...over,
});

const form = (over: Partial<FormState> = {}): FormState => ({
  ...EMPTY_FORM,
  ...over,
});

describe("buildDraftPatch omits what was not edited", () => {
  it("sends nothing at all when the form equals its baseline", () => {
    const baseline = form({ productName: "Atlas", segments: "SMB\nMid" });
    // Every key absent is the only way to say "inherit everything"; a builder
    // that echoed the unchanged values back would overwrite a field the server
    // may have advanced since this form was loaded.
    expect(buildDraftPatch(baseline, baseline)).toEqual({});
  });

  it("carries only the edited key, leaving its neighbours absent", () => {
    const baseline = form({ productName: "Atlas", offers: "Starter" });
    const patch = buildDraftPatch(
      form({ productName: "Atlas Cloud", offers: "Starter" }),
      baseline,
    );
    expect(patch).toEqual({ productName: "Atlas Cloud" });
    expect(patch).not.toHaveProperty("offers");
  });
});

describe("buildDraftPatch distinguishes cleared from untouched", () => {
  it("clears a scalar field with an explicit null, never an empty string", () => {
    const baseline = form({
      productName: "Atlas",
      oneLineDescription: "Onboarding, automated",
      businessProfileNote: "Regulated",
      defaultDeliveryLocale: "en",
    });
    const patch = buildDraftPatch(
      form({
        productName: "   ",
        oneLineDescription: "",
        businessProfileNote: "",
        defaultDeliveryLocale: "",
      }),
      baseline,
    );
    expect(patch.productName).toBeNull();
    expect(patch.oneLineDescription).toBeNull();
    expect(patch.businessProfileNote).toBeNull();
    expect(patch.defaultDeliveryLocale).toBeNull();
  });

  it("clears a list field with an empty array, which is not the same as null", () => {
    const baseline = form({
      segments: "SMB\nMid-market",
      competitors: "acme.test",
      priorityUrls: "https://a.test/pricing",
    });
    const patch = buildDraftPatch(
      form({ segments: "", competitors: "   ", priorityUrls: "\n\n" }),
      baseline,
    );
    expect(patch.segments).toEqual([]);
    expect(patch.competitors).toEqual([]);
    expect(patch.priorityUrls).toEqual([]);
  });

  it("clears the two enum fields with null rather than an empty enum value", () => {
    const baseline = form({ customerModel: "b2b", businessProfile: "saas" });
    const patch = buildDraftPatch(
      form({ customerModel: "", businessProfile: "" }),
      baseline,
    );
    expect(patch.customerModel).toBeNull();
    expect(patch.businessProfile).toBeNull();
  });

  it("keeps a chosen enum value as itself", () => {
    const patch = buildDraftPatch(
      form({ customerModel: "b2c", businessProfile: "ecommerce" }),
      EMPTY_FORM,
    );
    expect(patch.customerModel).toBe("b2c");
    expect(patch.businessProfile).toBe("ecommerce");
  });

  it("drops blank lines and surrounding spaces from every list field", () => {
    const patch = buildDraftPatch(
      form({ segments: "  SMB  \n\n   \nMid-market\n" }),
      EMPTY_FORM,
    );
    expect(patch.segments).toEqual(["SMB", "Mid-market"]);
  });
});

describe("buildDraftPatch treats the primary conversion as one field", () => {
  it("sends the whole object when any one of its three inputs changes", () => {
    const baseline = form({
      conversionLabel: "Book a demo",
      conversionType: "demo_request",
      conversionTargetUrl: "https://a.test/demo",
    });
    const patch = buildDraftPatch(
      form({
        conversionLabel: "Book a demo",
        conversionType: "demo_request",
        conversionTargetUrl: "https://a.test/book",
      }),
      baseline,
    );
    expect(patch.primaryConversion).toEqual({
      label: "Book a demo",
      type: "demo_request",
      targetUrl: "https://a.test/book",
    });
  });

  it("leaves the conversion absent while none of its three inputs moved", () => {
    const baseline = form({
      conversionLabel: "Book a demo",
      conversionType: "demo_request",
      conversionTargetUrl: "https://a.test/demo",
      offers: "Starter",
    });
    const patch = buildDraftPatch(form({ ...baseline, offers: "Pro" }), baseline);
    expect(patch).not.toHaveProperty("primaryConversion");
  });

  it("clears the conversion when either required half is emptied", () => {
    const baseline = form({
      conversionLabel: "Book a demo",
      conversionType: "demo_request",
    });
    expect(
      buildDraftPatch(form({ ...baseline, conversionLabel: "  " }), baseline)
        .primaryConversion,
    ).toBeNull();
    expect(
      buildDraftPatch(form({ ...baseline, conversionType: "" }), baseline)
        .primaryConversion,
    ).toBeNull();
  });

  it("keeps an optional target URL as null rather than an empty string", () => {
    const patch = buildDraftPatch(
      form({
        conversionLabel: "Start trial",
        conversionType: "trial_signup",
        conversionTargetUrl: "   ",
      }),
      EMPTY_FORM,
    );
    expect(patch.primaryConversion).toEqual({
      label: "Start trial",
      type: "trial_signup",
      targetUrl: null,
    });
  });
});

describe("a partially filled persona is refused, never quietly dropped", () => {
  it("names the pointer of every missing part of a started persona", () => {
    expect(
      incompletePersonaPointers([
        persona({ name: "", jobs: "", painPoints: "  \n " }),
      ]),
    ).toEqual([
      "/personas/0/name",
      "/personas/0/jobs",
      "/personas/0/painPoints",
    ]);
  });

  it("ignores a persona row nobody typed into", () => {
    // The form ships with one blank row; a blank row is not an error.
    expect(incompletePersonaPointers([emptyPersona()])).toEqual([]);
    expect(incompletePersonaPointers(EMPTY_FORM.personas)).toEqual([]);
  });

  it("reports the index of the offending row, not just that one exists", () => {
    expect(
      incompletePersonaPointers([
        persona(),
        emptyPersona(),
        persona({ roleOrContext: "" }),
      ]),
    ).toEqual(["/personas/2/roleOrContext"]);
  });

  it("refuses the save instead of silently filtering the incomplete row", () => {
    const started = form({
      productName: "Atlas",
      personas: [persona(), persona({ painPoints: "" })],
    });
    const result = prepareDraftSave(started, EMPTY_FORM);
    expect(result.ok).toBe(false);
    // `buildDraftPatch` on its own WOULD drop the half-filled row. A save that
    // used it directly would report success while discarding what was typed.
    expect(buildDraftPatch(started, EMPTY_FORM).personas).toHaveLength(1);
    if (!result.ok) {
      expect(result.fieldPointers).toEqual(["/personas/1/painPoints"]);
    }
  });

  it("saves a patch the draft contract accepts once every persona is whole", () => {
    const result = prepareDraftSave(
      form({ productName: "Atlas", personas: [persona()] }),
      EMPTY_FORM,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.personas).toEqual([
        {
          name: "Ops lead",
          roleOrContext: "Runs onboarding",
          jobs: ["Cut time to value"],
          painPoints: ["Manual setup"],
        },
      ]);
      expect(DraftIcpProfilePatch.safeParse(result.profile).success).toBe(true);
    }
  });
});
