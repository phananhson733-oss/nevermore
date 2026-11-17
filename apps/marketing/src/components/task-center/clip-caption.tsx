// @input  -- the page locale, a clip's 推荐文案 and hashtags (without the #), the heading level it sits at
// @output -- 推荐文案: a note that it can be posted as is or rewritten by an AI with the promoter's own referral code, the caption as written (line breaks kept) and the hashtags as #tags, both at the synopsis's 13.5px, and one button that copies the caption and hashtags together, ready to paste into a post; nothing when the clip has neither
// @pos    -- under the clip picked in the /tasks dialog's 系列资源, and under each clip in /tasks/<id>'s preview list
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { taskCopy } from "../../lib/task-center/copy.ts";

/** What the button copies: the caption, a blank line, then the hashtags on one line, as a post carries them. */
export function captionText(caption: string | null, hashtags: readonly string[]): string {
  const tags = hashtags.map((tag) => `#${tag}`).join(" ");
  return [caption ?? "", tags].filter((part) => part !== "").join("\n\n");
}

export function ClipCaption({
  locale,
  caption,
  hashtags,
  level = 3,
}: {
  locale: string;
  caption: string | null;
  hashtags: readonly string[];
  level?: 3 | 4;
}) {
  const copy = taskCopy(locale);
  const [copied, setCopied] = useState(false);
  if (caption === null && hashtags.length === 0) return null;
  const Heading = level === 3 ? "h3" : "h4";

  async function copyAll(): Promise<void> {
    try {
      await navigator.clipboard.writeText(captionText(caption, hashtags));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard can be blocked; the text is on screen and selectable.
    }
  }

  return (
    <section className="rounded-[10px] border border-brand-border-card bg-brand-bg p-4">
      <Heading className="text-[15px] font-semibold text-text-dark-primary">{copy.captionTitle}</Heading>
      <p className="mt-1 text-[12.5px] leading-[1.55] text-text-dark-secondary">{copy.captionBody}</p>
      {/* Each <p> names its size: globals.css sizes every p (about 16px), and a
          size set on the box would not reach them. 13.5px, as the synopsis. */}
      <div className="mt-3 space-y-2 rounded-[8px] border border-brand-border-card bg-brand-panel px-3 py-2.5 select-text">
        {caption !== null && (
          <p className="text-[13.5px] leading-[1.65] whitespace-pre-line text-text-dark-primary">{caption}</p>
        )}
        {hashtags.length > 0 && (
          <p className="text-[13.5px] leading-[1.65] break-words text-brand-accent-text">
            {hashtags.map((tag) => `#${tag}`).join(" ")}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void copyAll()}
        className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
      >
        {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
        {copied ? copy.copied : copy.copyCaption}
      </button>
    </section>
  );
}
