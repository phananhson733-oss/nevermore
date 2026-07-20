export const SIGN_IN_ERROR_CODE = "SIGN_IN_ERROR" as const;

export interface SignInState {
  readonly errorCode: typeof SIGN_IN_ERROR_CODE | null;
}

export function signInFailed(): SignInState {
  return { errorCode: SIGN_IN_ERROR_CODE };
}
