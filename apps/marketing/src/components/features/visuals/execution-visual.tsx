// @input  — framer-motion, visuals/shared
// @output — ExecutionVisual 批次看板迷你版（BacklogBoard 预览）
// @pos    — Features 页"执行编排"区块可视化，数据来源 mock execution_backlogs
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { motion } from "framer-motion";
import { type VisualProps, C, themeColors, fadeItem } from "./shared";

const batches = [
  {
    label: "Batch-0", borderColor: "#EF4444",
    tasks: [{
      title: "Create pillar page: Growth Automation Guide",
      type: "seo", typeColor: C.blue, status: "completed", statusColor: C.emerald,
    }],
  },
  {
    label: "Batch-1", borderColor: "#F97316",
    tasks: [{
      title: "Seed Reddit r/SaaS with value post",
      type: "social", typeColor: C.purple, status: "running", statusColor: C.accent,
    }],
  },
  {
    label: "Batch-2", borderColor: "#FBBF24",
    tasks: [{
      title: "Acquire TechCrunch backlink",
      type: "link", typeColor: C.green, status: "pending", statusColor: "#71717A",
    }],
  },
  { label: "Batch-3", borderColor: "#71717A", tasks: [] },
];

export function ExecutionVisual({ isDark }: VisualProps) {
  const t = themeColors(isDark);

  return (
    <div className="w-full">
      <div className="grid grid-cols-4 gap-1.5">
        {batches.map((batch, bi) => (
          <motion.div
            key={bi} {...fadeItem}
            transition={{ duration: 0.4, delay: 0.1 + bi * 0.08 }}
            className="rounded-lg overflow-hidden"
            style={{
              backgroundColor: t.card,
              border: `1px solid ${t.border}`,
              borderLeft: `3px solid ${batch.borderColor}`,
            }}
          >
            <div
              className="flex items-center justify-between px-2 py-1.5"
              style={{ borderBottom: `1px solid ${t.border}` }}
            >
              <span className="text-[8px] font-medium" style={{ color: t.text }}>
                {batch.label}
              </span>
              <span
                className="rounded-full px-1.5 py-0.5 text-[7px]"
                style={{ backgroundColor: t.pillBg, color: t.textDim }}
              >
                {batch.tasks.length}
              </span>
            </div>

            <div className="p-1.5 space-y-1 min-h-[60px]">
              {batch.tasks.length === 0 ? (
                <div className="text-[8px] text-center py-4" style={{ color: t.textDim }}>
                  No tasks
                </div>
              ) : (
                batch.tasks.map((task, ti) => (
                  <div
                    key={ti} className="rounded-md p-1.5"
                    style={{ backgroundColor: t.cardDeep, border: `1px solid ${t.border}` }}
                  >
                    <div
                      className="text-[8px] leading-tight line-clamp-2"
                      style={{ color: t.text }}
                    >
                      {task.title}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <span
                        className="text-[7px] px-1 py-0.5 rounded-full"
                        style={{ backgroundColor: task.typeColor.bg, color: task.typeColor.text }}
                      >
                        {task.type}
                      </span>
                      <span
                        className="w-1 h-1 rounded-full ml-auto"
                        style={{ backgroundColor: task.statusColor }}
                      />
                      <span className="text-[7px]" style={{ color: task.statusColor }}>
                        {task.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
