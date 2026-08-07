// @input  -- /api/auth/one-tap/nonce, /api/auth/one-tap, Google Identity Services
// @output — one initialised GSI instance per document, shared by every mount
// @pos    -- browser-side plumbing behind GoogleOneTap and GoogleSignInButton
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

const GSI_SRC = "https://accounts.google.com/gsi/client";
const GSI_SCRIPT_ID = "google-identity-services";

interface CredentialResponse {
  readonly credential?: string;
}

/** Only the members we actually call. */
export interface GoogleIdentityServices {
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
      renderButton(
        parent: HTMLElement,
        options: {
          type?: "standard" | "icon";
          theme?: "outline" | "filled_blue" | "filled_black";
          size?: "large" | "medium" | "small";
          text?: "signin_with" | "signup_with" | "continue_with" | "signin";
          shape?: "rectangular" | "pill" | "circle" | "square";
          logo_alignment?: "left" | "center";
          width?: number;
          locale?: string;
        },
      ): void;
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

/** Hand a credential to the server, and reload if it became a session. */
async function submitCredential(credential: string): Promise<void> {
  const result = await fetch("/api/auth/one-tap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  if (!result.ok) return;

  // A full reload, not router.refresh(). The session lives in cookies the
  // server just wrote, but the header's sign-in control is a client component
  // that read its state in a mount-only effect — an RSC refresh preserves that
  // state and re-runs no effect, so the header would keep offering "Sign in"
  // to someone who just signed in. Reloading re-mounts everything against the
  // new cookies.
  window.location.reload();
}

let pending: Promise<string | null> | null = null;

/**
 * Initialise Google Identity Services once, and answer with the client id.
 *
 * Memoised deliberately, and not merely as an optimisation.
 *
 * `/api/auth/one-tap/nonce` seals the raw nonce in a single cookie, so the jar
 * holds exactly one at a time. Two mounts each fetching their own would leave
 * the second one's nonce in the cookie and the first one's in Google's hands —
 * and that first credential would then be rejected by the very replay check
 * the nonce exists to provide. `google.accounts.id.initialize` is likewise
 * per-document global state: calling it twice reconfigures the singleton.
 *
 * So One Tap and the button share one nonce and one initialisation. Whichever
 * mounts first pays for it; the other awaits the same promise.
 *
 * Resolves to null when One Tap is not configured, the script is blocked, or
 * the nonce cannot be issued. Every caller treats that as "offer the ordinary
 * sign-in link instead", never as an error to surface.
 */
export function ensureGoogleIdentity(): Promise<string | null> {
  pending ??= start().catch(() => {
    // A failed attempt must not poison later ones: a visitor who opens the
    // sign-in panel after a transient network failure deserves a fresh try.
    pending = null;
    return null;
  });
  return pending;
}

async function start(): Promise<string | null> {
  const response = await fetch("/api/auth/one-tap/nonce");
  if (!response.ok) {
    pending = null;
    return null;
  }

  const { clientId, nonce } = (await response.json()) as {
    clientId?: string;
    nonce?: string;
  };
  if (!clientId || !nonce) {
    pending = null;
    return null;
  }

  await loadGsi();
  if (!window.google) {
    pending = null;
    return null;
  }

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
      void submitCredential(credential).catch(() => {
        // Same reasoning as everywhere else here: a sign-in that cannot
        // complete leaves the page as it was, rather than raising an error at
        // someone who was only reading a blog post.
      });
    },
  });

  return clientId;
}

/** Test seam: forget the memoised initialisation. */
export function resetGoogleIdentityForTests(): void {
  pending = null;
}
