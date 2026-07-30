// @input  — framer-motion, visuals/shared
// @output — AttributionVisual 渠道归因 + 隔离迷你版（ChannelIsolation 预览）
// @pos    — Features 页"归因闭环"区块可视化，数据来源 mock meas-001
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { motion } from "framer-motion";
import { type VisualProps, C, themeColors, fadeItem } from "./shared";

const channels = [
  { name: "SEO", sessions: 450, conversions: 12, bar: 75 },
  { name: "Social", sessions: 95, conversions: 2, bar: 16 },
  { name: "Link", sessions: 210, conversions: 5, bar: 35 },
];

const isolation = [
  { label: "UTM Completeness", value: "92%", status: "good" as const },
  { label: "Conflict Rate", value: "2%", status: "good" as const },
  { label: "Isolation Score", value: "95%", status: "good" as const },
];

const statusColors = { good: C.emerald, warning: "#FBBF24", bad: C.red };

export function AttributionVisual({ isDark }: VisualProps) {
  const t = themeColors(isDark);

  return (
    <div className="w-full space-y-3">
      {/* UTM 指纹示例 */}
      <motion.div
        {...fadeItem} transition={{ duration: 0.3 }}
        className="rounded-md p-2 font-mono text-[9px]"
        style={{ backgroundColor: t.cardDeep, border: `1px solid ${t.border}` }}
      >
        <span style={{ color: t.textDim }}>utm_term=</span>
        <span style={{ color: C.accent }}>seo_agent_b0_001</span>
      </motion.div>

      {/* 归因柱状图 */}
      <motion.div
        {...fadeItem} transition={{ duration: 0.4, delay: 0.1 }}
        className="rounded-lg p-3"
        style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }}
      >
        <div className="text-[9px] mb-2" style={{ color: t.textDim }}>
          Channel Attribution
        </div>
        <div className="space-y-2">
          {channels.map((ch, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[9px] w-10 text-right" style={{ color: t.text }}>
                {ch.name}
              </span>
              <div className="flex-1">
                <div className="h-2.5 rounded-full" style={{ backgroundColor: t.barTrack }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: C.accent }}
                    initial={{ width: 0 }}
                    whileInView={{ width: `${ch.bar}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: 0.2 + i * 0.1 }}
                  />
                </div>
              </div>
              <span className="text-[8px] w-16 text-right" style={{ color: t.textDim }}>
                {ch.sessions}s / {ch.conversions}c
              </span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* 渠道隔离 3 卡 */}
      <div className="grid grid-cols-3 gap-1.5">
        {isolation.map((card, i) => (
          <motion.div
            key={i} {...fadeItem}
            transition={{ duration: 0.3, delay: 0.3 + i * 0.08 }}
            className="rounded-md p-2"
            style={{ backgroundColor: t.cardDeep, border: `1px solid ${t.border}` }}
          >
            <div className="text-[7px]" style={{ color: t.textDim }}>{card.label}</div>
            <div
              className="text-sm font-bold"
              style={{ color: statusColors[card.status] }}
            >
              {card.value}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
