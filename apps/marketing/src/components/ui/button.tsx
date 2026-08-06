// @input  — react, class-variance-authority, radix-ui, @/lib/utils
// @output — Button 组件、buttonVariants
// @pos    — shadcn/ui 按钮原子组件，全站最基础交互元素
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/*
 * Signal Console v1：圆角统一到 10px，高度 default 40 / lg 48。
 * default variant 不写死颜色——:root 的 --primary/--accent 已经是品牌绿，
 * 写死 hex 会让后续换色漏掉这里。渐变只属于 `cta`，一屏最多一个。
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[10px] text-[14px] font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/50 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-brand-error/70 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        cta: "bg-brand-gradient font-semibold text-brand-on-accent shadow-cta transition-shadow hover:shadow-cta-hover",
        destructive:
          "bg-destructive text-brand-bg hover:bg-destructive/90 focus-visible:ring-brand-error/40",
        outline:
          "border border-brand-border-strong bg-brand-panel/60 text-text-dark-primary transition-colors hover:border-brand-accent/50",
        secondary:
          "bg-brand-panel-raised text-text-dark-primary transition-colors hover:bg-brand-panel-raised/70",
        ghost:
          "text-text-dark-secondary transition-colors hover:bg-brand-panel-raised hover:text-text-dark-primary",
        link: "text-brand-accent-text underline-offset-4 transition-colors hover:text-brand-accent-hover hover:underline",
      },
      size: {
        default: "h-10 px-5 has-[>svg]:px-4",
        xs: "h-6 gap-1 rounded-[6px] px-2 text-[11px] has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-[8px] px-3 text-[13px] has-[>svg]:px-2.5",
        lg: "h-12 rounded-[10px] px-[26px] text-[14.5px] has-[>svg]:px-6",
        icon: "size-10",
        "icon-xs": "size-6 rounded-[6px] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-[8px]",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
