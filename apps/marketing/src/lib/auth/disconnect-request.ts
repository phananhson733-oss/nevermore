// @input  -- a fetch implementation, from the browser of a connected visitor
// @output -- what the disconnect actually achieved, and the copy key for it
// @pos    -- the client half of /api/auth/google/logout, kept out of the component
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/** The one route that revokes at Google and clears every cookie this site set. */
export const DISCONNECT_ENDPOINT = "/api/auth/google/logout";

/**
 * What a disconnect achieved.
 *
 * Three outcomes rather than a boolean, because the visitor's next move
 * differs in each: nothing, go to their Google account, or try again. The
 * authorization now survives for weeks, so "we told you it worked" and "it
 * worked" being the same thing is the whole point of this type.
 */
export type DisconnectOutcome =
  /** Out of this browser, and Google either confirmed or had nothing to remove. */
  | { readonly kind: "cleared" }
  /** Out of this browser; Google did not confirm, so it may still be live there. */
  | { readonly kind: "cleared_not_revoked" }
  /** The request never landed. Nothing changed, here or at Google. */
  | { readonly kind: "failed" };

/**
 * Message keys the disconnect control renders, in every tool namespace.
 *
 * Listed rather than derived so a new key fails the copy test until someone
 * writes both locales, which is the failure this repo wants at test time
 * rather than as a raw key in front of a visitor.
 */
export const DISCONNECT_NOTICE_KEYS = [
  "disconnect",
  "disconnecting",
  "disconnectHint",
  "disconnectRevokeFailed",
  "disconnectFailed",
  "disconnectGoogleSettings",
] as const;

/** Google's own third-party access page, where an unconfirmed revocation ends. */
export const GOOGLE_PERMISSIONS_URL =
  "https://myaccount.google.com/permissions";

/**
 * Read the flag without letting a body we cannot parse become a failure.
 *
 * The route clears the cookies before it serialises anything, so a 200 with an
 * unreadable body is still a disconnect that happened.
 */
async function readRevokedFlag(response: Response): Promise<unknown> {
  try {
    const body = (await response.json()) as {
      data?: { revokedAtGoogle?: unknown };
    };
    return body.data?.revokedAtGoogle;
  } catch {
    return undefined;
  }
}

/** Ask the site to revoke the grant at Google and drop every cookie it set. */
export async function requestDisconnect(
  fetchImpl: typeof fetch = fetch,
): Promise<DisconnectOutcome> {
  try {
    const response = await fetchImpl(DISCONNECT_ENDPOINT, {
      method: "POST",
      // The route reads no body; the header keeps it a simple, same-origin POST.
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
    });
    if (!response.ok) return { kind: "failed" };
    return (await readRevokedFlag(response)) === false
      ? { kind: "cleared_not_revoked" }
      : { kind: "cleared" };
  } catch {
    return { kind: "failed" };
  }
}

/**
 * What to tell the visitor, or null when the page already says it.
 *
 * A clean disconnect needs no sentence: the view reloads into the connect
 * panel, which is the statement. The other two each leave something undone
 * that only the visitor can finish.
 */
export function disconnectNoticeKey(
  outcome: DisconnectOutcome | null,
): "disconnectRevokeFailed" | "disconnectFailed" | null {
  if (outcome === null || outcome.kind === "cleared") return null;
  return outcome.kind === "cleared_not_revoked"
    ? "disconnectRevokeFailed"
    : "disconnectFailed";
}
