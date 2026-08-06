// @input  — react, @/lib/utils
// @output — Textarea 组件
// @pos    — shadcn/ui 多行文本输入原子组件
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 py-3 text-[14px] leading-[1.6] text-text-dark-primary transition-colors outline-none placeholder:text-text-dark-secondary focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-brand-error/70 aria-invalid:ring-2 aria-invalid:ring-brand-error/20",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
