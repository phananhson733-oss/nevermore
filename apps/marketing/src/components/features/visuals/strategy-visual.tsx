// @input  — framer-motion, visuals/shared
// @output — StrategyVisual 策略卡片迷你版（StrategyCard + ScoreCard 预览）
// @pos    — Features 页"策略引擎"区块可视化，数据来源 mock strat-001
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { motion } from "framer-motion";
import { type VisualProps, C, themeColors, fadeItem } from "./shared";

const strategies = [
  {
    name: "Long-tail SEO Expansion", score: 82, roi: 3200, confidence: 0.85,
    breakdown: { ROI: 85, History: 78, Gap: 82, Health: 88, Risk: 65 },
    impact: ["organic_traffic", "conversion_rate"], recommended: true,
  },
  {
    name: "Reddit Community Seeding", score: 67, roi: 1800, confidence: 0.62,
    breakdown: { ROI: 70, History: 55, Gap: 74, Health: 80, Risk: 45 },
    impact: ["brand_awareness"], recommended: false,
  },
];

function scoreColor(s: number) {
  if (s >= 75) return C.emerald;
  if (s >= 50) return C.amber.text;
  return C.red;
}

export function StrategyVisual({ isDark }: VisualProps) {
  const t = themeColors(isDark);

  return (
    <div className="w-full space-y-2">
      {strategies.map((s, i) => (
        <motion.div
          key={i} {...fadeItem}
          transition={{ duration: 0.4, delay: i * 0.12 }}
          className="rounded-lg p-3"
          style={{
            backgroundColor: t.card,
            border: `1px solid ${s.recommended ? C.accent : t.border}`,
          }}
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <div
                className="font-mono text-[8.5px] tracking-[0.1em] uppercase"
                style={{ color: t.textDim }}
              >
                Strategy #{i + 1}
              </div>
              <div className="mt-0.5 text-[11.5px] font-semibold" style={{ color: t.text }}>
                {s.name}
              </div>
            </div>
            <div className="font-mono text-[17px]" style={{ color: scoreColor(s.score) }}>
              {s.score}
            </div>
          </div>

          {/* Score breakdown bars */}
          <div className="flex gap-1 mb-2">
            {Object.entries(s.breakdown).map(([k, v]) => (
              <div key={k} className="flex-1">
                <div className="h-1 rounded-full" style={{ backgroundColor: t.barTrack }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: C.accent }}
                    initial={{ width: 0 }}
                    whileInView={{ width: `${v}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: 0.3 + i * 0.1 }}
                  />
                </div>
                <div
                  className="mt-1 font-mono text-[8.5px] tracking-[0.08em] uppercase"
                  style={{ color: t.textDim }}
                >
                  {k}
                </div>
              </div>
            ))}
          </div>

          {/* ROI + Confidence */}
          <div className="flex gap-2">
            <div
              className="flex-1 rounded-md p-1.5"
              style={{ backgroundColor: t.cardDeep, border: `1px solid ${t.border}` }}
            >
              <div
                className="font-mono text-[8.5px] tracking-[0.1em] uppercase"
                style={{ color: t.textDim }}
              >
                Monthly ROI
              </div>
              <div className="mt-0.5 font-mono text-[12px]" style={{ color: C.emerald }}>
                ${s.roi.toLocaleString()}
              </div>
            </div>
            <div
              className="flex-1 rounded-md p-1.5"
              style={{ backgroundColor: t.cardDeep, border: `1px solid ${t.border}` }}
            >
              <div
                className="font-mono text-[8.5px] tracking-[0.1em] uppercase"
                style={{ color: t.textDim }}
              >
                Confidence
              </div>
              <div className="flex items-center gap-1 mt-1">
                <div className="h-1 flex-1 rounded-full" style={{ backgroundColor: t.barTrack }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${s.confidence * 100}%`, backgroundColor: C.accent }}
                  />
                </div>
                <span className="font-mono text-[8.5px]" style={{ color: t.textDim }}>
                  {Math.round(s.confidence * 100)}%
                </span>
              </div>
            </div>
          </div>

          {/* Impact tags */}
          <div className="flex gap-1 mt-1.5">
            {s.impact.map((tag) => (
              <span
                key={tag}
                className="rounded px-1.5 py-[2px] font-mono text-[8.5px] tracking-[0.08em] uppercase"
                style={{ backgroundColor: `${C.accent}15`, color: C.accent }}
              >
                {tag.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
