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
      <div className="mb-7 text-center" role="status" aria-live="polite">
        <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-[10px] border border-brand-accent/25 bg-brand-accent-soft text-brand-accent">
          <CheckCircle className="size-4" aria-hidden="true" />
        </span>
        <h3 className="mb-1.5 text-[16.5px] font-semibold text-text-dark-primary">
          {t("successTitle")}
        </h3>
        <p className="text-[13px] leading-[1.6] text-text-dark-secondary">
          {t("successDesc")}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <Label
            htmlFor="waitlist-name"
            className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase"
          >
            {t("nameLabel")}
          </Label>
          <Input
            id="waitlist-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="mt-2"
          />
        </div>

        <div>
          <Label
            htmlFor="waitlist-company"
            className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase"
          >
            {t("companyLabel")}
          </Label>
          <Input
            id="waitlist-company"
            value={company}
            onChange={(e) => onCompanyChange(e.target.value)}
            className="mt-2"
          />
        </div>

        <div>
          <Label
            htmlFor="waitlist-role"
            className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase"
          >
            {t("roleLabel")}
          </Label>
          <select
            id="waitlist-role"
            value={role}
            onChange={(e) => onRoleChange(e.target.value)}
            className="mt-2 h-11 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 text-[14px] text-text-dark-primary transition-colors outline-none focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            <option value="">{t("rolePlaceholder")}</option>
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2.5">
          <Button type="submit" variant="cta" size="lg" className="flex-1">
            {t("saveProfile")}
          </Button>
          <Button type="button" variant="ghost" size="lg" onClick={onSkip}>
            {t("skip")}
          </Button>
        </div>
      </form>
    </div>
  );
}
