// @input  -- SKILL.md 原文、安装路径、下载地址、安装命令与按钮文案
// @output -- 带路径栏、复制与下载动作、安装说明的文件窗
// @pos    -- Skill 详情页主视觉，把一份 skill 呈现为可下载且落地路径明确的真实文件
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { Download } from "lucide-react";

import { CopyButton } from "./copy-button";

interface SkillFileWindowProps {
  /** Where the file has to land, e.g. `.claude/skills/seo-audit/SKILL.md`. */
  readonly installPath: string;
  /** Filename the download saves as — always `SKILL.md` per the spec. */
  readonly downloadName: string;
  readonly content: string;
  readonly downloadHref: string;
  readonly installTitle: string;
  readonly installNote: string;
  readonly installCommand: string;
  readonly copyLabel: string;
  readonly copiedLabel: string;
  readonly failedLabel: string;
  readonly downloadLabel: string;
  readonly copyCommandLabel: string;
}

export function SkillFileWindow({
  installPath,
  downloadName,
  content,
  downloadHref,
  installTitle,
  installNote,
  installCommand,
  copyLabel,
  copiedLabel,
  failedLabel,
  downloadLabel,
  copyCommandLabel,
}: SkillFileWindowProps) {
  return (
    <div className="min-w-0 overflow-hidden rounded-card border border-brand-border-card bg-brand-panel shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border bg-brand-panel-raised px-4 py-3">
        {/*
         * The install path, not a bare filename: the spec identifies a skill by
         * the directory holding it, so the path is the part a reader cannot
         * reconstruct from the file itself.
         */}
        <span className="min-w-0 truncate font-mono text-[12px] text-text-dark-strong">
          {installPath}
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
            download={downloadName}
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
        aria-label={installPath}
        className="max-h-[520px] min-w-0 overflow-auto p-5 font-mono text-[12px] leading-[1.85] whitespace-pre-wrap text-text-dark-secondary [word-break:break-word] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-accent"
      >
        {content}
      </pre>

      {/*
       * The install strip closes the gap between "here is a file" and "it is
       * loaded": a downloaded SKILL.md sitting in ~/Downloads does nothing, and
       * the directory it needs is the one thing the file cannot tell you.
       */}
      <div className="min-w-0 border-t border-brand-border bg-brand-panel-raised px-4 py-4">
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
          {installTitle}
        </p>
        <p className="mt-2 text-[12.5px] leading-[1.65] text-text-dark-secondary">
          {installNote}
        </p>
        <div className="mt-3 flex min-w-0 flex-wrap items-start justify-between gap-2 rounded-row border border-brand-border bg-brand-bg px-3 py-2.5">
          <code className="min-w-0 flex-1 font-mono text-[11.5px] leading-[1.7] whitespace-pre-wrap text-text-dark-secondary [word-break:break-word]">
            {installCommand}
          </code>
          <CopyButton
            value={installCommand}
            label={copyCommandLabel}
            copiedLabel={copiedLabel}
            failedLabel={failedLabel}
            compact
          />
        </div>
      </div>
    </div>
  );
}
