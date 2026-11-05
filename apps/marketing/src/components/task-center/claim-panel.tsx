// @input  -- drama id, whether the visitor is signed in, the claims they already hold, POST /api/tasks/<id>/claim
// @output -- four channel buttons; a claimed channel shows its promo link and code with copy buttons
// @pos    -- the claim step on /tasks/<id>
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useState } from "react";

import { PROMO_CHANNELS, type PromoChannel } from "../../lib/task-center/contracts.ts";
import { CHANNEL_LABELS, taskCopy } from "../../lib/task-center/copy.ts";

export interface ClaimView {
  readonly channel: PromoChannel;
  readonly code: string;
  readonly link: string;
}

function readClaim(body: unknown): ClaimView | null {
  const claim = (body as { data?: { claim?: Record<string, unknown> } } | null)?.data?.claim;
  if (
    claim === undefined ||
    typeof claim.code !== "string" ||
    typeof claim.link !== "string" ||
    !PROMO_CHANNELS.includes(claim.channel as PromoChannel)
  ) {
    return null;
  }
  return { channel: claim.channel as PromoChannel, code: claim.code, link: claim.link };
}

export function ClaimPanel({
  dramaId,
  locale,
  signedIn,
  signInHref,
  initialClaims,
}: {
  dramaId: string;
  locale: string;
  signedIn: boolean;
  signInHref: string;
  initialClaims: readonly ClaimView[];
}) {
  const copy = taskCopy(locale);
  const [claims, setClaims] = useState<readonly ClaimView[]>(initialClaims);
  const [pending, setPending] = useState<PromoChannel | null>(null);
  const [failed, setFailed] = useState<PromoChannel | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <p className="text-[14px] text-text-dark-secondary">
        {copy.signInToPromote}{" "}
        <a href={signInHref} className="font-medium text-brand-accent-text hover:underline">
          {copy.signIn}
        </a>
      </p>
    );
  }

  async function claim(channel: PromoChannel): Promise<void> {
    setPending(channel);
    setFailed(null);
    try {
      const response = await fetch(`/api/tasks/${dramaId}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      if (response.status === 401) {
        window.location.assign(signInHref);
        return;
      }
      const view = response.ok ? readClaim(await response.json().catch(() => null)) : null;
      if (view === null) {
        setFailed(channel);
        return;
      }
      setClaims((current) => [...current.filter((c) => c.channel !== view.channel), view]);
    } catch {
      setFailed(channel);
    } finally {
      setPending(null);
    }
  }

  async function copyText(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied((current) => (current === value ? null : current)), 2_000);
    } catch {
      // Clipboard can be blocked; the text is on screen and selectable.
    }
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {PROMO_CHANNELS.map((channel) => {
        const held = claims.find((c) => c.channel === channel);
        const label = CHANNEL_LABELS[channel];
        return (
          <li key={channel} className="rounded-[10px] border border-brand-border-card bg-brand-bg p-4">
            {held === undefined ? (
              <>
                <button
                  type="button"
                  onClick={() => void claim(channel)}
                  disabled={pending !== null}
                  className="h-10 w-full rounded-[10px] bg-primary px-4 text-[14px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {pending === channel ? copy.claiming : copy.claim(label)}
                </button>
                {failed === channel && (
                  <p role="alert" className="mt-2 text-[13px] text-brand-error">
                    {copy.claimFailed}
                  </p>
                )}
              </>
            ) : (
              <div className="space-y-2 text-[13.5px]">
                <p className="font-medium text-text-dark-primary">{label}</p>
                <CopyRow label={copy.yourLink} value={held.link} copied={copied === held.link} copy={copy} onCopy={copyText} />
                <CopyRow label={copy.yourCode} value={held.code} copied={copied === held.code} copy={copy} onCopy={copyText} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CopyRow({
  label,
  value,
  copied,
  copy,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  copy: ReturnType<typeof taskCopy>;
  onCopy: (value: string) => Promise<void>;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-text-dark-secondary">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded-[6px] bg-brand-panel px-2 py-1 font-mono text-[12.5px] text-text-dark-primary select-all">
        {value}
      </code>
      <button
        type="button"
        onClick={() => void onCopy(value)}
        className="shrink-0 text-brand-accent-text hover:underline"
      >
        {copied ? copy.copied : copy.copy}
      </button>
    </div>
  );
}
