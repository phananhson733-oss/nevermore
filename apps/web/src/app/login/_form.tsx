"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, TextInput } from "@/components/ui";
import { signInAction, type SignInState } from "@/lib/auth/actions";
import styles from "./login.module.css";

const INITIAL_STATE: SignInState = { error: null };

/**
 * Email/password sign-in form (client). Wraps the `signInAction` server action
 * with `useActionState`; on success the action redirects, so this component only
 * renders the pending + error states. The error is announced via `role="alert"`.
 */
export function LoginForm({ next }: { readonly next: string }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(signInAction, INITIAL_STATE);

  return (
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

      {state.error ? (
        <p className={styles.error} role="alert">
          {state.error || t("signInError")}
        </p>
      ) : null}

      <Button type="submit" variant="primary" className={styles.submit} disabled={pending}>
        {pending ? t("signingIn") : t("signInButton")}
      </Button>
    </form>
  );
}
