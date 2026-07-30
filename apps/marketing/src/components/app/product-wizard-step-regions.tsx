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
    <div className="space-y-4">
      <div>
        <Label className={isBrand ? "text-text-dark-primary" : "text-zinc-900"}>
          {t("targetRegions")}
        </Label>
        <p
          className={`mt-0.5 text-xs ${isBrand ? "text-text-dark-secondary" : "text-zinc-500"}`}
        >
          {t("targetRegionsDesc")}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {REGIONS.map((region) => {
          const selected = targetRegions.includes(region.value);
          return (
            <label
              key={region.value}
              className={
                "flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm transition-colors " +
                (selected
                  ? isBrand
                    ? "border-brand-accent bg-brand-accent/10 text-text-dark-primary"
                    : "border-zinc-400 bg-zinc-100 text-zinc-900"
                  : isBrand
                    ? "border-brand-border text-text-dark-secondary hover:border-brand-accent/40"
                    : "border-zinc-200 text-zinc-500 hover:border-zinc-300")
              }
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleRegion(region.value)}
                className={isBrand ? "accent-amber-600" : "accent-zinc-900"}
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
