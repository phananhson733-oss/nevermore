// @input  — framer-motion, visuals/shared
// @output — OptimizationVisual 自优化决策迷你版（决策列表 + Playbook 沉淀）
// @pos    — Features 页"自优化决策"区块可视化，数据来源 mock opt-001/002
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { motion } from "framer-motion";
import { type VisualProps, C, themeColors, fadeItem } from "./shared";

const decisions = [
  {
    strategy: "Long-tail SEO Expansion", score: 82, decision: "expand",
    color: C.emerald, threshold: 70, delta: "+12", windows: 2, trend: "up",
    reason: "Strong organic lift with high attribution confidence",
  },
  {
    strategy: "Product Page Optimization", score: 48, decision: "iterate",
    color: C.amber.text, threshold: 70, delta: "-22", windows: 1, trend: "flat",
    reason: "Insufficient data — extend measurement window by 14 days",
  },
];

function scoreColor(s: number) {
  if (s >= 70) return C.emerald;
  if (s >= 40) return C.amber.text;
  return C.red;
}

export function OptimizationVisual({ isDark }: VisualProps) {
  const t = themeColors(isDark);

  return (
    <div className="w-full space-y-2">
      {/* 阈值图例 */}
      <motion.div
        {...fadeItem} transition={{ duration: 0.3 }}
        className="flex items-center gap-1.5 font-mono text-[8.5px] tracking-[0.06em] uppercase"
        style={{ color: t.textDim }}
      >
        <span className="w-2 h-0.5" style={{ backgroundColor: C.emerald }} />
        Scale up: 70+
        <span className="w-2 h-0.5 ml-2" style={{ backgroundColor: C.amber.text }} />
        Iterate: 40-70
        <span className="w-2 h-0.5 ml-2" style={{ backgroundColor: C.red }} />
        Pause: &lt;40
      </motion.div>

      {decisions.map((d, i) => (
        <motion.div
          key={i} {...fadeItem}
          transition={{ duration: 0.4, delay: 0.1 + i * 0.12 }}
          className="rounded-lg p-3"
          style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }}
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <div className="text-[9.5px]" style={{ color: t.textDim }}>
                {d.strategy}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-mono text-[17px]" style={{ color: scoreColor(d.score) }}>
                  {d.score}
                </span>
                <span
                  className="font-mono text-[8.5px] tracking-[0.08em] uppercase"
                  style={{ color: t.textDim }}
                >
                  threshold: {d.threshold}
                </span>
                <span className="font-mono text-[9px]" style={{ color: d.color }}>
                  ({d.delta})
                </span>
              </div>
            </div>
            <span
              className="rounded px-2 py-[3px] font-mono text-[9px] tracking-[0.08em] uppercase"
              style={{ backgroundColor: `${d.color}20`, color: d.color }}
            >
              {d.decision}
            </span>
          </div>

          <div className="font-mono text-[8.5px] tracking-[0.06em] uppercase" style={{ color: t.textDim }}>
            {d.windows} consecutive window{d.windows > 1 ? "s" : ""} | trend: {d.trend}
          </div>
          <div
            className="text-[9.5px] leading-[1.5] mt-1.5 pt-1.5"
            style={{ color: t.textDim, borderTop: `1px solid ${t.border}` }}
          >
            {d.reason}
          </div>
        </motion.div>
      ))}

      {/* Playbook 沉淀 */}
      <motion.div
        {...fadeItem} transition={{ delay: 0.5 }}
        className="flex items-center gap-1.5 text-[9.5px]"
        style={{ color: C.emerald }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: C.emerald }} />
        Playbook saved: &quot;Long-tail Cluster + Pillar Page Pattern&quot;
      </motion.div>
    </div>
  );
}
