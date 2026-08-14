// @input  -- SKILL.md 原文、文件名、下载地址与按钮文案
// @output -- 带文件名栏、复制与下载动作的文件窗
// @pos    -- Skill 详情页主视觉，把一份 skill 呈现为可下载的真实文件
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { Download } from "lucide-react";

import { CopyButton } from "./copy-button";

interface SkillFileWindowProps {
  readonly fileName: string;
  readonly content: string;
  readonly downloadHref: string;
  readonly copyLabel: string;
  readonly copiedLabel: string;
  readonly failedLabel: string;
  readonly downloadLabel: string;
}

export function SkillFileWindow({
  fileName,
  content,
  downloadHref,
  copyLabel,
  copiedLabel,
  failedLabel,
  downloadLabel,
}: SkillFileWindowProps) {
  return (
    <div className="min-w-0 overflow-hidden rounded-card border border-brand-border-card bg-brand-panel shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border bg-brand-panel-raised px-4 py-3">
        <span className="min-w-0 truncate font-mono text-[12px] text-text-dark-strong">
          {fileName}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <CopyButton
            value={content}
            label={copyLabel}
            copiedLabel={copiedLabel}
            failedLabel={failedLabel}
            compact
          />
          {/*
           * A real request to a route that returns the same bytes shown above,
           * not a Blob built in the browser: the file has to be fetchable by
           * anything that can follow a link, including a crawler.
           */}
          <a
            href={downloadHref}
            download={fileName}
            className="inline-flex h-8 items-center gap-2 rounded-row border border-brand-border-strong bg-brand-panel-raised px-3 font-mono text-[11px] tracking-[0.06em] text-text-dark-strong uppercase transition-colors hover:border-brand-accent/40 hover:text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            <Download aria-hidden="true" className="size-3.5" />
            {downloadLabel}
          </a>
        </div>
      </div>

      {/*
       * Focusable with a label and a region role: this scroll box holds the
       * page's central content, and a keyboard user with no pointer cannot
       * reach the rest of the file without being able to focus and scroll it.
       */}
      <pre
        tabIndex={0}
        role="region"
        aria-label={fileName}
        className="max-h-[520px] min-w-0 overflow-auto p-5 font-mono text-[12px] leading-[1.85] whitespace-pre-wrap text-text-dark-secondary [word-break:break-word] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-accent"
      >
        {content}
      </pre>
    </div>
  );
}
