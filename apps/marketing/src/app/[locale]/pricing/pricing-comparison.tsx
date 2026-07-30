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
      <Check className="size-4 text-brand-accent mx-auto" aria-label="Yes" />
    );
  }
  if (value === false) {
    return (
      <Minus
        className="size-4 text-text-dark-secondary/40 mx-auto"
        aria-label="No"
      />
    );
  }
  const label = value === "unlimited" ? t("unlimited") : value;
  return (
    <span className="text-text-dark-primary text-sm font-medium">{label}</span>
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
        className="text-text-dark-primary font-semibold text-center mb-12"
      >
        {t("title")}
      </motion.h2>

      <motion.div
        {...fadeInUp}
        whileInView="animate"
        initial="initial"
        viewport={{ once: true }}
        transition={{ ...fadeInUp.transition, delay: 0.15 }}
        className="overflow-x-auto"
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left text-text-dark-secondary py-3 px-4 font-medium">
                {t("feature")}
              </th>
              <th className="text-center text-text-dark-primary py-3 px-4 font-semibold">
                {t("starterLabel")}
              </th>
              <th className="text-center text-brand-accent py-3 px-4 font-semibold">
                {t("proLabel")}
              </th>
              <th className="text-center text-text-dark-primary py-3 px-4 font-semibold">
                {t("growthLabel")}
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr
                key={row.key}
                className="border-b border-white/5 hover:bg-white/[0.02]"
              >
                <td className="text-text-dark-secondary py-3 px-4">
                  {t(`rows.${row.key}`)}
                </td>
                <td className="text-center py-3 px-4">
                  <CellValue value={row.starter} t={t} />
                </td>
                <td className="text-center py-3 px-4">
                  <CellValue value={row.pro} t={t} />
                </td>
                <td className="text-center py-3 px-4">
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
