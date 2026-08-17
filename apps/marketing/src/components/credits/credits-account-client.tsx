// @input  -- /api/credits/balance, /api/credits/ledger and the credits.account.* copy
// @output -- balance, daily check-in, invite link and paged history for one visitor
// @pos    -- the whole body of /account/credits
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

// Relative with an explicit extension: the shared Vitest config maps `@/` to
// apps/web only, so an aliased import would not resolve from the unit project.
import { siteConfig } from "../../config/site.ts";
import { CREDITS_SETTINGS_SEED } from "../../lib/credits/credits-config.ts";

interface AccountSnapshot {
  readonly total: number;
  readonly grantedToday: boolean;
  /** Null when the answer did not carry it; the line is dropped rather than guessed. */
  readonly dailyAmount: number | null;
  readonly welfareRemaining: number | null;
  readonly welfareCap: number;
  readonly referralCode: string;
  readonly rewardedCount: number;
  readonly referralCap: number;
}

interface HistoryEntry {
  readonly id: string;
  readonly type: string;
  readonly amount: number;
  readonly balanceAfter: number;
  readonly createdAt: string;
}

type Phase = "loading" | "signed-out" | "unavailable" | "ready";

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The balance and the invite code are what this page exists to show, so a body
 * missing either is treated as no answer at all. Everything else degrades to a
 * line that is simply not drawn — a missing number rendered as 0 would be a
 * claim about the account, not an absence of one.
 */
function readSnapshot(body: unknown): AccountSnapshot | null {
  const data = record(record(body)?.data);
  const balance = record(data?.balance);
  const dailyGrant = record(data?.dailyGrant);
  const referral = record(data?.referral);
  const total = finiteNumber(balance?.total);
  const code = typeof referral?.code === "string" ? referral.code : "";
  if (total === null || code === "") return null;
  return {
    total,
    grantedToday: dailyGrant?.grantedToday === true,
    dailyAmount: finiteNumber(dailyGrant?.amount),
    welfareRemaining: finiteNumber(dailyGrant?.welfareRemaining),
    // Both caps prefer the live answer and keep the seed only as a fallback:
    // credit_settings is edited in production without a deploy, and a compiled
    // -in number printed next to a live one is how "980 of 600" happens.
    welfareCap:
      finiteNumber(dailyGrant?.welfareCap) ??
      CREDITS_SETTINGS_SEED.welfareAccrualCap,
    referralCode: code,
    rewardedCount: finiteNumber(referral?.rewardedCount) ?? 0,
    referralCap:
      finiteNumber(referral?.cap) ?? CREDITS_SETTINGS_SEED.referralInviterCap,
  };
}

function readEntry(value: unknown): HistoryEntry | null {
  const row = record(value);
  const amount = finiteNumber(row?.amount);
  const balanceAfter = finiteNumber(row?.balanceAfter);
  if (row === null || amount === null || balanceAfter === null) return null;
  if (typeof row.id !== "string" || typeof row.createdAt !== "string") {
    return null;
  }
  return {
    id: row.id,
    type: typeof row.type === "string" ? row.type : "",
    amount,
    balanceAfter,
    createdAt: row.createdAt,
  };
}

function readHistoryPage(
  body: unknown,
): { entries: readonly HistoryEntry[]; nextCursor: string | null } | null {
  const data = record(record(body)?.data);
  if (data === null || !Array.isArray(data.entries)) return null;
  const entries = data.entries
    .map(readEntry)
    .filter((entry): entry is HistoryEntry => entry !== null);
  return {
    entries,
    nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
  };
}

async function ask(url: string, signal?: AbortSignal): Promise<Answer | null> {
  try {
    const response = await fetch(url, signal === undefined ? {} : { signal });
    // The status decides; the body is best effort. An error answer we cannot
    // parse is still an error that has to be classified.
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  } catch {
    return null;
  }
}

