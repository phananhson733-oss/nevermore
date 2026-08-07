import { describe, expect, it } from "vitest";

import { decideSupersededGrant } from "./superseded-grant.ts";

/**
 * The asymmetry this file guards.
 *
 * Clearing the grant cookies is local and reversible — the visitor authorizes
 * again. Revoking at Google is neither: revocation is per client+user, so
 * revoking a grant that turns out to belong to the account authorizing right
 * now kills the credential that same request just issued. Only a subject we
 * can READ on both sides is evidence of a different account; a missing or
 * unparseable one is evidence of nothing.
 */
describe("decideSupersededGrant", () => {
  it("clears and revokes when the two subjects are known and differ", () => {
    expect(
      decideSupersededGrant({ heldSub: "10001", authorizingSub: "10002" }),
    ).toBe("clear_and_revoke");
  });

  it("keeps the grant when the two subjects are known and identical", () => {
    // The same account re-authorizing. Revoking here would kill the token this
    // very request is about to store.
    expect(
      decideSupersededGrant({ heldSub: "10001", authorizingSub: "10001" }),
    ).toBe("keep");
  });

  it("clears without revoking when the stored grant carries no subject", () => {
    // Sealed by a build that stored no `sub`. It may well belong to the account
    // authorizing now, and nothing here can tell.
    expect(
      decideSupersededGrant({ heldSub: undefined, authorizingSub: "10001" }),
    ).toBe("clear");
  });

  it("clears without revoking when the arriving id_token carried no subject", () => {
    // `readIdTokenClaims` answers null for an id_token it cannot base64url
    // decode or JSON parse, and `exchangeCode` does not throw for that.
    expect(
      decideSupersededGrant({ heldSub: "10001", authorizingSub: null }),
    ).toBe("clear");
  });

  it("clears without revoking when neither side names a subject", () => {
    expect(
      decideSupersededGrant({ heldSub: undefined, authorizingSub: null }),
    ).toBe("clear");
  });

  it("treats an empty subject on either side as unknown", () => {
    // An empty string is not an account id. `identitySubFrom` already refuses
    // one, and comparing it would make "" !== "10001" read as a different
    // person.
    expect(decideSupersededGrant({ heldSub: "", authorizingSub: "10001" })).toBe(
      "clear",
    );
    expect(decideSupersededGrant({ heldSub: "10001", authorizingSub: "" })).toBe(
      "clear",
    );
    expect(decideSupersededGrant({ heldSub: "", authorizingSub: "" })).toBe(
      "clear",
    );
  });

  it("revokes at Google only when both subjects are known and differ", () => {
    const subjects = ["10001", "10002", "", undefined, null] as const;
    const revoking = subjects.flatMap((heldSub) =>
      subjects
        .filter(
          (authorizingSub) =>
            decideSupersededGrant({ heldSub, authorizingSub }) ===
            "clear_and_revoke",
        )
        .map((authorizingSub) => [heldSub, authorizingSub]),
    );

    expect(revoking).toEqual([
      ["10001", "10002"],
      ["10002", "10001"],
    ]);
  });
});
