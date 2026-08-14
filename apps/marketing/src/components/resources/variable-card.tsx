// @input  -- PromptVariable 与必填/选填标签文案
// @output -- 单个占位符的说明卡（名称 / 必填状态 / 说明 / 示例值）
// @pos    -- Prompt 详情页变量区，让占位符不必从提示词正文里反推
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { PromptVariable } from "@/types/resource";

interface VariableCardProps {
  readonly variable: PromptVariable;
  readonly requiredLabel: string;
  readonly optionalLabel: string;
  readonly exampleLabel: string;
}

export function VariableCard({
  variable,
  requiredLabel,
  optionalLabel,
  exampleLabel,
}: VariableCardProps) {
  return (
    <article className="flex min-w-0 flex-col rounded-card border border-brand-border-card bg-brand-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <code className="min-w-0 font-mono text-[13px] break-words text-brand-accent-text">
          {`{{${variable.name}}}`}
        </code>
        <span
          className={
            variable.required
              ? "shrink-0 rounded-full border border-brand-accent/25 bg-brand-accent-soft px-2.5 py-0.5 font-mono text-[9.5px] tracking-[0.08em] text-brand-accent-text uppercase"
              : "shrink-0 rounded-full border border-brand-border-strong px-2.5 py-0.5 font-mono text-[9.5px] tracking-[0.08em] text-text-dark-faint uppercase"
          }
        >
          {variable.required ? requiredLabel : optionalLabel}
        </span>
      </div>

      <p className="mt-3 text-[13px] leading-[1.65] text-text-dark-secondary">
        {variable.description}
      </p>

      <div className="mt-4 border-t border-brand-border-faint pt-3">
        <p className="font-mono text-[9px] tracking-[0.08em] text-text-dark-faint uppercase">
          {exampleLabel}
        </p>
        <p className="mt-1.5 font-mono text-[11.5px] leading-[1.6] break-words text-text-dark-strong">
          {variable.example}
        </p>
      </div>
    </article>
  );
}
