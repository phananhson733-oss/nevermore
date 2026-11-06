// @input  -- a label, the text to copy, the page locale (a locale, not the copy object: server pages render this and functions cannot cross to the client)
// @output -- one row: label, the value in monospace (selectable), and a copy button that says "Copied" for two seconds
// @pos    -- shared by the claim panel on /tasks/<id> and the link list on /promotions
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useState } from "react";

import { taskCopy } from "../../lib/task-center/copy.ts";

export function CopyRow({
  label,
  value,
  locale,
}: {
  label?: string;
  value: string;
  locale: string;
}) {
  const copy = taskCopy(locale);
  const [copied, setCopied] = useState(false);

  async function copyText(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard can be blocked; the text is on screen and selectable.
    }
  }

  return (
    <div className="flex items-center gap-2">
      {label !== undefined && <span className="w-16 shrink-0 text-text-dark-secondary">{label}</span>}
      <code className="min-w-0 flex-1 truncate rounded-[6px] bg-brand-panel px-2 py-1 font-mono text-[12.5px] text-text-dark-primary select-all">
        {value}
      </code>
      <button
        type="button"
        onClick={() => void copyText()}
        className="shrink-0 text-brand-accent-text hover:underline"
      >
        {copied ? copy.copied : copy.copy}
      </button>
    </div>
  );
}
