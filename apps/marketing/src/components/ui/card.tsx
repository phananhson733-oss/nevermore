// @input  — react, Marketing-local utils
// @output — Card / CardHeader / CardTitle / CardDescription / CardAction / CardContent / CardFooter
// @pos    — shadcn/ui 卡片容器组件，用于内容分组展示
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import * as React from "react"

import { cn } from "../../lib/utils.ts"

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        // 卡片不带投影：层级只靠 panel 底色 + 卡片外框描边，hover 只换边框色。
        "flex flex-col gap-5 rounded-card border border-brand-border-card bg-brand-panel py-[26px] text-text-dark-primary transition-colors duration-200",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-[26px] has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:border-brand-border [.border-b]:pb-5",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "text-[16.5px] leading-snug font-semibold text-text-dark-primary",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn(
        "text-[13px] leading-[1.6] text-text-dark-secondary",
        className
      )}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-[26px]", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center px-[26px] [.border-t]:border-brand-border [.border-t]:pt-5",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
