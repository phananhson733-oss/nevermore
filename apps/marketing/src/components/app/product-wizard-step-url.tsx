// @input  -- product-wizard-types (StepUrlProps), url-validation, use-url-check hook, next-intl, ui/input, ui/label
// @output -- WizardStepUrl component (step 1/2: product URL input with validation)
// @pos    -- Products module, URL input step for ProductWizard and TrialWizard (SPEC 3.3)
// Once this file is updated, update the header comment and the folder _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { Loader2, CheckCircle, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUrlCheck } from "@/hooks/use-url-check";
import type { StepUrlProps } from "@/components/app/product-wizard-types";

export function WizardStepUrl({
  productUrl,
  onProductUrlChange,
  variant = "app",
}: StepUrlProps & { readonly variant?: "app" | "brand" }) {
  const t = useTranslations("app.products");
  const isBrand = variant === "brand";
  const { checking, patternError, reachable, reachError, check } =
    useUrlCheck(productUrl);

  const showPatternError = productUrl && patternError;
  const showReachWarning = !checking && reachable === false && reachError;
  const showReachOk = !checking && reachable === true;

  return (
    <div className="space-y-5">
      <div>
        <Label
          className={
            "text-[14px] font-semibold " +
            (isBrand ? "text-text-dark-primary" : "text-text-dark-strong")
          }
        >
          {t("productUrlLabel")}
        </Label>
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t("productUrlDesc")}
        </p>
      </div>
      <div className="flex items-center gap-0">
        {/* 协议前缀是数据，不是文案：走 mono，和输入框拼成一个整体 */}
        <span
          className={
            "flex h-11 items-center rounded-l-[10px] border border-r-0 px-3.5 font-mono text-[13px] select-none " +
            (isBrand
              ? "border-brand-border-strong bg-brand-panel-raised text-text-dark-secondary"
              : "border-brand-border-strong bg-brand-panel text-text-dark-secondary")
          }
        >
          https://
        </span>
        <Input
          type="text"
          placeholder="example.com"
          value={productUrl.replace(/^https?:\/\//i, "")}
          onChange={(e) => {
            const raw = e.target.value.replace(/^https?:\/\//i, "");
            onProductUrlChange(raw ? `https://${raw}` : "");
          }}
          onBlur={() => {
            if (productUrl && !patternError) {
              check();
            }
          }}
          className={
            "rounded-l-none font-mono " +
            (isBrand
              ? "border-brand-border-strong bg-brand-bg text-text-dark-primary placeholder:text-text-dark-faint"
              : "border-brand-border-strong bg-brand-bg text-text-dark-primary placeholder:text-text-dark-faint")
          }
        />
        {checking && (
          <Loader2
            size={16}
            className="ml-2.5 shrink-0 animate-spin text-text-dark-secondary"
          />
        )}
        {showReachOk && (
          <CheckCircle size={16} className="ml-2.5 shrink-0 text-brand-success" />
        )}
        {showReachWarning && (
          <AlertTriangle
            size={16}
            className="ml-2.5 shrink-0 text-brand-warning"
          />
        )}
      </div>
      {showPatternError && (
        <p className="text-[12.5px] leading-[1.6] text-brand-error">
          {t(patternError)}
        </p>
      )}
      {checking && (
        <p className="font-mono text-[10.5px] tracking-[0.12em] text-text-dark-secondary uppercase">
          {t("urlChecking")}
        </p>
      )}
      {showReachWarning && (
        <p className="text-[12.5px] leading-[1.6] text-brand-warning">
          {t(reachError)}
        </p>
      )}
    </div>
  );
}
