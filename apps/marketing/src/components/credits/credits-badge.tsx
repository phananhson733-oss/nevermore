// @input  -- GET /api/credits/balance and the credits.badge.* copy
// @output -- a header link showing the balance, or nothing at all
// @pos    -- the credits entry point from every page of the marketing site
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

// Relative with an explicit extension: the shared Vitest config maps `@/` to
// apps/web only, so an aliased import would not resolve from the unit project.
import { localePath } from "../../lib/locale-path.ts";

interface BalanceSnapshot {
  readonly total: number;
  readonly grantedToday: boolean;
}

/**
 * Reads only what the badge draws, and refuses anything it cannot draw.
 *
 * A balance is a number the reader will act on, so a body missing it is not
 * rendered as zero — zero is a real balance and claiming one the account may
 * not have is worse than showing nothing.
 */
function readSnapshot(body: unknown): BalanceSnapshot | null {
  if (body === null || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (data === null || typeof data !== "object") return null;
  const balance = (data as { balance?: unknown }).balance;
  if (balance === null || typeof balance !== "object") return null;
  const total = (balance as { total?: unknown }).total;
  if (typeof total !== "number" || !Number.isFinite(total)) return null;
  const dailyGrant = (data as { dailyGrant?: unknown }).dailyGrant;
  const grantedToday =
    dailyGrant !== null &&
    typeof dailyGrant === "object" &&
    (dailyGrant as { grantedToday?: unknown }).grantedToday === true;
  return { total, grantedToday };
}

/**
 * The header's credits badge.
 *
 * Every non-2xx answer renders nothing, and so does a request that never
 * returns: the endpoint is 404 while the feature switch is off, 401 for the
 * anonymous majority of this site's readers, and 503 while the owner has not
 * applied the migration. A badge that announced any of those would turn a
 * marketing page into an error report about a feature the reader never asked
 * for.
 *
 * The balance is fetched after hydration rather than read on the server for the
 * same reason the sign-in control is: reading the session during render would
 * opt every statically generated marketing page into dynamic rendering.
 */
export function CreditsBadge() {
  const t = useTranslations("credits.badge");
  const locale = useLocale();
  const [snapshot, setSnapshot] = useState<BalanceSnapshot | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/credits/balance", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (controller.signal.aborted) return;
        const next = readSnapshot(body);
        if (next !== null) setSnapshot(next);
      })
      .catch(() => {
        // An unreachable endpoint leaves the badge hidden, which is already the
        // state it is in.
      });
    return () => controller.abort();
  }, []);

  if (snapshot === null) return null;

  return (
    <Link
      href={localePath(locale, "/account/credits")}
      className="hidden h-9.5 items-center gap-2 rounded-card border border-brand-border-card bg-brand-panel-raised px-3 text-[13px] text-text-dark-secondary transition-colors hover:border-brand-accent/40 hover:text-text-dark-primary md:inline-flex"
    >
      {t("label")}
      <span className="font-mono text-[13px] text-text-dark-primary">
        {snapshot.total}
      </span>
      {snapshot.grantedToday ? (
        <>
          {/* The dot is the whole visual signal, so the state it stands for has
              to be said in words for anyone who cannot see it. */}
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-brand-accent"
          />
          <span className="sr-only">{t("checkedIn")}</span>
        </>
      ) : null}
    </Link>
  );
}
