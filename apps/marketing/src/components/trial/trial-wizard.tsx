// @input  -- react, next-intl, product-wizard step components, trial-step-contact
// @output -- TrialWizard 4-step orchestrator (contact -> url -> regions -> goal+event)
// @pos    -- Trial module, main wizard orchestrator, SPEC 2.4.2
// Once this file is updated, update header comment and folder _DIR.md
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { CheckCircle } from "lucide-react";
import {
  isValidUrl,
  normalizeUrl,
} from "@/components/app/product-wizard-constants";
import { StepIndicator } from "@/components/app/product-wizard-step-indicator";
import { WizardStepUrl } from "@/components/app/product-wizard-step-url";
import { WizardStepRegions } from "@/components/app/product-wizard-step-regions";
import { WizardStepGoal } from "@/components/app/product-wizard-step-goal";
import { WizardStepEvent } from "@/components/app/product-wizard-step-event";
import { WizardNav } from "@/components/app/product-wizard-nav";
import { TrialStepContact } from "./trial-wizard-step-contact";

const TRIAL_STEPS = 4;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function TrialWizard() {
  const t = useTranslations("trial");
  const locale = useLocale();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Contact fields (step 1)
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [emailError, setEmailError] = useState("");

  // Product fields (steps 2-4)
  const [productUrl, setProductUrl] = useState("");
  const [targetRegions, setTargetRegions] = useState<string[]>([]);
  const [experimentGoal, setExperimentGoal] = useState("");
  const [conversionEvent, setConversionEvent] = useState("");

  function toggleRegion(region: string) {
    setTargetRegions((prev) =>
      prev.includes(region)
        ? prev.filter((r) => r !== region)
        : [...prev, region],
    );
  }

  function canProceed(): boolean {
    switch (step) {
      case 1:
        return EMAIL_REGEX.test(email);
      case 2:
        return isValidUrl(productUrl);
      case 3:
        return targetRegions.length > 0;
      case 4:
        return experimentGoal !== "" && conversionEvent !== "";
      default:
        return false;
    }
  }

  function handleNext() {
    setError(null);
    setEmailError("");
    if (step === 2) {
      setProductUrl(normalizeUrl(productUrl));
    }
    if (step < TRIAL_STEPS) {
      setStep(step + 1);
    }
  }

  function handleBack() {
    setError(null);
    setEmailError("");
    if (step > 1) {
      setStep(step - 1);
    }
  }

  async function handleSubmit() {
    if (!canProceed()) return;

    if (!EMAIL_REGEX.test(email)) {
      setEmailError(t("emailInvalid"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        email,
        name: name.trim() || undefined,
        product_url: productUrl,
        target_regions: targetRegions,
        experiment_goal: experimentGoal,
        primary_conversion_event: conversionEvent,
        locale,
        landing_page: window.location.pathname,
      };

      const res = await fetch("/api/trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (!res.ok) {
        if (json.error?.code === "DUPLICATE_EMAIL") {
          setError(t("duplicateError"));
        } else {
          setError(json.error?.message ?? t("genericError"));
        }
        return;
      }

      setDone(true);
    } catch {
      setError(t("genericError"));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="py-8 text-center" role="status" aria-live="polite">
        <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-[10px] border border-brand-accent/25 bg-brand-accent-soft text-brand-accent">
          <CheckCircle className="size-[18px]" aria-hidden="true" />
        </span>
        <h3 className="mb-2 text-[16.5px] font-semibold text-text-dark-primary">
          {t("successTitle")}
        </h3>
        <p className="text-[13px] leading-[1.6] text-text-dark-secondary">
          {t("successDesc")}
        </p>
      </div>
    );
  }

  return (
    <div>
      <StepIndicator current={step} total={TRIAL_STEPS} variant="brand" />

      <div className="mt-7 max-h-[60vh] min-h-[220px] overflow-y-auto">
        {step === 1 && (
          <TrialStepContact
            email={email}
            onEmailChange={setEmail}
            name={name}
            onNameChange={setName}
            emailError={emailError}
          />
        )}
        {step === 2 && (
          <WizardStepUrl
            productUrl={productUrl}
            onProductUrlChange={setProductUrl}
            variant="brand"
          />
        )}
        {step === 3 && (
          <WizardStepRegions
            targetRegions={targetRegions}
            onToggleRegion={toggleRegion}
            variant="brand"
          />
        )}
        {step === 4 && (
          <div className="space-y-6">
            <WizardStepGoal
              experimentGoal={experimentGoal}
              onExperimentGoalChange={setExperimentGoal}
              variant="brand"
            />
            <WizardStepEvent
              conversionEvent={conversionEvent}
              onConversionEventChange={setConversionEvent}
              variant="brand"
            />
          </div>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-[10px] border border-brand-error/25 bg-brand-error/10 px-3.5 py-2.5 text-[12.5px] leading-[1.6] text-brand-error">
          {error}
        </p>
      )}

      <WizardNav
        step={step}
        totalSteps={TRIAL_STEPS}
        loading={loading}
        canProceed={canProceed()}
        onBack={handleBack}
        onNext={handleNext}
        onCancel={() => {}}
        onSubmit={handleSubmit}
        submitLabel={t("submitTrial")}
        submittingLabel={t("submitting")}
        variant="brand"
      />
    </div>
  );
}
