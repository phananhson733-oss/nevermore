// @input  -- locale prop, calculateSampleSize from calculations.ts, tools.abTest i18n
// @output -- ABTestCalculator client component with reactive form and results
// @pos    -- interactive calculator widget, rendered by ab-test-calculator/page.tsx
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  calculateSampleSize,
  type SampleSizeParams,
} from "@/lib/tools/calculations";
import {
  InputField,
  SelectField,
  ResultRow,
} from "@/components/tools/ab-test-form-fields";

interface ABTestCalculatorProps {
  readonly locale: string;
}

export function ABTestCalculator({ locale }: ABTestCalculatorProps) {
  const t = useTranslations("tools.abTest");

  const [baselineRate, setBaselineRate] = useState(5);
  const [mde, setMde] = useState(20);
  const [significance, setSignificance] = useState<0.9 | 0.95 | 0.99>(0.95);
  const [power, setPower] = useState<0.8 | 0.9>(0.8);
  const [dailyTraffic, setDailyTraffic] = useState("");

  const result = useMemo(() => {
    if (baselineRate <= 0 || baselineRate > 100 || mde <= 0) {
      return null;
    }
    const params: SampleSizeParams = {
      baselineRate: baselineRate / 100,
      minimumDetectableEffect: mde / 100,
      significanceLevel: significance,
      power,
    };
    try {
      return calculateSampleSize(params);
    } catch {
      return null;
    }
  }, [baselineRate, mde, significance, power]);

  const estimatedDays = useMemo(() => {
    const traffic = Number(dailyTraffic);
    if (!result || !traffic || traffic <= 0) return null;
    return Math.ceil(result.totalSampleSize / traffic);
  }, [result, dailyTraffic]);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* Form */}
      <div className="rounded-card border border-brand-border-card bg-brand-panel p-[26px]">
        <div className="space-y-4">
          <InputField
            label={t("baselineRate")}
            value={baselineRate}
            onChange={setBaselineRate}
            min={0.01}
            max={100}
            step={0.1}
          />
          <InputField
            label={t("mde")}
            value={mde}
            onChange={setMde}
            min={0.1}
            max={1000}
            step={0.1}
          />
          <SelectField
            label={t("significance")}
            value={String(significance)}
            onChange={(v) => setSignificance(Number(v) as 0.9 | 0.95 | 0.99)}
            options={[
              { value: "0.9", label: "90%" },
              { value: "0.95", label: "95%" },
              { value: "0.99", label: "99%" },
            ]}
          />
          <SelectField
            label={t("power")}
            value={String(power)}
            onChange={(v) => setPower(Number(v) as 0.8 | 0.9)}
            options={[
              { value: "0.8", label: "80%" },
              { value: "0.9", label: "90%" },
            ]}
          />
          <InputField
            label={t("dailyTraffic")}
            value={dailyTraffic === "" ? "" : Number(dailyTraffic)}
            onChange={(v) => setDailyTraffic(String(v))}
            min={0}
            step={1}
            optional
          />
        </div>
      </div>

      {/* Results */}
      <div className="rounded-card border border-brand-border-card bg-brand-panel p-[26px]">
        <h2 className="text-[16.5px] font-semibold text-text-dark-primary">
          {t("results")}
        </h2>
        {result ? (
          /* 1px gap + 分隔色底 = 伪表格，把三个数字读成同一张读数表 */
          <div className="mt-5 grid gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card">
            <ResultRow
              label={t("samplePerVariation")}
              value={result.sampleSizePerVariation.toLocaleString(locale)}
            />
            <ResultRow
              label={t("totalSample")}
              value={result.totalSampleSize.toLocaleString(locale)}
              accent
            />
            {estimatedDays !== null && (
              <ResultRow
                label={t("estimatedDuration")}
                value={`${estimatedDays.toLocaleString(locale)} ${t("days")}`}
              />
            )}
          </div>
        ) : (
          <p className="mt-4 text-[13px] leading-[1.6] text-text-dark-secondary">
            {locale === "en"
              ? "Enter valid parameters to see results."
              : "请输入有效参数以查看结果。"}
          </p>
        )}
      </div>
    </div>
  );
}
