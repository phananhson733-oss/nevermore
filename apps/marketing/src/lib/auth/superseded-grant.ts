// @input  -- the subject a stored grant carries, and the subject that just authorized
// @output -- whether that grant is kept, cleared locally, or also revoked at Google
// @pos    -- the account-switch decision behind /api/auth/google/callback, kept out of the transport
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * What to do with the grant already in the browser.
 *
 * Three answers rather than a boolean, because the two effects are not one
 * effect: clearing cookies is local and reversible, revoking is remote and
 * permanent. The union cannot express "revoke without clearing", which is the
 * one combination that would be a bug.
 */
export type SupersededGrantAction =
  /** Provably the same account. Leave the credential where it is. */
  | "keep"
  /** Cannot prove same OR different. Drop it here; never touch Google. */
  | "clear"
  /** Provably a different account. Drop it here and revoke it at Google. */
  | "clear_and_revoke";

/** A subject we can actually compare, or null. Empty strings are not account ids. */
function knownSubject(value: string | null | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Decide what an arriving authorization does to the grant already held.
 *
 * CONSTRAINT: revocation requires BOTH subjects to be known and to differ.
 * Revoking at Google is per client+user, so revoking a grant that in fact
 * belongs to the account authorizing right now kills the credential that same
 * request just issued. A subject is missing far more often than it looks:
 * `readIdTokenClaims` answers null for any id_token it cannot base64url decode
 * or JSON parse and `exchangeCode` does not throw for that, and a grant sealed
 * by an earlier build carries no `sub` at all. "Cannot prove it is the same
 * account" is not evidence of a different one.
 *
 * CONSTRAINT: the local clear stays on the unproven path deliberately. It costs
 * a visitor one trip through the consent screen and nothing else, while keeping
 * an unattributable credential in a browser where someone else may have just
 * signed in is the failure this whole branch exists to prevent. The two effects
 * are separated precisely because only one of them is cheap to get wrong.
 *
 * What the unproven path leaves behind: a refresh token still live at Google
 * that this browser can no longer reach, and so can no longer revoke. That is
 * accepted — it expires on Google's own schedule and the visitor can remove it
 * from their account page, whereas a wrong revocation cannot be undone from
 * either side.
 */
export function decideSupersededGrant(input: {
  /** `sub` from the stored `gg_gsc` grant. Optional there, so optional here. */
  readonly heldSub: string | null | undefined;
  /** `sub` from the token set just exchanged. Null when the id_token did not parse. */
  readonly authorizingSub: string | null | undefined;
}): SupersededGrantAction {
  const held = knownSubject(input.heldSub);
  const authorizing = knownSubject(input.authorizingSub);
  if (held === null || authorizing === null) return "clear";
  return held === authorizing ? "keep" : "clear_and_revoke";
}
