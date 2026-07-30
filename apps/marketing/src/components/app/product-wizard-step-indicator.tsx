// @input  -- product-wizard-constants (TOTAL_STEPS)
// @output -- StepIndicator component for ProductWizard stepper
// @pos    -- Products module, step progress indicator for ProductWizard (SPEC 3.3)
// Once this file is updated, update the header comment and the folder _DIR.md

import { TOTAL_STEPS } from "@/components/app/product-wizard-constants";

type StepVariant = "app" | "brand";

const variantStyles: Record<
  StepVariant,
  { active: string; complete: string; inactive: string }
> = {
  app: {
    active: "bg-zinc-900 text-white",
    complete: "bg-zinc-900/30 text-zinc-700",
    inactive: "bg-zinc-100 text-zinc-500",
  },
  brand: {
    active: "bg-brand-accent text-white",
    complete: "bg-brand-accent/30 text-brand-accent",
    inactive: "bg-white/10 text-text-dark-secondary",
  },
};

export function StepIndicator({
  current,
  total = TOTAL_STEPS,
  variant = "app",
}: {
  readonly current: number;
  readonly total?: number;
  readonly variant?: StepVariant;
}) {
  const styles = variantStyles[variant];
  return (
    <div className="flex items-center justify-center gap-3">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1;
        const isActive = step === current;
        const isComplete = step < current;
        return (
          <div
            key={step}
            className={
              "flex size-8 items-center justify-center rounded-full text-xs font-semibold transition-colors " +
              (isActive
                ? styles.active
                : isComplete
                  ? styles.complete
                  : styles.inactive)
            }
          >
            {step}
          </div>
        );
      })}
    </div>
  );
}
