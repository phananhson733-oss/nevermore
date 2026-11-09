// @input  -- a link's title and what it is for, an optional ref to its copy button (so a parent can move focus there), its heading level (h4 under a section's h3, h3 straight under a page's h2), the URL (or null before it is claimed), the page locale (a locale, not the copy object: server pages render this and functions cannot cross to the client)
// @output -- the promo link laid out the way RS Boost lays out its links: title, what it is for, the URL in a selectable box and a copy button that says "Copied" for two seconds; before the link exists, a dashed box saying where it will show
// @pos    -- shared by the claim panel (the clip dialog on /tasks and /tasks/<id>) and the link list on /promotions
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { Check, Copy } from "lucide-react";
import { useState, type Ref } from "react";

import { taskCopy } from "../../lib/task-center/copy.ts";

export function LinkBlock({
  title,
  body,
  value,
  locale,
  level = 4,
  copyRef,
}: {
  title: string;
  body: string;
  value: string | null;
  locale: string;
  level?: 3 | 4;
  copyRef?: Ref<HTMLButtonElement>;
}) {
  const copy = taskCopy(locale);
  const Heading = level === 3 ? "h3" : "h4";
  const [copied, setCopied] = useState(false);

  async function copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard can be blocked; the text is on screen and selectable.
    }
  }

  return (
    <div className="rounded-[10px] border border-brand-border-card bg-brand-bg p-4">
      <Heading className="text-[14px] font-semibold text-text-dark-primary">{title}</Heading>
      <p className="mt-1 text-[12.5px] leading-[1.55] text-text-dark-secondary">{body}</p>
      {value === null ? (
        <p className="mt-3 rounded-[8px] border border-dashed border-brand-border-strong px-3 py-2 text-[12.5px] text-text-dark-secondary">
          {copy.linkAfterClaim}
        </p>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-[8px] border border-brand-border-card bg-brand-panel px-3 py-2 font-mono text-[12.5px] text-text-dark-primary select-all">
            {value}
          </code>
          <button
            ref={copyRef}
            type="button"
            onClick={() => void copyText(value)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
            {copied ? copy.copied : copy.copy}
          </button>
        </div>
      )}
    </div>
  );
}
