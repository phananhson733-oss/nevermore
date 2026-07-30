// @input  -- next-intl, ui/button, lucide-react, product-wizard-constants (TOTAL_STEPS)
// @output -- WizardNav bottom navigation bar (back/cancel + next/submit)
// @pos    -- Products module, navigation footer for ProductWizard (SPEC 3.3)
// Once this file is updated, update the header comment and the folder _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { TOTAL_STEPS } from "@/components/app/product-wizard-constants";

type NavVariant = "app" | "brand";

export interface WizardNavProps {
  readonly step: number;
  readonly totalSteps?: number;
  readonly loading: boolean;
  readonly canProceed: boolean;
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
  readonly submitLabel?: string;
  readonly submittingLabel?: string;
  readonly variant?: NavVariant;
}

const navVariantStyles: Record<
  NavVariant,
  { outline: string; primary: string }
> = {
  app: {
    outline: "border-zinc-200 text-zinc-500",
    primary:
      "bg-zinc-900 text-white hover:bg-zinc-800 transition-colors duration-150",
  },
  brand: {
    outline: "border-brand-border text-text-dark-secondary",
    primary:
      "bg-brand-accent text-white hover:bg-brand-accent-hover transition-colors duration-150",
  },
};

export function WizardNav({
  step,
  totalSteps = TOTAL_STEPS,
  loading,
  canProceed,
  onBack,
  onNext,
  onCancel,
  onSubmit,
  submitLabel,
  submittingLabel,
  variant = "app",
}: WizardNavProps) {
  const t = useTranslations("app.products");
  const tc = useTranslations("app.common");
  const styles = navVariantStyles[variant];

  return (
    <div className="mt-6 flex items-center justify-between">
      <div>
        {step > 1 ? (
          <Button
            variant="outline"
            onClick={onBack}
            disabled={loading}
            className={styles.outline}
          >
            {tc("back")}
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={loading}
            className={styles.outline}
          >
            {tc("cancel")}
          </Button>
        )}
      </div>
      <div>
        {step < totalSteps ? (
          <Button
            onClick={onNext}
            disabled={!canProceed}
            className={styles.primary}
          >
            {tc("next")}
          </Button>
        ) : (
          <Button
            onClick={onSubmit}
            disabled={!canProceed || loading}
            className={styles.primary}
          >
            {loading ? (
              <>
                <Loader2 className="mr-1 size-4 animate-spin" />
                {submittingLabel ?? t("creating")}
              </>
            ) : (
              (submitLabel ?? t("createProduct"))
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
