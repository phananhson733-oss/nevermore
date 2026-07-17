"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Supabase Auth server actions (spec §14.1). Sign-in rotates the session cookie
 * (HttpOnly/Secure/SameSite=Lax, written by the @supabase/ssr client). The
 * post-login redirect target is validated to be a same-origin path so it can't
 * be turned into an open redirect.
 */

export interface SignInState {
  readonly error: string | null;
}

function safeNext(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw : "";
  // Only same-origin absolute paths; never a scheme-relative "//host" redirect.
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

/** `useActionState`-compatible email/password sign-in. */
export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  const next = safeNext(formData.get("next"));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Do not leak provider internals; a generic message avoids user enumeration.
    return { error: "Invalid email or password." };
  }
  redirect(next);
}

/** Sign out and return to the login screen. */
export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
