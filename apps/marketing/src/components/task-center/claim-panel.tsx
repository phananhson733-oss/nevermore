// @input  -- drama id, where its reader page is, the links' heading level, whether the visitor is signed in, the links they already hold, POST /api/tasks/<id>/claim
// @output -- the drama's two promo links as titled blocks, RS Boost style: 推广链接 (/t/<code>, the drama's page on our site) and 资源推广链接 (/t/<code>/go, straight to the drama on its platform); for a signed-in visitor without them they are made as soon as this shows, with no button (a note while that runs, a retry when it fails); a sign-in link when signed out; a link to see the page the 推广链接 opens; no 口令
// @pos    -- the link step in the clip dialog on /tasks and on /tasks/<id>
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useEffect, useRef, useState } from "react";

import { taskCopy } from "../../lib/task-center/copy.ts";
import { LinkBlock } from "./link-block.tsx";

/** Our redirect links, never the platform's own URL. */
export interface LinkView {
  /** /t/<code>: the 推广链接, which opens the drama's page on our site. */
  readonly link: string;
  /** /t/<code>/go: the 资源推广链接, straight to the drama on its platform. */
  readonly resourceLink: string;
}

function readClaim(body: unknown): LinkView | null {
  const claim = (body as { data?: { claim?: Record<string, unknown> } } | null)?.data?.claim;
  if (claim === undefined || typeof claim.link !== "string" || typeof claim.resourceLink !== "string") return null;
  return { link: claim.link, resourceLink: claim.resourceLink };
}

type Status = "idle" | "pending" | "failed";

/**
 * A signed-in promoter gets their links the moment the drama is opened: the
 * claim is idempotent, so opening it again returns the same code. It is still
 * a POST from the browser, never a side effect of rendering, so a prefetch or
 * a crawler never hands out a code.
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
  /** /watch/<id>: the page the 推广链接 opens, so a promoter can see what readers get. */
  watchHref: string;
  locale: string;
  signedIn: boolean;
  signInHref: string;
  initialLink: LinkView | null;
  /** Lets a parent that outlives this panel (the clip dialog) remember the links. */
  onClaimed?: (view: LinkView) => void;
  /** 3 when the blocks sit straight under the page's or dialog's h2, 4 under an h3. */
  linkLevel?: 3 | 4;
}) {
  const copy = taskCopy(locale);
  const [held, setHeld] = useState<LinkView | null>(initialLink);
  const [status, setStatus] = useState<Status>(initialLink === null && signedIn ? "pending" : "idle");
  // The session can lapse while the page stays open; the server's 401 wins.
  const [signedOut, setSignedOut] = useState(!signedIn);
  // Once per panel: React's dev double effect and a re-render must not post twice.
  const started = useRef(false);
  // After a retry the button goes away, and focus with it: keyboard and screen
  // reader users land on the first copy button instead. An automatic claim on
  // open leaves focus where it is.
  const firstCopy = useRef<HTMLButtonElement>(null);
  const focusLinks = useRef(false);

  async function claim(): Promise<void> {
    setStatus("pending");
    try {
      const response = await fetch(`/api/tasks/${dramaId}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (response.status === 401) {
        setSignedOut(true);
        setStatus("idle");
        return;
      }
      const view = response.ok ? readClaim(await response.json().catch(() => null)) : null;
      if (view === null) {
        setStatus("failed");
        return;
      }
      setHeld(view);
      setStatus("idle");
      onClaimed?.(view);
    } catch {
      setStatus("failed");
    }
  }

  useEffect(() => {
    if (started.current || held !== null || !signedIn) return;
    started.current = true;
    void claim();
    // On mount only: `claim` reads nothing that changes while the panel shows.
  }, []);

  useEffect(() => {
    if (held === null || !focusLinks.current) return;
    focusLinks.current = false;
    firstCopy.current?.focus();
  }, [held]);

  const placeholder = signedOut ? copy.linkAfterSignIn : status === "failed" ? copy.claimFailed : copy.claiming;

  return (
    <div className="space-y-3">
      <LinkBlock
        title={copy.dramaLink}
        body={copy.dramaLinkBody}
        value={held?.link ?? null}
        placeholder={placeholder}
        locale={locale}
        level={linkLevel}
        copyRef={firstCopy}
      />
      <LinkBlock
        title={copy.resourceLink}
        body={copy.resourceLinkBody}
        value={held?.resourceLink ?? null}
        placeholder={placeholder}
        locale={locale}
        level={linkLevel}
      />
      {held === null && signedOut && (
        <p className="text-[14px] text-text-dark-secondary">
          {copy.signInToPromote}{" "}
          <a href={signInHref} className="font-medium text-brand-accent-text hover:underline">
            {copy.signIn}
          </a>
        </p>
      )}
      {/* The boxes above already say it failed (and announce it); this is the way out. */}
      {held === null && !signedOut && status === "failed" && (
        <p>
          <button
            type="button"
            onClick={() => {
              focusLinks.current = true;
              void claim();
            }}
            className="h-8 rounded-[8px] border border-brand-border-strong px-3 text-[13px] font-medium text-text-dark-primary hover:bg-brand-panel-raised"
          >
            {copy.retry}
          </button>
        </p>
      )}
      <p className="text-[13px]">
        <a href={watchHref} target="_blank" rel="noopener" className="text-brand-accent-text hover:underline">
          {copy.previewPage} →
        </a>
      </p>
    </div>
  );
}
