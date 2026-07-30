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
      value: result.paybackPeriodMonths > 0
        ? result.paybackPeriodMonths.toFixed(1)
        : "--",
      suffix: t("months"),
    },
  ];

  return (
    <div>
      <h2 className="text-text-dark-primary font-semibold text-[20px] mb-4">
        {t("results")}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-brand-border/60 bg-brand-bg-alt/30 p-5"
          >
            <p className="text-text-dark-secondary text-[12px] mb-1">
              {card.label}
            </p>
            <p
              className={`font-bold text-[24px] ${
                card.highlight
                  ? "text-brand-accent"
                  : "text-text-dark-primary"
              }`}
            >
              {card.value}
              {card.suffix && (
                <span className="text-text-dark-secondary text-[13px] font-normal ml-1">
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
