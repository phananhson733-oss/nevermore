// @input  — framer-motion, visuals/shared
// @output — DiscoveryVisual 机会地图迷你版（OpportunityMap 预览）
// @pos    — Features 页"自动发现"区块可视化，数据来源 mock disc-001
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { motion } from "framer-motion";
import { type VisualProps, C, themeColors, fadeItem } from "./shared";

const columns = [
  {
    icon: "S", label: "Keyword Clusters", color: C.blue,
    items: [
      { title: "growth automation", priority: "high", cpc: 450 },
      { title: "ai seo tools", priority: "medium", cpc: 280 },
    ],
  },
  {
    icon: "C", label: "Competitor Gaps", color: C.purple,
    items: [{ title: "SEO platform comparison", priority: "high", cpc: 320 }],
  },
  {
    icon: "F", label: "Content Gaps", color: C.amber,
    items: [{ title: "growth strategies pillar", priority: "high", cpc: 280 }],
  },
  {
    icon: "L", label: "Backlink", color: C.green,
    items: [{ title: "TechCrunch resource page", priority: "medium", cpc: 180 }],
  },
];

const summaryCards = [
  { label: "Opportunities", value: "18" },
  { label: "High Priority", value: "3" },
  { label: "Total CPC", value: "$1,510" },
];

export function DiscoveryVisual({ isDark }: VisualProps) {
  const t = themeColors(isDark);

  return (
    <div className="w-full">
      {/* Summary 卡片行 */}
      <div className="flex gap-2 mb-3">
        {summaryCards.map((s, i) => (
          <motion.div
            key={i} {...fadeItem}
            transition={{ duration: 0.3, delay: i * 0.08 }}
            className="flex-1 rounded-md p-2"
            style={{ backgroundColor: t.cardDeep, border: `1px solid ${t.border}` }}
          >
            <div className="text-[9px]" style={{ color: t.textDim }}>{s.label}</div>
            <div
              className="text-sm font-bold"
              style={{ color: i === 2 ? C.emerald : t.text }}
            >
              {s.value}
            </div>
          </motion.div>
        ))}
      </div>

      {/* 4 列机会地图 */}
      <div className="grid grid-cols-4 gap-1.5">
        {columns.map((col, ci) => (
          <motion.div
            key={ci} {...fadeItem}
            transition={{ duration: 0.4, delay: 0.15 + ci * 0.08 }}
          >
            <div className="flex items-center gap-1 mb-1.5">
              <span
                className="w-4 h-4 rounded text-[8px] font-bold flex items-center justify-center"
                style={{ backgroundColor: col.color.bg, color: col.color.text }}
              >
                {col.icon}
              </span>
              <span className="text-[8px] font-medium truncate" style={{ color: t.text }}>
                {col.label}
              </span>
              <span className="text-[8px] ml-auto" style={{ color: t.textDim }}>
                {col.items.length}
              </span>
            </div>
            <div className="space-y-1">
              {col.items.map((item, ii) => (
                <div
                  key={ii} className="rounded-md p-1.5"
                  style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }}
                >
                  <div className="flex items-center gap-1 mb-0.5">
                    <span
                      className="text-[7px] px-1 rounded-full"
                      style={{ backgroundColor: col.color.bg, color: col.color.text }}
                    >
                      {item.priority}
                    </span>
                  </div>
                  <div className="text-[8px] leading-tight" style={{ color: t.text }}>
                    {item.title}
                  </div>
                  <div className="text-[8px] font-semibold mt-0.5" style={{ color: C.emerald }}>
                    ${item.cpc}/mo
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
