// @input  -- a click on any sign-out control
// @output -- cleared cookies, cleared Web Storage, and a reloaded page
// @pos    -- shared by the header account menu and the mobile sheet
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { clearOnPageStorage } from "../../lib/on-page-checker/storage.ts";

/** Web Storage can throw on access alone; a refusal is the same as empty. */
function readableStorage(
  kind: "localStorage" | "sessionStorage",
): Storage | null {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

/**
 * End the session and re-render against the cleared cookies.
 *
 * A full reload rather than local state: the cookie is what the server reads,
 * and every other surface on the page that asked about the session did so in a
 * mount-only effect. Flipping one component's state would leave the rest
 * believing the session still exists.
 */
export async function signOut(): Promise<void> {
  const result = await fetch("/api/auth/sign-out", { method: "POST" });
  if (!result.ok) return;
  // The endpoint clears cookies. Anything this site left in Web Storage is
  // still here, and on a shared machine that is the previous person's URLs and
  // queries sitting on the page for whoever signs in next. Cleared before the
  // reload, because after it this component is gone.
  clearOnPageStorage(
    readableStorage("localStorage"),
    readableStorage("sessionStorage"),
  );
  window.location.reload();
}