/** Puts the invite link on the clipboard, or in the visitor's selection. */
function selectContents(node: Node | null): void {
  if (node === null) return;
  const selection = window.getSelection();
  if (selection === null) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Every state that is a sentence rather than a page shares one frame. */
const NOTE_CLASS =
  "rounded-card border border-brand-border-card bg-brand-panel p-6 text-[13.5px] leading-[1.6] text-text-dark-secondary";

export function CreditsAccountClient() {
  const t = useTranslations("credits.account");
  const [phase, setPhase] = useState<Phase>("loading");
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null);
  const [entries, setEntries] = useState<readonly HistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      const [balance, history] = await Promise.all([
        ask("/api/credits/balance", controller.signal),
        ask("/api/credits/ledger", controller.signal),
      ]);
      if (controller.signal.aborted) return;

      // 401 is the ordinary state for anyone who has not signed in; 404 is the
      // feature switch being off and 503 the ledger not being there yet.
      // Neither of the last two is the visitor's problem to diagnose, so both
      // land on the same "not right now" copy.
      if (balance?.status === 401) {
        setPhase("signed-out");
        return;
      }
      const account =
        balance?.status === 200 ? readSnapshot(balance.body) : null;
      if (account === null) {
        setPhase("unavailable");
        return;
      }
      setSnapshot(account);
      setPhase("ready");

      const page =
        history?.status === 200 ? readHistoryPage(history.body) : null;
      if (page === null) {
        setHistoryFailed(true);
        return;
      }
      setEntries(page.entries);
      setCursor(page.nextCursor);
    }

    void load();
    return () => controller.abort();
  }, []);

  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore) return;
    setLoadingMore(true);
    void ask(`/api/credits/ledger?cursor=${encodeURIComponent(cursor)}`).then(
      (answer) => {
        const page =
          answer?.status === 200 ? readHistoryPage(answer.body) : null;
        if (page === null) {
          setHistoryFailed(true);
        } else {
          setEntries((current) => [...current, ...page.entries]);
          setCursor(page.nextCursor);
        }
        setLoadingMore(false);
      },
    );
  }, [cursor, loadingMore]);

  const handleCopy = useCallback(() => {
    const node = linkRef.current;
    const text = node?.textContent ?? "";
    // Refused outside a secure context and absent in some embedded browsers,
    // where selecting the link is the manual path that always exists.
    if (text === "" || navigator.clipboard === undefined) {
      selectContents(node);
      return;
    }
    void navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => selectContents(node));
  }, []);

  if (phase === "loading") {
    return <p className={NOTE_CLASS}>{t("loading")}</p>;
  }
  if (phase === "signed-out") {
    return <p className={NOTE_CLASS}>{t("signedOut")}</p>;
  }
  if (phase !== "ready" || snapshot === null) {
    return <p className={NOTE_CLASS}>{t("unavailable")}</p>;
  }

  const inviteUrl = `${siteConfig.url}/r/${snapshot.referralCode}`;

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-brand-border-card bg-brand-panel p-6 md:p-7">
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
          {t("balanceLabel")}
        </p>
        <p className="mt-3 font-mono text-[40px] leading-none text-text-dark-primary">
          {snapshot.total}
        </p>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] text-text-dark-secondary">
          {t("welfareNotice")}
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-card border border-brand-border-card bg-brand-panel-raised p-[22px]">
          <h2 className="text-[15.5px] font-semibold text-text-dark-primary">
            {t("dailyTitle")}
          </h2>
          {snapshot.dailyAmount === null ? null : (
            <p className="mt-2 text-[13px] leading-[1.6] text-text-dark-secondary">
              {snapshot.grantedToday
                ? t("dailyGranted", { amount: snapshot.dailyAmount })
                : t("dailyPending", { amount: snapshot.dailyAmount })}
            </p>
          )}
          {snapshot.welfareRemaining === null ? null : (
            <p className="mt-2 font-mono text-[11.5px] text-text-dark-faint">
              {t("welfareRemaining", {
                remaining: snapshot.welfareRemaining,
                cap: snapshot.welfareCap,
              })}
            </p>
          )}
        </section>

        <section className="rounded-card border border-brand-border-card bg-brand-panel-raised p-[22px]">
          <h2 className="text-[15.5px] font-semibold text-text-dark-primary">
            {t("referralTitle")}
          </h2>
          <p className="mt-2 text-[13px] leading-[1.6] text-text-dark-secondary">
            {t("referralBody", {
              amount: CREDITS_SETTINGS_SEED.referralReward,
            })}
          </p>
          <p
            ref={linkRef}
            className="mt-3 font-mono text-[12px] break-all text-text-dark-primary"
          >
            {inviteUrl}
          </p>
          <button
            type="button"
            onClick={handleCopy}
            className="mt-3 inline-flex h-9.5 items-center rounded-lg border border-brand-border-card px-[14px] text-[13px] text-text-dark-secondary transition-colors hover:border-brand-accent/40 hover:text-text-dark-primary"
          >
            {copied ? t("referralCopied") : t("referralCopy")}
          </button>
          <p className="mt-3 font-mono text-[11.5px] text-text-dark-faint">
            {t("referralCount", {
              count: snapshot.rewardedCount,
              cap: snapshot.referralCap,
            })}
          </p>
        </section>
      </div>

      <section className="rounded-card border border-brand-border-card bg-brand-panel p-6 md:p-7">
        <h2 className="text-[15.5px] font-semibold text-text-dark-primary">
          {t("ledgerTitle")}
        </h2>
        <HistoryList entries={entries} failed={historyFailed} />
        {cursor === null ? null : (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="mt-4 inline-flex h-9.5 items-center rounded-lg border border-brand-border-card px-[14px] text-[13px] text-text-dark-secondary transition-colors hover:border-brand-accent/40 hover:text-text-dark-primary disabled:opacity-60"
          >
            {t("ledgerMore")}
          </button>
        )}
      </section>
    </div>
  );
}

function HistoryList({
  entries,
  failed,
}: {
  readonly entries: readonly HistoryEntry[];
  readonly failed: boolean;
}) {
  const t = useTranslations("credits.account");

  if (failed) {
    return (
      <p className="mt-3 text-[13px] text-text-dark-secondary">
        {t("unavailable")}
      </p>
    );
  }
  if (entries.length === 0) {
    return (
      <p className="mt-3 text-[13px] text-text-dark-secondary">
        {t("ledgerEmpty")}
      </p>
    );
  }

  return (
    <ol className="mt-4 grid gap-px overflow-hidden rounded-row border border-brand-border-card bg-brand-border-card">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex items-baseline justify-between gap-4 bg-brand-panel-sunken px-4 py-3"
        >
          <div>
            <p className="text-[13.5px] text-text-dark-primary">
              {/* An entry type is a database enum. Printing one would show a
                  reader `referral_reward_invitee` where a reason belongs, and a
                  type added by a later migration would print itself too. */}
              {t.has(`entry.${entry.type}`)
                ? t(`entry.${entry.type}`)
                : t("entryFallback")}
            </p>
            <p className="mt-1 font-mono text-[11.5px] text-text-dark-faint">
              {entry.createdAt.slice(0, 10)}
            </p>
          </div>
          <div className="text-right">
            <p
              className={
                entry.amount < 0
                  ? "font-mono text-[13.5px] text-text-dark-secondary"
                  : "font-mono text-[13.5px] text-brand-accent-text"
              }
            >
              {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
            </p>
            <p className="mt-1 font-mono text-[11.5px] text-text-dark-faint">
              {t("ledgerBalance", { balance: entry.balanceAfter })}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
