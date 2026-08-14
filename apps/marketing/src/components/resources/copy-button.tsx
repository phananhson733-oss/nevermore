"use client";

// @input  -- 要复制的原文与按钮文案
// @output -- 复制到剪贴板的按钮，带短暂的已复制状态
// @pos    -- 资源库共享交互，供 prompt 正文与 skill 文件窗使用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

interface CopyButtonProps {
  readonly value: string;
  readonly label: string;
  readonly copiedLabel: string;
  readonly failedLabel: string;
  /** Icon-only rendering for dense headers such as the skill file window. */
  readonly compact?: boolean;
}

type CopyState = "idle" | "copied" | "failed";

export function CopyButton({
  value,
  label,
  copiedLabel,
  failedLabel,
  compact = false,
}: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const copied = state === "copied";
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A component unmounted while the confirmation is showing would otherwise set
  // state on a gone node when the timer fires.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function scheduleReset(): void {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState("idle"), 2500);
  }

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access is denied in embedded and non-secure contexts. Saying
      // so beats silence: the reader can select the text themselves, but only
      // if they know the button did not work.
      setState("failed");
      scheduleReset();
      return;
    }

    setState("copied");
    scheduleReset();
  }

  const Icon = copied ? Check : Copy;
  const statusText =
    state === "copied" ? copiedLabel : state === "failed" ? failedLabel : "";

  return (
    <>
      {/*
       * The visible label change is invisible to a screen reader that has moved
       * on, and the compact variant has no visible label at all. This region
       * announces both outcomes, including the failure the visible UI cannot
       * show.
       */}
      <span aria-live="polite" className="sr-only">
        {statusText}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={compact ? (copied ? copiedLabel : label) : undefined}
        className={
          compact
            ? "inline-flex size-8 items-center justify-center rounded-row border border-brand-border-strong bg-brand-panel-raised text-text-dark-secondary transition-colors hover:border-brand-accent/40 hover:text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
            : "inline-flex h-9 shrink-0 items-center gap-2 rounded-row border border-brand-border-strong bg-brand-panel-raised px-3.5 font-mono text-[11px] tracking-[0.06em] text-text-dark-strong uppercase transition-colors hover:border-brand-accent/40 hover:text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
        }
      >
        <Icon
          aria-hidden="true"
          className={
            compact
              ? "size-3.5"
              : copied
                ? "size-3.5 text-brand-accent-text"
                : "size-3.5"
          }
        />
        {compact ? null : (
          <span>
            {state === "failed" ? failedLabel : copied ? copiedLabel : label}
          </span>
        )}
      </button>
    </>
  );
}
