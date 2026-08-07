// @input  -- /api/auth/one-tap/nonce, Google Identity Services, /api/auth/one-tap
// @output — the Google One Tap prompt, and a page refresh once it signs in
// @pos    -- mounted only on the pages where signing in is the point (home, tools)
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useEffect } from "react";

const GSI_SRC = "https://accounts.google.com/gsi/client";
const GSI_SCRIPT_ID = "google-identity-services";

interface CredentialResponse {
  readonly credential?: string;
}

interface GoogleIdentityServices {
  readonly accounts: {
    readonly id: {
      initialize(config: {
        client_id: string;
        callback: (response: CredentialResponse) => void;
        nonce: string;
        auto_select: boolean;
        cancel_on_tap_outside: boolean;
        context: string;
        itp_support: boolean;
      }): void;
      prompt(): void;
      cancel(): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

/** Load GSI once per document, even if two mounts race. */
function loadGsi(): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(GSI_SCRIPT_ID);
    if (existing) {
      if (window.google) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("gsi")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.id = GSI_SCRIPT_ID;
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("gsi")), {
      once: true,
    });
    document.head.append(script);
  });
}

/**
 * Google One Tap.
 *
 * Deliberately silent about its own failures. Every path here is an
 * enhancement over the ordinary sign-in link: a blocked third-party script, a
 * visitor with no Google session, a deployment without a client id, or an
 * expired nonce should all end in "no prompt appeared", never in an error a
 * reader of a blog post has to dismiss.
 *
 * The nonce is fetched rather than rendered so the host page stays static; the
 * raw value never reaches this component, only its hash. See one-tap.ts.
 */
export function GoogleOneTap() {

  useEffect(() => {
    // React 18+ development remounts effects, and `prompt()` twice in one
    // document triggers Google's own suppression. Aborting on cleanup keeps the
    // second mount from initialising against a stale nonce.
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

      const response = await fetch("/api/auth/one-tap/nonce", {
        signal: controller.signal,
      });
      if (!response.ok) return;

      const { clientId, nonce } = (await response.json()) as {
        clientId?: string;
        nonce?: string;
      };
      if (!clientId || !nonce || controller.signal.aborted) return;

      await loadGsi();
      if (controller.signal.aborted || !window.google) return;

      window.google.accounts.id.initialize({
        client_id: clientId,
        nonce,
        // Never sign someone in without a deliberate tap. auto_select would
        // reinstate a session for a returning visitor who never asked.
        auto_select: false,
        cancel_on_tap_outside: true,
        context: "signin",
        itp_support: true,
        callback: (credentialResponse) => {
          const credential = credentialResponse.credential;
          if (!credential) return;
          void fetch("/api/auth/one-tap", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ credential }),
          }).then((result) => {
            if (!result.ok) return;
            // A full reload, not router.refresh(). The session lives in cookies
            // the server just wrote, but the header's sign-in control is a
            // client component that read its state in a mount-only effect —
            // an RSC refresh preserves that state and re-runs no effect, so the
            // header would keep offering "Sign in" to someone who just signed
            // in. Reloading re-mounts everything against the new cookies.
            window.location.reload();
          });
        },
      });

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
