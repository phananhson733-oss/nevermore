// @input  -- 原文文本、区块标题与复制按钮文案
// @output -- 带 eyebrow 标题和复制按钮的等宽正文块
// @pos    -- 资源库展示层，承载 prompt 正文与示例输入
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { CopyButton } from "./copy-button";

interface ResourceCodeBlockProps {
  readonly value: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly headingId: string;
  readonly copyLabel: string;
  readonly copiedLabel: string;
  readonly failedLabel: string;
}

export function ResourceCodeBlock({
  value,
  eyebrow,
  title,
  headingId,
  copyLabel,
  copiedLabel,
  failedLabel,
}: ResourceCodeBlockProps) {
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
            {eyebrow}
          </p>
          <h2
            id={headingId}
            className="mt-2 text-[22px] font-semibold text-text-dark-primary"
          >
            {title}
          </h2>
        </div>
        <CopyButton
          value={value}
          label={copyLabel}
          copiedLabel={copiedLabel}
          failedLabel={failedLabel}
        />
      </div>

      {/*
       * Wrapping rather than scrolling: a prompt is read top to bottom before it
       * is copied, and a horizontal scrollbar hides the right-hand half of every
       * long instruction line.
       */}
      <pre className="mt-5 min-w-0 rounded-card border border-brand-border-card bg-brand-panel-sunken p-5 font-mono text-[12.5px] leading-[1.85] whitespace-pre-wrap text-text-dark-strong [word-break:break-word]">
        {value}
      </pre>
    </section>
  );
}
