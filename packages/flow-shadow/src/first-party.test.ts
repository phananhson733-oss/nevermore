import { describe, expect, it } from "vitest";
import {
  firstPartyIdentityKind,
  FIRST_PARTY_SOURCE_KINDS,
  isFirstPartySourceKind,
} from "./first-party.ts";

describe("first-party research source kinds", () => {
  it("classifies frozen page snapshots as first-party page identities", () => {
    expect(FIRST_PARTY_SOURCE_KINDS).toContain("first_party_page");
    expect(isFirstPartySourceKind("first_party_page")).toBe(true);
    expect(firstPartyIdentityKind("first_party_page")).toBe("page");
  });

  it("keeps external pages outside the first-party identity set", () => {
    expect(isFirstPartySourceKind("external_page")).toBe(false);
    expect(firstPartyIdentityKind("external_page")).toBeNull();
  });
});
