// @input  -- next-intl, ui/input, ui/label
// @output -- TrialStepContact component (step 5: email + name)
// @pos    -- Trial module, step 5 of TrialWizard, SPEC 2.4.2
// Once this file is updated, update header comment and folder _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface StepContactProps {
  readonly email: string;
  readonly onEmailChange: (value: string) => void;
  readonly name: string;
  readonly onNameChange: (value: string) => void;
  readonly emailError?: string;
}

export function TrialStepContact({
  email,
  onEmailChange,
  name,
  onNameChange,
  emailError,
}: StepContactProps) {
  const t = useTranslations("trial");

  return (
    <div className="space-y-5">
      <div>
        <Label className="text-[14px] font-semibold text-text-dark-primary">
          {t("contactTitle")}
        </Label>
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t("contactDesc")}
        </p>
      </div>
      <div className="space-y-4">
        <div>
          <Label
            htmlFor="trial-email"
            className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase"
          >
            {t("emailLabel")}
          </Label>
          <Input
            id="trial-email"
            type="email"
            required
            aria-required="true"
            aria-describedby={emailError ? "trial-email-error" : undefined}
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder={t("emailPlaceholder")}
            className="mt-2"
          />
          {emailError && (
            <p
              id="trial-email-error"
              role="alert"
              className="mt-2 text-[12.5px] text-brand-error"
            >
              {emailError}
            </p>
          )}
        </div>
        <div>
          <Label
            htmlFor="trial-name"
            className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase"
          >
            {t("nameLabel")}
          </Label>
          <Input
            id="trial-name"
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="mt-2"
          />
        </div>
      </div>
    </div>
  );
}
