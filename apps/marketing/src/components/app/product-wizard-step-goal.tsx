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
    <div className="space-y-4">
      <div>
        <Label className={isBrand ? "text-text-dark-primary" : "text-zinc-900"}>
          {t("experimentGoal")}
        </Label>
        <p
          className={`mt-0.5 text-xs ${isBrand ? "text-text-dark-secondary" : "text-zinc-500"}`}
        >
          {t("experimentGoalDesc")}
        </p>
      </div>
      <div className="space-y-2">
        {EXPERIMENT_GOALS.map((goal) => (
          <label
            key={goal.value}
            className={
              "flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm transition-colors " +
              (experimentGoal === goal.value
                ? isBrand
                  ? "border-brand-accent bg-brand-accent/10 text-text-dark-primary"
                  : "border-zinc-400 bg-zinc-100 text-zinc-900"
                : isBrand
                  ? "border-brand-border text-text-dark-secondary hover:border-brand-accent/40"
                  : "border-zinc-200 text-zinc-500 hover:border-zinc-300")
            }
          >
            <input
              type="radio"
              name="experiment_goal"
              checked={experimentGoal === goal.value}
              onChange={() => onExperimentGoalChange(goal.value)}
              className={isBrand ? "accent-amber-600" : "accent-zinc-900"}
            />
            {goalLabels[goal.value]}
          </label>
        ))}
      </div>
    </div>
  );
}
