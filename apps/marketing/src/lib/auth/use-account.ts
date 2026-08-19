// @input  -- /api/auth/profile and /api/credits/balance
// @output -- one tri-state answer about who is signed in, shared by the header
// @pos    -- the single source the header's sign-in and account controls read
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useEffect, useState } from "react";

export interface AccountBalance {
  readonly total: number;
  readonly welfareRemaining: number | null;
}

/**
 * Three states, not two.
 *
 * "unknown" is the first moment after hydration, before the answer arrives.
 * Collapsing it into signed-out would flash a sign-in button at someone who is
 * already signed in, which is exactly what the header used to avoid by holding
 * the slot empty until it knew.
 */
export type AccountState =
  | { readonly status: "unknown" }
  | { readonly status: "signed-out" }
  | {
      readonly status: "signed-in";
      readonly email: string | null;
      /** Google's photo, a sign-in-time snapshot; null for accounts without one. */
      readonly avatarUrl: string | null;
      readonly balance: AccountBalance | null;
    };

/**
 * Only what the header draws.
 *
 * A balance is a number the reader will act on, so a body missing it yields
 * null rather than zero — zero is a real balance and claiming one the account
 * may not have is worse than staying quiet.
 */
function readBalance(body: unknown): AccountBalance | null {
  if (body === null || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (data === null || typeof data !== "object") return null;
  const balance = (data as { balance?: unknown }).balance;
  if (balance === null || typeof balance !== "object") return null;
  const total = (balance as { total?: unknown }).total;
  if (typeof total !== "number" || !Number.isFinite(total)) return null;

  const grant = (data as { dailyGrant?: unknown }).dailyGrant;
  const remaining =
    grant !== null && typeof grant === "object"
      ? (grant as { welfareRemaining?: unknown }).welfareRemaining
      : undefined;

  return {
    total,
    welfareRemaining:
      typeof remaining === "number" && Number.isFinite(remaining)
        ? remaining
        : null,
  };
}

function readString(body: unknown, key: "email" | "avatarUrl"): string | null {
  if (body === null || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (data === null || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Ask once, for the whole header.
 *
 * The sign-in button and the account avatar are answers to the same question,
 * and asking it twice let them disagree: two independent probes could render a
 * "sign in" button beside the avatar of the account already signed in. Owning
 * the state above both is what makes that unrepresentable.
 *
 * Identity and balance are two requests on purpose. /api/credits/balance is 404
 * while the credits switch is off, and the menu still has to name the account
 * and offer sign-out in that state, so the menu cannot be hostage to that flag.
 */
export function useAccount(): AccountState {
  const [state, setState] = useState<AccountState>({ status: "unknown" });

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      const answer = await fetch("/api/auth/profile", {
        signal: controller.signal,
      }).catch(() => null);
      if (controller.signal.aborted) return;

      // An unreachable endpoint reads as signed out, which is the same
      // fallback the header has always used: offering sign-in is never harmful,
      // it degrades to the app's own login page.
      if (answer === null || !answer.ok) {
        setState({ status: "signed-out" });
        return;
      }

      const profile = await answer.json().catch(() => null);
      if (controller.signal.aborted) return;
      const email = readString(profile, "email");
      const avatarUrl = readString(profile, "avatarUrl");
      setState({ status: "signed-in", email, avatarUrl, balance: null });

      const credits = await fetch("/api/credits/balance", {
        signal: controller.signal,
      }).catch(() => null);
      if (controller.signal.aborted || credits === null || !credits.ok) return;
      const balance = readBalance(await credits.json().catch(() => null));
      if (controller.signal.aborted) return;
      setState({ status: "signed-in", email, avatarUrl, balance });
    }

    void load();
    return () => controller.abort();
  }, []);

  return state;
}
