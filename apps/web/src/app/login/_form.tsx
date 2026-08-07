"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, TextInput } from "@/components/ui";
import { signInAction, signInWithGoogleAction } from "@/lib/auth/actions";
import { type SignInState } from "@/lib/auth/action-state";
import { loginErrorMessageKey } from "./_form-state";
import styles from "./login.module.css";

const INITIAL_STATE: SignInState = { errorCode: null };

/**
 * Email/password sign-in form (client). Wraps the `signInAction` server action
 * with `useActionState`; on success the action redirects, so this component only
 * renders the pending + error states. The error is announced via `role="alert"`.
 */
export function LoginForm({ next }: { readonly next: string }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(signInAction, INITIAL_STATE);
  const errorMessageKey = loginErrorMessageKey(state);

  return (
    <>
      {/*
        A separate form: this posts to the OAuth action, which redirects to
        Google. Nesting it inside the credential form would submit the email and
        password fields to an action that has no use for them.
      */}
      <form action={signInWithGoogleAction} className={styles.oauthForm}>
        <input type="hidden" name="next" value={next} />
        <Button
          type="submit"
          variant="secondary"
          className={styles.oauthButton}
        >
          <GoogleMark />
          {t("continueWithGoogle")}
        </Button>
      </form>

      <div className={styles.divider} role="separator">
        <span>{t("orDivider")}</span>
      </div>

      <form action={action} className={styles.form}>
        <Field label={t("emailLabel")}>
          <TextInput type="email" name="email" autoComplete="email" required />
        </Field>

        <Field label={t("passwordLabel")}>
          <TextInput
            type="password"
            name="password"
            autoComplete="current-password"
            required
          />
        </Field>

        <input type="hidden" name="next" value={next} />

        {errorMessageKey ? (
          <p className={styles.error} role="alert">
            {t(errorMessageKey)}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          className={styles.submit}
          disabled={pending}
        >
          {pending ? t("signingIn") : t("signInButton")}
        </Button>
      </form>
    </>
  );
}

/** Google's mark, inlined so the button needs no network request. */
function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 18 18"
      className={styles.googleMark}
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
