// @input  — next-intl, ui/button, ui/input, ui/label, lucide-react
// @output — WaitlistProfileStep 渐进补充资料组件（Step 2: name/company/role）
// @pos    — Waitlist 表单第二步，由 waitlist-form.tsx 引用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { type useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle } from "lucide-react";

const ROLE_OPTIONS = [
  { value: "founder", labelKey: "roleFounder" },
  { value: "pm", labelKey: "rolePM" },
  { value: "operator", labelKey: "roleOperator" },
  { value: "analyst", labelKey: "roleAnalyst" },
] as const;

export interface WaitlistProfileStepProps {
  t: ReturnType<typeof useTranslations<"waitlist">>;
  name: string;
  company: string;
  role: string;
  onNameChange: (v: string) => void;
  onCompanyChange: (v: string) => void;
  onRoleChange: (v: string) => void;
  onSubmit: (e: React.SubmitEvent) => void;
  onSkip: () => void;
}

export function WaitlistProfileStep({
  t,
  name,
  company,
  role,
  onNameChange,
  onCompanyChange,
  onRoleChange,
  onSubmit,
  onSkip,
}: WaitlistProfileStepProps) {
  return (
    <div className="py-2">
      <div className="text-center mb-6" role="status" aria-live="polite">
        <CheckCircle
          className="size-8 text-brand-success mx-auto mb-2"
          aria-hidden="true"
        />
        <h3 className="text-text-dark-primary font-semibold text-lg mb-1">
          {t("successTitle")}
        </h3>
        <p className="text-text-dark-secondary text-sm">{t("successDesc")}</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label
            htmlFor="waitlist-name"
            className="text-text-dark-secondary text-sm"
          >
            {t("nameLabel")}
          </Label>
          <Input
            id="waitlist-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="mt-1 bg-brand-bg border-brand-border text-text-dark-primary"
          />
        </div>

        <div>
          <Label
            htmlFor="waitlist-company"
            className="text-text-dark-secondary text-sm"
          >
            {t("companyLabel")}
          </Label>
          <Input
            id="waitlist-company"
            value={company}
            onChange={(e) => onCompanyChange(e.target.value)}
            className="mt-1 bg-brand-bg border-brand-border text-text-dark-primary"
          />
        </div>

        <div>
          <Label
            htmlFor="waitlist-role"
            className="text-text-dark-secondary text-sm"
          >
            {t("roleLabel")}
          </Label>
          <select
            id="waitlist-role"
            value={role}
            onChange={(e) => onRoleChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg text-text-dark-primary h-9 px-3 text-sm"
          >
            <option value="">{t("rolePlaceholder")}</option>
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <Button
            type="submit"
            className="flex-1 bg-brand-accent hover:bg-brand-accent-hover text-white text-sm"
          >
            {t("saveProfile")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onSkip}
            className="text-sm"
          >
            {t("skip")}
          </Button>
        </div>
      </form>
    </div>
  );
}
