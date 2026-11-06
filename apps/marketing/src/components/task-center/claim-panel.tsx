// @input  -- drama id, whether the visitor is signed in, the link they already hold, POST /api/tasks/<id>/claim
// @output -- one "get my link" button; once claimed, the promo link and code with copy buttons
// @pos    -- the claim step on /tasks/<id>
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useState } from "react";

import { taskCopy } from "../../lib/task-center/copy.ts";
import { CopyRow } from "./copy-row.tsx";

export interface LinkView {
  readonly code: string;
  readonly link: string;
}

function readClaim(body: unknown): LinkView | null {
  const claim = (body as { data?: { claim?: Record<string, unknown> } } | null)?.data?.claim;
  if (claim === undefined || typeof claim.code !== "string" || typeof claim.link !== "string") {
    return null;
  }
  return { code: claim.code, link: claim.link };
}

/**
 * One button, one link: claiming is a POST, never a side effect of opening
 * the page, so prefetching a drama never hands out a code.
 */
export function ClaimPanel({
  dramaId,
  locale,
  signedIn,
  signInHref,
  initialLink,
}: {
  dramaId: string;
  locale: string;
  signedIn: boolean;
  signInHref: string;
  initialLink: LinkView | null;
}) {
  const copy = taskCopy(locale);
  const [held, setHeld] = useState<LinkView | null>(initialLink);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

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

  if (held !== null) {
    return (
      <div className="max-w-xl space-y-2 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 text-[13.5px]">
        <CopyRow label={copy.yourLink} value={held.link} locale={locale} />
        <CopyRow label={copy.yourCode} value={held.code} locale={locale} />
      </div>
    );
  }

  async function claim(): Promise<void> {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/tasks/${dramaId}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (response.status === 401) {
        window.location.assign(signInHref);
        return;
      }
      const view = response.ok ? readClaim(await response.json().catch(() => null)) : null;
      if (view === null) setFailed(true);
      else setHeld(view);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void claim()}
        disabled={pending}
        className="h-10 rounded-[10px] bg-primary px-5 text-[14px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? copy.claiming : copy.getLink}
      </button>
      {failed && (
        <p role="alert" className="mt-2 text-[13px] text-brand-error">
          {copy.claimFailed}
        </p>
      )}
    </div>
  );
}
