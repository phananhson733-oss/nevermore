// @input  -- ROIResult, locale
// @output -- ROIResultsGrid component displaying 6 key metrics in a 2-column grid
// @pos    -- tools component, child of ROICalculator
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import { useTranslations } from "next-intl";
import type { ROIResult } from "@/lib/tools/calculations";

interface ROIResultsGridProps {
  readonly result: ROIResult;
  readonly locale: string;
}

function formatCurrency(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

export function ROIResultsGrid({ result }: ROIResultsGridProps) {
  const t = useTranslations("tools.roi");

  const cards = [
    {
      label: t("timeSaved"),
      value: `${Math.round(result.timeSavedPerMonth)}`,
      suffix: t("hoursPerMonth"),
    },
    {
      label: t("costSavings"),
      value: formatCurrency(result.costSavingsPerMonth),
      suffix: t("perMonth"),
    },
    {
      label: t("conversionLift"),
      value: `+${(result.projectedConversionLift * 100).toFixed(0)}%`,
      suffix: "",
    },
    {
      label: t("additionalRevenue"),
      value: formatCurrency(result.projectedAdditionalRevenue),
      suffix: t("perMonth"),
    },
    {
      label: t("roi"),
      value: `${Math.round(result.roiPercentage)}%`,
      suffix: "",
      highlight: true,
    },
    {
      label: t("payback"),
      value:
        result.paybackPeriodMonths > 0
          ? result.paybackPeriodMonths.toFixed(1)
          : "--",
      suffix: t("months"),
    },
  ];

  return (
    <div>
      <h2 className="text-[16.5px] font-semibold text-text-dark-primary">
        {t("results")}
      </h2>
      {/*
       * 六个数字属于同一份读数，用 1px gap + 分隔色底拼成伪表格，比六张带间距的
       * 卡片更像一张表；卡片间距会把它们读成六个可独立选择的东西。
       */}
      <div className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card md:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className={`bg-brand-panel-sunken px-5 py-4 ${
              card.highlight ? "shadow-rail-accent" : ""
            }`}
          >
            <p className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
              {card.label}
            </p>
            <p
              className={`mt-2 font-mono text-[22px] ${
                card.highlight
                  ? "text-brand-accent-text"
                  : "text-text-dark-primary"
              }`}
            >
              {card.value}
              {card.suffix && (
                <span className="ml-1.5 font-mono text-[11px] text-text-dark-secondary">
                  {card.suffix}
                </span>
              )}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
