// @input  -- locale prop, tools.roi i18n messages, calculateGrowthROI
// @output -- ROICalculator client component with form, results grid, and bar chart
// @pos    -- tools component, rendered by growth-roi-calculator page
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { calculateGrowthROI } from "@/lib/tools/calculations";
import { ROIResultsGrid } from "./roi-results-grid";
import { ROIChart } from "./roi-chart";

interface ROICalculatorProps {
  readonly locale: string;
}

const DEFAULT_TRAFFIC = 10000;
const DEFAULT_CONVERSION = 3;
const DEFAULT_REVENUE = 50;
const DEFAULT_HOURS = 20;
const DEFAULT_HOURLY_COST = 50;

export function ROICalculator({ locale }: ROICalculatorProps) {
  const t = useTranslations("tools.roi");

  const [monthlyTraffic, setMonthlyTraffic] = useState(DEFAULT_TRAFFIC);
  const [conversionRate, setConversionRate] = useState(DEFAULT_CONVERSION);
  const [revenuePerCustomer, setRevenuePerCustomer] = useState(DEFAULT_REVENUE);
  const [manualHours, setManualHours] = useState(DEFAULT_HOURS);
  const [hourlyCost, setHourlyCost] = useState(DEFAULT_HOURLY_COST);

  const result = useMemo(() => {
    const rate = conversionRate / 100;
    if (
      rate < 0 ||
      rate > 1 ||
      monthlyTraffic < 0 ||
      revenuePerCustomer < 0 ||
      manualHours < 0 ||
      hourlyCost < 0
    ) {
      return null;
    }
    return calculateGrowthROI({
      monthlyTraffic,
      currentConversionRate: rate,
      revenuePerCustomer,
      manualHoursPerWeek: manualHours,
      hourlyCost,
    });
  }, [
    monthlyTraffic,
    conversionRate,
    revenuePerCustomer,
    manualHours,
    hourlyCost,
  ]);

  const manualMonthlyCost = manualHours * 4 * hourlyCost;
  const manualRevenue =
    monthlyTraffic * (conversionRate / 100) * revenuePerCustomer;

  return (
    <div className="space-y-8">
      {/* Input form */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <InputField
          label={t("monthlyTraffic")}
          value={monthlyTraffic}
          onChange={setMonthlyTraffic}
          min={0}
          step={1000}
        />
        <InputField
          label={t("conversionRate")}
          value={conversionRate}
          onChange={setConversionRate}
          min={0}
          max={100}
          step={0.1}
        />
        <InputField
          label={t("revenuePerCustomer")}
          value={revenuePerCustomer}
          onChange={setRevenuePerCustomer}
          min={0}
          step={10}
        />
        <InputField
          label={t("manualHours")}
          value={manualHours}
          onChange={setManualHours}
          min={0}
          step={1}
        />
        <InputField
          label={t("hourlyCost")}
          value={hourlyCost}
          onChange={setHourlyCost}
          min={0}
          step={5}
        />
      </div>

      {/* Results */}
      {result && (
        <>
          <ROIResultsGrid result={result} locale={locale} />
          <ROIChart
            manualCost={manualMonthlyCost}
            automatedCost={manualMonthlyCost - result.costSavingsPerMonth}
            manualRevenue={manualRevenue}
            projectedRevenue={manualRevenue + result.projectedAdditionalRevenue}
            locale={locale}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InputField (private)
// ---------------------------------------------------------------------------

interface InputFieldProps {
  readonly label: string;
  readonly value: number;
  readonly onChange: (v: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

function InputField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: InputFieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
        {label}
      </span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="h-12.5 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 font-mono text-[14px] text-text-dark-primary outline-none transition-colors focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
      />
    </label>
  );
}
