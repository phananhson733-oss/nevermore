// @input  -- 已校验的 Markdown 源
// @output -- 渲染并 sanitize 后的正文容器，排印与博客正文同源
// @pos    -- 资源库共享排印层，供 prompt / skill 详情页各散文分节使用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { renderResourceMarkdown } from "@/lib/resource-markdown";

/**
 * Typography for authored resource prose. Written as arbitrary variants rather
 * than a stylesheet class so the values sit next to every other component's
 * spacing decisions and stay greppable — the same choice the blog body makes.
 */
export const RESOURCE_PROSE_CLASSES = [
  "max-w-none",
  "[&_p]:text-text-dark-strong [&_p]:text-[14.5px] [&_p]:leading-[1.75] [&_p]:mb-4",
  "[&_p:last-child]:mb-0",
  "[&_h4]:text-text-dark-primary [&_h4]:text-[15px] [&_h4]:font-semibold [&_h4]:mt-7 [&_h4]:mb-2.5",
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-4 [&_ul]:space-y-2",
  "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-4 [&_ol]:space-y-2",
  "[&_li]:text-text-dark-strong [&_li]:text-[14.5px] [&_li]:leading-[1.7]",
  "[&_li]:marker:text-text-dark-faint",
  "[&_li_strong]:text-text-dark-primary",
  "[&_strong]:text-text-dark-primary [&_strong]:font-semibold",
  "[&_em]:italic",
  "[&_a]:text-brand-accent-text [&_a]:underline [&_a]:underline-offset-4 [&_a]:decoration-brand-accent/30 hover:[&_a]:decoration-brand-accent",
  "[&_code]:bg-brand-panel-sunken [&_code]:border [&_code]:border-brand-border [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-text-dark-primary",
  "[&_pre]:bg-brand-panel-sunken [&_pre]:border [&_pre]:border-brand-border-card [&_pre]:rounded-card [&_pre]:p-4 [&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:font-mono [&_pre]:text-[12px] [&_pre]:leading-[1.8] [&_pre]:text-text-dark-strong",
  "[&_pre_code]:bg-transparent [&_pre_code]:border-0 [&_pre_code]:p-0 [&_pre_code]:text-[12px]",
  // Tables carry the worked examples, so they must scroll inside their own box
  // rather than widening the page on a narrow screen.
  "[&_table]:block [&_table]:w-full [&_table]:max-w-none [&_table]:overflow-x-auto [&_table]:my-6 [&_table]:border-collapse",
  "[&_th]:text-text-dark-secondary [&_th]:font-mono [&_th]:text-[10px] [&_th]:tracking-[0.1em] [&_th]:uppercase [&_th]:text-left [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b [&_th]:border-brand-border [&_th]:whitespace-nowrap",
  // A minimum cell width is what makes the scroll container do its job. Without
  // it a six-column example table squeezes its last columns down to one
  // character per line instead of overflowing — technically not a page-wide
  // scroll, but unreadable, which is worse.
  "[&_th]:min-w-[112px] [&_td]:min-w-[136px]",
  "[&_td]:text-text-dark-secondary [&_td]:text-[13px] [&_td]:leading-[1.7] [&_td]:px-3 [&_td]:py-2.5 [&_td]:border-b [&_td]:border-brand-border-faint [&_td]:align-top",
  "[&_td_strong]:text-text-dark-primary",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-brand-accent [&_blockquote]:pl-4 [&_blockquote]:my-5 [&_blockquote]:text-text-dark-strong",
  "[&_hr]:border-brand-border [&_hr]:my-8",
].join(" ");

interface ResourceProseProps {
  readonly markdown: string;
  readonly className?: string;
}

export function ResourceProse({ markdown, className }: ResourceProseProps) {
  return (
    <div
      className={
        className
          ? `${RESOURCE_PROSE_CLASSES} ${className}`
          : RESOURCE_PROSE_CLASSES
      }
      dangerouslySetInnerHTML={{ __html: renderResourceMarkdown(markdown) }}
    />
  );
}
