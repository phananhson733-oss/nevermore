import type { SignInState } from "@/lib/auth/action-state";

export function loginErrorMessageKey(
  state: SignInState,
): "signInError" | null {
  return state.errorCode !== null ? "signInError" : null;
}
