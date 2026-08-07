/**
 * Map the `error` marker the OAuth callback puts in the query string onto a
 * translation key.
 *
 * The value is attacker-controlled — anyone can link to `/login?error=…` — so
 * this is an allowlist rather than a lookup. An unknown marker renders nothing,
 * which is the honest outcome: we do not know that anything failed.
 */
export type OAuthErrorKey = "oauthError" | "oauthDenied";

export function oauthErrorMessageKey(raw: unknown): OAuthErrorKey | null {
  if (raw === "oauth") return "oauthError";
  if (raw === "oauth_denied") return "oauthDenied";
  return null;
}
