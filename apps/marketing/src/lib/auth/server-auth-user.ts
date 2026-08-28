// @input  -- the server Supabase client's verified getUser result
// @output -- the verified user id and email, or a tri-state that keeps an outage apart from a sign-out
// @pos    -- the identity boundary server-side per-user records are keyed on

import { createServerSupabaseClient } from "../supabase/server.ts";

export type ServerAuthenticatedUser =
  | {
      readonly status: "authenticated";
      readonly userId: string;
      /**
       * Null when the identity provider gave us none. Supabase types email as
       * optional and a session can legitimately carry no address, so callers
       * that display it must have somewhere to put "we do not know" — printing
       * an empty string where an account name belongs is worse than printing
       * nothing.
       */
      readonly email: string | null;
      /**
       * Google's stable provider subject from the verified Supabase identity.
       *
       * Null for non-Google accounts and any malformed or ambiguous identity
       * set. Optional on injected legacy fixtures; authorization callers must
       * require a nonempty exact match before joining this identity to Google
       * credentials held in another cookie.
       */
      readonly googleSubject?: string | null;
      /** Provider-supplied display name, bounded and normalized for UI only. */
      readonly displayName?: string | null;
      /**
       * The Google profile photo, or null.
       *
       * A snapshot, not a live value: GoTrue writes raw_user_meta_data during
       * signInWithIdToken and nothing in this app re-reads the claims
       * afterwards, so a visitor who changes their photo keeps seeing the old
       * one here until they sign in again. Tolerable because it decorates a row
       * the email already identifies — but it is why nothing important may be
       * derived from it.
       */
      readonly avatarUrl: string | null;
    }
  | { readonly status: "unauthenticated" }
  | { readonly status: "unavailable" };

/**
 * Google's own photo host, and only that.
 *
 * The value arrives in an OAuth claim, but it is stored in a mutable metadata
 * column and it ends up as a URL the visitor's browser fetches. Pinning the
 * host means a poisoned row can point at an image nobody serves, rather than at
 * an endpoint of the poisoner's choosing.
 *
 * A suffix check rather than equality: Google serves these from lh3 today and
 * has used lh4/lh5/lh6. The leading dot is what keeps
 * "evilgoogleusercontent.com" out.
 */
function isGooglePhotoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".googleusercontent.com")
    );
  } catch {
    return false;
  }
}

function readAvatarUrl(metadata: unknown): string | null {
  if (metadata === null || typeof metadata !== "object") return null;
  const bag = metadata as Readonly<Record<string, unknown>>;
  // Google fills both; other providers may fill only one.
  for (const key of ["avatar_url", "picture"]) {
    const candidate = bag[key];
    if (typeof candidate === "string" && isGooglePhotoUrl(candidate)) {
      return candidate;
    }
  }
  return null;
}

function readDisplayName(metadata: unknown): string | null {
  if (metadata === null || typeof metadata !== "object") return null;
  const bag = metadata as Readonly<Record<string, unknown>>;
  for (const key of ["full_name", "name"]) {
    const value = bag[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim().replace(/\s+/gu, " ");
    if (
      normalized !== "" &&
      normalized.length <= 160 &&
      !Array.from(normalized).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })
    ) {
      return normalized;
    }
  }
  return null;
}

const MAX_GOOGLE_SUBJECT_LENGTH = 255;

function boundedGoogleSubject(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_GOOGLE_SUBJECT_LENGTH ||
    value.trim() !== value ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        character.trim() === "" || codePoint <= 0x1f || codePoint === 0x7f
      );
    })
  ) {
    return null;
  }
  return value;
}

/**
 * Read the provider subject from Supabase's verified identity rows only.
 *
 * `user_metadata` is intentionally not an input: the user can edit it. A
 * Google identity supplies the provider id twice (`id` and
 * `identity_data.sub`); both must be present, bounded and identical. More than
 * one Google row is ambiguous even when it repeats the same value, so the join
 * fails closed rather than guessing which row is authoritative.
 */
function readGoogleSubject(identities: unknown): string | null {
  if (!Array.isArray(identities)) return null;
  let subject: string | null = null;
  for (const identity of identities) {
    if (
      typeof identity !== "object" ||
      identity === null ||
      Array.isArray(identity)
    ) {
      return null;
    }
    const record = identity as Readonly<Record<string, unknown>>;
    if (typeof record.provider !== "string") return null;
    if (record.provider !== "google") continue;
    if (subject !== null) return null;

    const id = boundedGoogleSubject(record.id);
    const identityData = record.identity_data;
    if (
      id === null ||
      typeof identityData !== "object" ||
      identityData === null ||
      Array.isArray(identityData)
    ) {
      return null;
    }
    const sub = boundedGoogleSubject(
      (identityData as Readonly<Record<string, unknown>>).sub,
    );
    if (sub === null || sub !== id) return null;
    subject = id;
  }
  return subject;
}

function isMissingSessionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as Readonly<Record<string, unknown>>;
  return (
    candidate.name === "AuthSessionMissingError" && candidate.status === 400
  );
}

/**
 * Verify the current user while keeping "no session" distinct from an auth
 * service or configuration failure. Supabase auth-js 2.110.7 uses this exact
 * named/status error for an absent session; every other error fails closed as
 * unavailable instead of being mislabeled as signed out.
 *
 * The id is only ever the one the auth server verified. A caller keying
 * per-user records on it must be able to tell "nobody is signed in" from "we
 * could not ask", because the two demand opposite responses: one is a normal
 * anonymous visitor, the other must not be written against at all.
 */
export async function getServerAuthenticatedUser(): Promise<ServerAuthenticatedUser> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error !== null) {
      return user === null && isMissingSessionError(error)
        ? { status: "unauthenticated" }
        : { status: "unavailable" };
    }
    if (user === null) return { status: "unauthenticated" };
    return {
      status: "authenticated",
      userId: user.id,
      email:
        typeof user.email === "string" && user.email !== "" ? user.email : null,
      googleSubject: readGoogleSubject(user.identities),
      displayName: readDisplayName(user.user_metadata),
      avatarUrl: readAvatarUrl(user.user_metadata),
    };
  } catch {
    return { status: "unavailable" };
  }
}
