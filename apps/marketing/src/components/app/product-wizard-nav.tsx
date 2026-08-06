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

/*
 * 两个 variant 都在深色面上：app 走中性实心，brand 走唯一的品牌渐变（弹窗里
 * 只有这一个主 CTA）。次按钮一律无投影，层级只靠描边。
 */
const navVariantStyles: Record<
  NavVariant,
  { outline: string; primary: string }
> = {
  app: {
    outline:
      "border-brand-border text-text-dark-secondary hover:border-brand-border-strong",
    primary:
      "bg-brand-accent text-brand-on-accent hover:bg-brand-accent-hover transition-colors duration-150",
  },
  brand: {
    outline:
      "border-brand-border-strong text-text-dark-primary hover:border-brand-accent/50",
    primary:
      "bg-brand-gradient text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta",
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
    <div className="mt-7 flex items-center justify-between border-t border-brand-border pt-5">
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
