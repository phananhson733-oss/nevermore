// @input  -- the page locale, this person's submitted accounts; POST /api/tasks/accounts, DELETE /api/tasks/accounts/<id>
// @output -- the account list with each one's whitelisting status, a TikTok/Facebook submit form, and withdraw for accounts still waiting for review
// @pos    -- the 账号报白 section of /promotions
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useState } from "react";

import {
  ACCOUNT_PLATFORMS,
  ACCOUNT_STATUSES,
  type AccountPlatform,
  type AccountStatus,
} from "../../lib/task-center/contracts.ts";
import { CHANNEL_LABELS, formatDay, taskCopy } from "../../lib/task-center/copy.ts";

export interface AccountView {
  readonly id: string;
  readonly platform: AccountPlatform;
  readonly handle: string;
  readonly status: AccountStatus;
  readonly submittedAt: string;
}

function readAccount(body: unknown): AccountView | null {
  const account = (body as { data?: { account?: Record<string, unknown> } } | null)?.data?.account;
  if (
    account === undefined ||
    typeof account.id !== "string" ||
    typeof account.handle !== "string" ||
    typeof account.submittedAt !== "string" ||
    !ACCOUNT_PLATFORMS.includes(account.platform as AccountPlatform) ||
    !ACCOUNT_STATUSES.includes(account.status as AccountStatus)
  ) {
    return null;
  }
  return {
    id: account.id,
    platform: account.platform as AccountPlatform,
    handle: account.handle,
    status: account.status as AccountStatus,
    submittedAt: account.submittedAt,
  };
}

const STATUS_TONE: Readonly<Record<AccountStatus, string>> = {
  submitted: "text-text-dark-secondary",
  whitelisted: "text-brand-success",
  rejected: "text-brand-error",
};

export function AccountsPanel({
  locale,
  initialAccounts,
}: {
  locale: string;
  initialAccounts: readonly AccountView[];
}) {
  const copy = taskCopy(locale);
  const [accounts, setAccounts] = useState<readonly AccountView[]>(initialAccounts);
  const [platform, setPlatform] = useState<AccountPlatform>("tiktok");
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (handle.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/tasks/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform, handle: handle.trim() }),
      });
      const body: unknown = await response.json().catch(() => null);
      const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
      const view = response.ok ? readAccount(body) : null;
      if (view === null) {
        setError(code === "too_many_accounts" ? copy.tooManyAccounts : copy.accountFailed);
        return;
      }
      setAccounts((current) => [...current.filter((a) => a.id !== view.id), view]);
      setHandle("");
    } catch {
      setError(copy.accountFailed);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/accounts/${id}`, { method: "DELETE" });
      if (!response.ok) {
        setError(copy.accountFailed);
        return;
      }
      setAccounts((current) => current.filter((a) => a.id !== id));
    } catch {
      setError(copy.accountFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {accounts.length === 0 ? (
        <p className="text-[14px] text-text-dark-secondary">{copy.noAccounts}</p>
      ) : (
        <ul className="divide-y divide-brand-border-card rounded-card border border-brand-border-card bg-brand-panel">
          {accounts.map((account) => (
            <li key={account.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[14px]">
              <span className="w-20 shrink-0 text-text-dark-secondary">{CHANNEL_LABELS[account.platform]}</span>
              <span className="min-w-0 flex-1 truncate text-text-dark-primary">{account.handle}</span>
              <span className={`text-[13px] ${STATUS_TONE[account.status]}`}>{copy.accountStatus[account.status]}</span>
              <span className="text-[12.5px] text-text-dark-secondary">
                {copy.submittedOn} {formatDay(account.submittedAt, locale)}
              </span>
              {account.status === "submitted" && (
                <button
                  type="button"
                  onClick={() => void withdraw(account.id)}
                  disabled={busy}
                  className="text-[13px] text-brand-accent-text hover:underline disabled:opacity-50"
                >
                  {copy.withdraw}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-end gap-3">
        <label className="text-[13px] text-text-dark-secondary">
          {copy.platform}
          <select
            value={platform}
            onChange={(event) => setPlatform(event.target.value as AccountPlatform)}
            className="mt-1 block h-10 rounded-[10px] border border-brand-border-card bg-brand-bg px-3 text-[14px] text-text-dark-primary"
          >
            {ACCOUNT_PLATFORMS.map((value) => (
              <option key={value} value={value}>
                {CHANNEL_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 flex-1 text-[13px] text-text-dark-secondary sm:min-w-72">
          {copy.accountHandle}
          <input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            maxLength={200}
            required
            className="mt-1 block h-10 w-full rounded-[10px] border border-brand-border-card bg-brand-bg px-3 text-[14px] text-text-dark-primary"
          />
        </label>
        <button
          type="submit"
          disabled={busy || handle.trim() === ""}
          className="h-10 rounded-[10px] bg-primary px-5 text-[14px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? copy.submitting : copy.submitAccount}
        </button>
      </form>
      {error !== null && (
        <p role="alert" className="text-[13px] text-brand-error">
          {error}
        </p>
      )}
    </div>
  );
}
