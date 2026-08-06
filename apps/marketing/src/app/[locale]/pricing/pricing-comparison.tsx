// @input  -- next-intl, framer-motion
// @output -- PricingComparison component (feature comparison table)
// @pos    -- pricing page sub-component, rendered by pricing-page-client
// Once this file is updated, update the header comment and the folder's _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/animations";
import { Check, Minus } from "lucide-react";

type Support = boolean | string;

interface ComparisonRow {
  key: string;
  starter: Support;
  pro: Support;
  growth: Support;
}

const ROWS: ComparisonRow[] = [
  { key: "discovery", starter: true, pro: true, growth: true },
  { key: "strategyScoring", starter: true, pro: true, growth: true },
  { key: "priorityRanking", starter: true, pro: true, growth: true },
  { key: "weeklyReports", starter: true, pro: true, growth: true },
  { key: "automatedExecution", starter: false, pro: true, growth: true },
  { key: "channelAttribution", starter: false, pro: true, growth: true },
  { key: "dataIntegrity", starter: false, pro: true, growth: true },
  { key: "selfOptimization", starter: false, pro: true, growth: true },
  { key: "socialValidation", starter: false, pro: true, growth: true },
  { key: "products", starter: "1", pro: "3", growth: "unlimited" },
  { key: "playbookReuse", starter: false, pro: false, growth: true },
  { key: "competitorMonitoring", starter: false, pro: false, growth: true },
  { key: "prioritySupport", starter: false, pro: false, growth: true },
  { key: "customTemplates", starter: false, pro: false, growth: true },
];

function CellValue({ value, t }: { value: Support; t: (key: string) => string }) {
  if (value === true) {
    return (
      <Check className="mx-auto size-[15px] text-brand-accent" aria-label="Yes" />
    );
  }
  if (value === false) {
    return (
      <Minus
        className="mx-auto size-[15px] text-text-dark-secondary"
        aria-label="No"
      />
    );
  }
  const label = value === "unlimited" ? t("unlimited") : value;
  return (
    <span className="font-mono text-[12.5px] text-text-dark-primary">
      {label}
    </span>
  );
}

export function PricingComparison() {
  const t = useTranslations("pricing.comparison");

  return (
    <>
      <motion.h2
        {...fadeInUp}
        whileInView="animate"
        initial="initial"
        viewport={{ once: true }}
        className="mb-9 text-center text-text-dark-primary"
      >
        {t("title")}
      </motion.h2>

      <motion.div
        {...fadeInUp}
        whileInView="animate"
        initial="initial"
        viewport={{ once: true }}
        transition={{ ...fadeInUp.transition, delay: 0.15 }}
        className="overflow-x-auto rounded-card border border-brand-border-card bg-brand-panel"
      >
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="border-b border-brand-border">
              <th className="px-5 py-3.5 text-left font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
                {t("feature")}
              </th>
              <th className="px-5 py-3.5 text-center font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
                {t("starterLabel")}
              </th>
              <th className="px-5 py-3.5 text-center font-mono text-[10px] tracking-[0.12em] text-brand-accent-text uppercase">
                {t("proLabel")}
              </th>
              <th className="px-5 py-3.5 text-center font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
                {t("growthLabel")}
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr
                key={row.key}
                className="border-b border-brand-border-faint transition-colors last:border-b-0 hover:bg-brand-panel-raised"
              >
                <td className="px-5 py-3 text-[13px] leading-[1.6] text-text-dark-strong">
                  {t(`rows.${row.key}`)}
                </td>
                <td className="px-5 py-3 text-center">
                  <CellValue value={row.starter} t={t} />
                </td>
                <td className="px-5 py-3 text-center">
                  <CellValue value={row.pro} t={t} />
                </td>
                <td className="px-5 py-3 text-center">
                  <CellValue value={row.growth} t={t} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </motion.div>
    </>
  );
}
