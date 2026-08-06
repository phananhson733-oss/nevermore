// @input  -- product-wizard-types (StepRegionsProps), product-wizard-constants (REGIONS), next-intl, ui/label
// @output -- WizardStepRegions component (step 2: target region selection with flags and localized names)
// @pos    -- Products module, step 2 of ProductWizard (SPEC 3.3)
// Once this file is updated, update the header comment and the folder _DIR.md
"use client";

import { useLocale, useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { REGIONS } from "@/components/app/product-wizard-constants";
import type { StepRegionsProps } from "@/components/app/product-wizard-types";

export function WizardStepRegions({
  targetRegions,
  onToggleRegion,
  variant = "app",
}: StepRegionsProps & { readonly variant?: "app" | "brand" }) {
  const t = useTranslations("app.products");
  const locale = useLocale() as "zh" | "en";
  const isBrand = variant === "brand";

  return (
    <div className="space-y-5">
      <div>
        <Label
          className={
            "text-[14px] font-semibold " +
            (isBrand ? "text-text-dark-primary" : "text-text-dark-strong")
          }
        >
          {t("targetRegions")}
        </Label>
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t("targetRegionsDesc")}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {REGIONS.map((region) => {
          const selected = targetRegions.includes(region.value);
          return (
            <label
              key={region.value}
              className={
                "flex cursor-pointer items-center gap-2 rounded-[10px] border p-2.5 text-[13px] transition-colors " +
                (selected
                  ? isBrand
                    ? "border-brand-accent/50 bg-brand-accent/[0.08] text-text-dark-primary"
                    : "border-brand-border-strong bg-brand-panel-raised text-text-dark-primary"
                  : isBrand
                    ? "border-brand-border-strong text-text-dark-secondary hover:border-brand-accent/40"
                    : "border-brand-border text-text-dark-secondary hover:border-brand-border-strong")
              }
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleRegion(region.value)}
                className={
                  isBrand ? "accent-brand-accent" : "accent-brand-accent-2"
                }
              />
              <span>{region.flag}</span>
              <span>{region.label[locale] ?? region.label.en}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
