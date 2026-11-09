// @input  -- drama id, where its reader page is, the link's heading level, whether the visitor is signed in, the link they already hold, POST /api/tasks/<id>/claim
// @output -- the drama's promo link as a titled block (短剧推广链接, which opens the drama's page on our site): empty with one "get my link" button (or a sign-in link) until claimed, then the link with a copy button, focus moved to it; a link to see that page; no 口令
// @pos    -- the claim step in the clip dialog on /tasks and on /tasks/<id>
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useEffect, useRef, useState } from "react";

import { taskCopy } from "../../lib/task-center/copy.ts";
import { LinkBlock } from "./link-block.tsx";

/** Our redirect link, never the platform's own URL. */
export interface LinkView {
  /** /t/<code>: the 短剧推广链接. */
  readonly link: string;
}

function readClaim(body: unknown): LinkView | null {
  const claim = (body as { data?: { claim?: Record<string, unknown> } } | null)?.data?.claim;
  if (claim === undefined || typeof claim.link !== "string") return null;
  return { link: claim.link };
}

/**
 * Claiming is a POST, never a side effect of opening the page, so prefetching
 * a drama never hands out a code.
 */
export function ClaimPanel({
  dramaId,
  watchHref,
  locale,
  signedIn,
  signInHref,
  initialLink,
  onClaimed,
  linkLevel = 4,
}: {
  dramaId: string;
  /** /watch/<id>: the page the link opens, so a promoter can see what readers get. */
  watchHref: string;
  locale: string;
  signedIn: boolean;
  signInHref: string;
  initialLink: LinkView | null;
  /** Lets a parent that outlives this panel (the clip dialog) remember the claim. */
  onClaimed?: (view: LinkView) => void;
  /** 3 when the panel sits straight under a page's h2, 4 under the dialog's h3. */
  linkLevel?: 3 | 4;
}) {
  const copy = taskCopy(locale);
  const [held, setHeld] = useState<LinkView | null>(initialLink);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // The claim button goes away once it works, and focus with it: keyboard and
  // screen reader users land on the link's copy button instead.
  const firstCopy = useRef<HTMLButtonElement>(null);
  const focusLinks = useRef(false);

  useEffect(() => {
    if (held === null || !focusLinks.current) return;
    focusLinks.current = false;
    firstCopy.current?.focus();
  }, [held]);

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
      if (view === null) {
        setFailed(true);
      } else {
        focusLinks.current = true;
        setHeld(view);
        onClaimed?.(view);
      }
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <LinkBlock
        title={copy.dramaLink}
        body={copy.dramaLinkBody}
        value={held?.link ?? null}
        locale={locale}
        level={linkLevel}
        copyRef={firstCopy}
      />
      <p className="text-[13px]">
        <a href={watchHref} target="_blank" rel="noopener" className="text-brand-accent-text hover:underline">
          {copy.previewPage} →
        </a>
      </p>
      {held === null &&
        (!signedIn ? (
          <p className="text-[14px] text-text-dark-secondary">
            {copy.signInToPromote}{" "}
            <a href={signInHref} className="font-medium text-brand-accent-text hover:underline">
              {copy.signIn}
            </a>
          </p>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => void claim()}
              disabled={pending}
              className="h-10 w-full rounded-[10px] bg-primary px-5 text-[14px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 sm:w-auto"
            >
              {pending ? copy.claiming : copy.getLink}
            </button>
            {failed && (
              <p role="alert" className="mt-2 text-[13px] text-brand-error">
                {copy.claimFailed}
              </p>
            )}
          </div>
        ))}
    </div>
  );
}
