// @input  -- /api/auth/session, lib/auth/gsi-client
// @output — the Google One Tap prompt, and a page refresh once it signs in
// @pos    -- mounted only on the pages where signing in is the point (home, tools)
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useEffect } from "react";

import { ensureGoogleIdentity } from "../../lib/auth/gsi-client";

/**
 * Google One Tap.
 *
 * Deliberately silent about its own failures. Every path here is an
 * enhancement over the ordinary sign-in control: a blocked third-party script,
 * a visitor with no Google session, a deployment without a client id, or an
 * expired nonce should all end in "no prompt appeared", never in an error a
 * reader of a blog post has to dismiss.
 *
 * The nonce and the GSI initialisation both live in gsi-client so this prompt
 * and the header's sign-in button share them — see the note there on why two
 * independent nonces would break the replay binding.
 *
 * One Tap is passive by nature: Google suppresses it after a dismissal, and
 * shows nothing at all to a visitor with no Google session. That is exactly
 * why the header also carries an explicit button — this component can never be
 * the only way to sign in.
 */
export function GoogleOneTap() {
  useEffect(() => {
    // React 18+ development remounts effects, and `prompt()` twice in one
    // document triggers Google's own suppression. Aborting on cleanup keeps the
    // second mount from prompting over the first.
    const controller = new AbortController();

    async function start(): Promise<void> {
      // Google has no idea we already have a session, so without this an
      // already-signed-in reader keeps being prompted — and picking a different
      // Google account would silently REPLACE the session they came with.
      const session = await fetch("/api/auth/session", {
        signal: controller.signal,
      });
      if (session.ok) {
        const { signedIn } = (await session.json()) as { signedIn?: boolean };
        if (signedIn) return;
      }
      if (controller.signal.aborted) return;

      const clientId = await ensureGoogleIdentity();
      if (!clientId || controller.signal.aborted || !window.google) return;

      window.google.accounts.id.prompt();
    }

    void start().catch(() => {
      // See above: a prompt that cannot appear is not an error to surface.
    });

    return () => {
      controller.abort();
      window.google?.accounts.id.cancel();
    };
  }, []);

  return null;
}
