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
    active:
      "border border-brand-border-strong bg-brand-panel-raised text-text-dark-primary",
    complete:
      "border border-brand-border bg-brand-panel text-text-dark-secondary",
    inactive:
      "border border-brand-border bg-brand-panel-sunken text-text-dark-faint",
  },
  brand: {
    active: "bg-brand-accent text-brand-on-accent",
    complete:
      "border border-brand-accent/40 bg-brand-accent/12 text-brand-accent-text",
    inactive:
      "border border-brand-border-strong bg-brand-panel-sunken text-text-dark-faint",
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
              "flex size-8 items-center justify-center rounded-full font-mono text-[11px] font-semibold transition-colors " +
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
