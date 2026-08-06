import { getTranslations } from "next-intl/server";
import { Card, LocaleSwitch } from "@/components/ui";
import { safePostLoginPath } from "@/lib/auth/redirect";
import { LoginForm } from "./_form.tsx";
import { oauthErrorMessageKey } from "./_oauth-error.ts";
import styles from "./login.module.css";

/**
 * Operator sign-in (spec §4.1, §14.1). Server component: resolves a safe
 * same-origin `next` path from the query string and hands it to the client form,
 * which drives the `signInAction` server action. The redirect itself is not an
 * open-redirect vector — `next` is validated here and again in the action.
 */

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const t = await getTranslations("auth");
  const tShell = await getTranslations("appShell");
  const oauthErrorKey = oauthErrorMessageKey(error);

  return (
    <main className={styles.page}>
      <div className={styles.localeSwitch}>
        <LocaleSwitch aria-label={tShell("localeSwitch")} />
      </div>

      <Card padding="lg" className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          <span className={styles.brandWord}>GenGrowth</span>
        </div>

        <p className="sf-eyebrow">GenGrowth</p>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.subtitle}>{t("subtitle")}</p>

        {oauthErrorKey ? (
          <p className={styles.error} role="alert">
            {t(oauthErrorKey)}
          </p>
        ) : null}

        <LoginForm next={safePostLoginPath(next)} />
      </Card>
    </main>
  );
}
