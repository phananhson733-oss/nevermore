import { describe, expect, it } from "vitest";

import {
  asPlanTier,
  FREE_PLAN_TIER,
  INTERNAL_PLAN_TIER,
  isSelfServeSignupEnabled,
  projectLimitFor,
} from "./plan.ts";

/**
 * The tier gate that bounds what an unvetted signup can spend.
 *
 * Both defaults here point the same way on purpose: an unknown tier resolves to
 * the BOUNDED one, and the signup brake is the only thing that opens. A bug in
 * either direction is a bug that costs money, so each default is asserted
 * rather than left to the reader.
 */

describe("asPlanTier", () => {
  it("recognises the two known tiers", () => {
    expect(asPlanTier("free")).toBe(FREE_PLAN_TIER);
    expect(asPlanTier("internal")).toBe(INTERNAL_PLAN_TIER);
  });

  it.each([null, undefined, "", "enterprise", "FREE", "Internal", "unlimited"])(
    "resolves the unrecognised value %p to the bounded tier",
    (raw) => {
      // A tier this build does not know about must not be the one that lifts
      // the limit. Note "Internal" — a case mismatch must not open the gate.
      expect(asPlanTier(raw as string | null | undefined)).toBe(FREE_PLAN_TIER);
    },
  );
});

describe("projectLimitFor", () => {
  it("caps the free tier at a single project", () => {
    expect(projectLimitFor(FREE_PLAN_TIER)).toBe(1);
  });

  it("leaves the internal tier unbounded", () => {
    expect(projectLimitFor(INTERNAL_PLAN_TIER)).toBeNull();
  });
});

describe("isSelfServeSignupEnabled", () => {
  it("is on by default, which is what spec §1.6 specifies", () => {
    expect(isSelfServeSignupEnabled({})).toBe(true);
  });

  it("closes to invite-only on the exact brake value", () => {
    expect(isSelfServeSignupEnabled({ SF_SIGNUP_MODE: "invite" })).toBe(false);
  });

  it.each(["open", "", "INVITE", "invite-only", "true"])(
    "keeps self-serve open for %p, so a typo cannot silently lock signups",
    (value) => {
      expect(isSelfServeSignupEnabled({ SF_SIGNUP_MODE: value })).toBe(true);
    },
  );
});
