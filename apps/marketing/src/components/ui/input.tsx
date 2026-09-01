// @input  — react, Marketing-local utils
// @output — Input 组件
// @pos    — shadcn/ui 文本输入框原子组件
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import * as React from "react";

import { cn } from "../../lib/utils.ts";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // 输入框配方：h-11 / 10px 圆角 / border-strong / 页面底色，聚焦只换边框和一圈细环。
        "h-11 w-full min-w-0 rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 py-2 text-[14px] text-text-dark-primary transition-colors outline-none selection:bg-brand-accent selection:text-brand-on-accent file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-[13px] file:font-medium file:text-text-dark-primary placeholder:text-text-dark-secondary disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        // ring-brand-accent/25 合成后只有约 1.7:1，看不见。改成实色 outline + 偏移，
        // 与 ui/button 同一套焦点语言。
        "focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent",
        "aria-invalid:border-brand-error/70 aria-invalid:ring-2 aria-invalid:ring-brand-error/20",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
