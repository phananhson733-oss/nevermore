// @input  -- manual/automated cost and revenue numbers, locale
// @output -- ROIChart component with lazy-loaded Recharts BarChart comparing before/after
// @pos    -- tools component, child of ROICalculator
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

const ResponsiveContainer = dynamic(
  () => import("recharts").then((m) => m.ResponsiveContainer),
  { ssr: false },
);
const BarChart = dynamic(() => import("recharts").then((m) => m.BarChart), {
  ssr: false,
});
const Bar = dynamic(() => import("recharts").then((m) => m.Bar), {
  ssr: false,
});
const XAxis = dynamic(() => import("recharts").then((m) => m.XAxis), {
  ssr: false,
});
const YAxis = dynamic(() => import("recharts").then((m) => m.YAxis), {
  ssr: false,
});
const Tooltip = dynamic(() => import("recharts").then((m) => m.Tooltip), {
  ssr: false,
});

interface ROIChartProps {
  readonly manualCost: number;
  readonly automatedCost: number;
  readonly manualRevenue: number;
  readonly projectedRevenue: number;
  readonly locale: string;
}

function formatDollar(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

export function ROIChart({
  manualCost,
  automatedCost,
  manualRevenue,
  projectedRevenue,
  locale,
}: ROIChartProps) {
  const t = useTranslations("tools.roi");

  const data = [
    {
      name: locale === "en" ? "Cost" : "成本",
      [t("manual")]: manualCost,
      [t("automated")]: Math.max(0, automatedCost),
    },
    {
      name: locale === "en" ? "Revenue" : "收入",
      [t("manual")]: manualRevenue,
      [t("automated")]: projectedRevenue,
    },
  ];

  return (
    <div>
      <h2 className="text-[16.5px] font-semibold text-text-dark-primary">
        {t("chartTitle")}
      </h2>
      <div className="mt-4 rounded-card border border-brand-border-card bg-brand-panel p-[22px]">
        <div className="h-72 min-h-[18rem]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis
                dataKey="name"
                tick={{
                  fill: "#8B96A5",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                }}
                axisLine={{ stroke: "#1B2430" }}
                tickLine={false}
              />
              <YAxis
                tick={{
                  fill: "#8B96A5",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                }}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatDollar}
              />
              <Tooltip
                cursor={{ fill: "rgba(76,195,250,0.06)" }}
                formatter={(value: unknown) => formatDollar(Number(value))}
                contentStyle={{
                  backgroundColor: "#0E141C",
                  border: "1px solid #1E2937",
                  borderRadius: 10,
                  color: "#E8EDF2",
                  fontSize: 12.5,
                  fontFamily: "var(--font-mono)",
                }}
              />
              {/*
               * 两条序列必须靠形状区分，不能只靠颜色：绿与青在 deuteranopia 下
               * 差异不足以单独承担辨识。基线（manual）走描边空心柱，投影后的
               * automated 走实心柱，色盲与灰度打印下同样读得出哪根是哪根。
               */}
              <Bar
                dataKey={t("manual")}
                fill="rgba(76,195,250,0.14)"
                stroke="#4CC3FA"
                strokeWidth={1.5}
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey={t("automated")}
                fill="#3DDC97"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
