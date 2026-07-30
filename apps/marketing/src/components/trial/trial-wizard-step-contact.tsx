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
    <div className="space-y-4">
      <div>
        <Label className="text-[#F0EDE8]">{t("contactTitle")}</Label>
        <p className="mt-0.5 text-xs text-[#9B9690]">
          {t("contactDesc")}
        </p>
      </div>
      <div className="space-y-3">
        <div>
          <Label
            htmlFor="trial-email"
            className="text-xs text-[#9B9690]"
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
            className="mt-1 border-[#F0EDE8]/[0.06] bg-[#131314] text-[#F0EDE8] placeholder:text-[#9B9690]/50"
          />
          {emailError && (
            <p
              id="trial-email-error"
              role="alert"
              className="mt-1 text-xs text-red-400"
            >
              {emailError}
            </p>
          )}
        </div>
        <div>
          <Label
            htmlFor="trial-name"
            className="text-xs text-[#9B9690]"
          >
            {t("nameLabel")}
          </Label>
          <Input
            id="trial-name"
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="mt-1 border-[#F0EDE8]/[0.06] bg-[#131314] text-[#F0EDE8] placeholder:text-[#9B9690]/50"
          />
        </div>
      </div>
    </div>
  );
}
