// @input  -- locale and the message namespace of the tool rendering it
// @output -- a control that revokes the Google grant and reloads the page
// @pos    -- the visitor-side half of the "disconnect anytime" promise
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useState } from "react";
import { Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
// Relative, not `@/`: the shared Vitest config maps `@/` to apps/web only, so
// an aliased import would make this file unrenderable from the unit project.
import {
  disconnectNoticeKey,
  GOOGLE_PERMISSIONS_URL,
  requestDisconnect,
  type DisconnectOutcome,
} from "../../lib/auth/disconnect-request";

interface GscDisconnectProps {
  /** Message namespace, e.g. `tools.quickWins`. Key names are shared. */
  readonly namespace: string;
}

/**
 * Disconnect, for a visitor who is connected.
 *
 * The grant now lives in the browser for weeks and carries a refresh token, so
 * a page that says "disconnect anytime" and offers no way to do it is making a
 * promise only Google's own account settings can keep. This is the control
 * that makes the sentence true.
 *
 * Shared by both connected tools: they read the same cookie and the same
 * grant, and a disconnect in one is a disconnect in the other.
 */
export function GscDisconnect({ namespace }: GscDisconnectProps) {
  const t = useTranslations(namespace);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<DisconnectOutcome | null>(null);

  async function disconnect() {
    setBusy(true);
    setOutcome(null);
    const result = await requestDisconnect();
    if (result.kind === "cleared") {
      // A full reload rather than a router refresh: the connected state is
      // read from cookies on the server, and every piece of form state below
      // belongs to a grant that no longer exists.
      window.location.reload();
      return;
    }
    setOutcome(result);
    setBusy(false);
  }

  const noticeKey = disconnectNoticeKey(outcome);

  return (
    <div className="mt-6 border-t border-brand-border pt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/*
         * Deliberately quiet: this undoes the thing the visitor came to do, so
         * it reads as an available action rather than as a next step.
         */}
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void disconnect()}
          className="inline-flex min-h-9 items-center gap-1.5 text-[12.5px] text-text-dark-secondary transition-colors hover:text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60"
        >
          <Unlink aria-hidden="true" className="size-3.5" />
          {busy ? t("disconnecting") : t("disconnect")}
        </button>
        <p className="text-[12.5px] text-text-dark-secondary">
          {t("disconnectHint")}
        </p>
      </div>

      {noticeKey === null ? null : (
        <div
          role="alert"
          className="mt-3 rounded-[10px] border border-brand-warning/25 bg-brand-warning/[0.08] px-4 py-3 text-[13px] leading-[1.6] text-brand-warning"
        >
          <p>{t(noticeKey)}</p>
          {/*
           * The only place a visitor can finish what we could not. Rendered
           * for both notices: whether the credential is still live at Google
           * is exactly what we were unable to determine.
           */}
          <a
            href={GOOGLE_PERMISSIONS_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1.5 inline-flex min-h-9 items-center text-[12.5px] underline underline-offset-2"
          >
            {t("disconnectGoogleSettings")}
          </a>
        </div>
      )}
    </div>
  );
}
