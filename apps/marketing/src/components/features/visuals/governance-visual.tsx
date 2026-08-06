// @input  — framer-motion, visuals/shared
// @output — GovernanceVisual 覆盖追踪 + 干预效果迷你版
// @pos    — Features 页"治理合规"区块可视化，数据来源 mock over-001/snap-001
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { motion } from "framer-motion";
import { type VisualProps, C, themeColors, fadeItem } from "./shared";

const overrides = [
  {
    date: "Mar 3", who: "Admin", target: "Strategy #1",
    action: "Increase priority of SEO channel based on Q1 results",
    what: "priority: 2 -> 1",
    scoreBefore: 75, scoreAfter: 82,
    effect7d: "+120 traffic", effect14d: "+310 traffic",
  },
  {
    date: "Mar 8", who: "Admin", target: "Strategy #2",
    action: "Lower success threshold during early-stage testing",
    what: "threshold: 70 -> 55",
    scoreBefore: null as number | null, scoreAfter: null as number | null,
    effect7d: null as string | null, effect14d: null as string | null,
  },
];

export function GovernanceVisual({ isDark }: VisualProps) {
  const t = themeColors(isDark);

  return (
    <div className="w-full space-y-2">
      {overrides.map((o, i) => (
        <motion.div
          key={i} {...fadeItem}
          transition={{ duration: 0.4, delay: i * 0.12 }}
          className="rounded-lg p-3"
          style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="font-mono text-[8.5px] tracking-[0.08em] uppercase"
              style={{ color: t.textDim }}
            >
              {o.date}
            </span>
            <span
              className="rounded px-1.5 py-[2px] font-mono text-[8.5px] tracking-[0.08em] uppercase"
              style={{ backgroundColor: `${C.accent}15`, color: C.accent }}
            >
              {o.who}
            </span>
            <span
              className="font-mono text-[8.5px] tracking-[0.08em] uppercase"
              style={{ color: t.textDim }}
            >
              {o.target}
            </span>
          </div>

          <div className="text-[9.5px] leading-[1.5]" style={{ color: t.text }}>
            {o.action}
          </div>
          <div className="mt-1 font-mono text-[8.5px]" style={{ color: t.textDim }}>
            {o.what}
          </div>

          {o.scoreBefore !== null && (
            <div
              className="mt-2 pt-2 flex items-center gap-3"
              style={{ borderTop: `1px solid ${t.border}` }}
            >
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[13px]" style={{ color: t.text }}>
                  {o.scoreBefore}
                </span>
                <span className="font-mono text-[10px]" style={{ color: C.emerald }}>
                  -&gt;
                </span>
                <span className="font-mono text-[13px]" style={{ color: t.text }}>
                  {o.scoreAfter}
                </span>
                <span className="font-mono text-[9px]" style={{ color: C.emerald }}>
                  +{(o.scoreAfter ?? 0) - (o.scoreBefore ?? 0)}
                </span>
              </div>
              <div className="flex gap-2 ml-auto font-mono text-[8.5px]">
                <span style={{ color: t.textDim }}>
                  7d: <span style={{ color: C.emerald }}>{o.effect7d}</span>
                </span>
                <span style={{ color: t.textDim }}>
                  14d: <span style={{ color: C.emerald }}>{o.effect14d}</span>
                </span>
              </div>
            </div>
          )}
        </motion.div>
      ))}

      {/* Policy snapshot */}
      <motion.div
        {...fadeItem} transition={{ delay: 0.4 }}
        className="rounded-md p-2 flex items-center justify-between"
        style={{ backgroundColor: t.cardDeep, border: `1px solid ${t.border}` }}
      >
        <div
          className="font-mono text-[8.5px] tracking-[0.1em] uppercase"
          style={{ color: t.textDim }}
        >
          Policy Snapshot
        </div>
        <div className="flex items-center gap-2 text-[9.5px]">
          <span
            className="rounded px-1.5 py-[2px] font-mono text-[8.5px] tracking-[0.08em] uppercase"
            style={{ backgroundColor: `${C.accent}15`, color: C.accent }}
          >
            v2
          </span>
          <span style={{ color: t.textDim }}>
            Added link channel after Q1 review
          </span>
        </div>
      </motion.div>
    </div>
  );
}
