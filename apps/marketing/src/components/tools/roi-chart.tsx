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
      <h2 className="text-text-dark-primary font-semibold text-[20px] mb-4">
        {t("chartTitle")}
      </h2>
      <div className="rounded-xl border border-brand-border/60 bg-brand-bg-alt/30 p-6">
        <div className="h-72 min-h-[18rem]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis
                dataKey="name"
                tick={{ fill: "#9B9690", fontSize: 13 }}
                axisLine={{ stroke: "#3a3a3c" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#9B9690", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatDollar}
              />
              <Tooltip
                formatter={(value: unknown) => formatDollar(Number(value))}
                contentStyle={{
                  backgroundColor: "#1A1A1C",
                  border: "1px solid #3a3a3c",
                  borderRadius: 8,
                  color: "#F0EDE8",
                  fontSize: 13,
                }}
              />
              <Bar dataKey={t("manual")} fill="#9B9690" radius={[4, 4, 0, 0]} />
              <Bar
                dataKey={t("automated")}
                fill="#D97757"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
