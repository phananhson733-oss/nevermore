// @input  -- product-wizard-types (StepGoalProps), product-wizard-constants (EXPERIMENT_GOALS), next-intl, ui/label
// @output -- WizardStepGoal component (step 3: experiment goal selection)
// @pos    -- Products module, step 3 of ProductWizard (SPEC 3.3)
// Once this file is updated, update the header comment and the folder _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { EXPERIMENT_GOALS } from "@/components/app/product-wizard-constants";
import type { StepGoalProps } from "@/components/app/product-wizard-types";

export function WizardStepGoal({
  experimentGoal,
  onExperimentGoalChange,
  variant = "app",
}: StepGoalProps & { readonly variant?: "app" | "brand" }) {
  const t = useTranslations("app.products");
  const isBrand = variant === "brand";

  const goalLabels: Record<string, string> = {
    organic_signup_growth: t("organicSignup"),
    organic_traffic_growth: t("organicTraffic"),
    brand_awareness: t("brandAwareness"),
    lead_generation: t("leadGeneration"),
  };

  return (
    <div className="space-y-5">
      <div>
        <Label
          className={
            "text-[14px] font-semibold " +
            (isBrand ? "text-text-dark-primary" : "text-text-dark-strong")
          }
        >
          {t("experimentGoal")}
        </Label>
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t("experimentGoalDesc")}
        </p>
      </div>
      <div className="space-y-2.5">
        {EXPERIMENT_GOALS.map((goal) => (
          <label
            key={goal.value}
            className={
              "flex cursor-pointer items-center gap-3 rounded-[10px] border p-3.5 text-[13px] transition-colors " +
              (experimentGoal === goal.value
                ? isBrand
                  ? "border-brand-accent/50 bg-brand-accent/[0.08] text-text-dark-primary"
                  : "border-brand-border-strong bg-brand-panel-raised text-text-dark-primary"
                : isBrand
                  ? "border-brand-border-strong text-text-dark-secondary hover:border-brand-accent/40"
                  : "border-brand-border text-text-dark-secondary hover:border-brand-border-strong")
            }
          >
            <input
              type="radio"
              name="experiment_goal"
              checked={experimentGoal === goal.value}
              onChange={() => onExperimentGoalChange(goal.value)}
              className={
                isBrand ? "accent-brand-accent" : "accent-brand-accent-2"
              }
            />
            {goalLabels[goal.value]}
          </label>
        ))}
      </div>
    </div>
  );
}
