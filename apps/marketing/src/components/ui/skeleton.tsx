// @input  — className prop
// @output — Skeleton / TableSkeleton 骨架屏加载组件
// @pos    — 后台 UI 基础组件，表格/卡片加载占位符（SPEC 8.3）
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { cn } from "@/lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[8px] bg-brand-panel-raised",
        className,
      )}
      {...props}
    />
  );
}

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export function TableSkeleton({ rows = 5, columns = 4 }: TableSkeletonProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, rowIdx) => (
        <div key={rowIdx} data-skeleton-row="" className="flex gap-4">
          {Array.from({ length: columns }, (_, colIdx) => (
            <Skeleton
              key={colIdx}
              data-skeleton-cell=""
              className="h-8 flex-1 rounded"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
