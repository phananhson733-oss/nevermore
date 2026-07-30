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
    <div className="space-y-4">
      <div>
        <Label
          className={isBrand ? "text-text-dark-primary" : "text-zinc-900"}
        >
          {t("productUrlLabel")}
        </Label>
        <p
          className={`mt-0.5 text-xs ${isBrand ? "text-text-dark-secondary" : "text-zinc-500"}`}
        >
          {t("productUrlDesc")}
        </p>
      </div>
      <div className="flex items-center gap-0">
        <span
          className={
            "flex h-9 items-center rounded-l-md border border-r-0 px-3 text-sm select-none " +
            (isBrand
              ? "border-brand-border bg-brand-bg text-text-dark-secondary"
              : "border-zinc-200 bg-zinc-100 text-zinc-500")
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
            "rounded-l-none " +
            (isBrand
              ? "border-brand-border bg-brand-bg text-text-dark-primary placeholder:text-text-dark-secondary/50"
              : "border-zinc-200 bg-zinc-50 text-zinc-900 placeholder:text-zinc-500/50")
          }
        />
        {checking && (
          <Loader2
            size={16}
            className={`ml-2 shrink-0 animate-spin ${isBrand ? "text-text-dark-secondary" : "text-zinc-400"}`}
          />
        )}
        {showReachOk && (
          <CheckCircle size={16} className="ml-2 shrink-0 text-green-500" />
        )}
        {showReachWarning && (
          <AlertTriangle
            size={16}
            className="ml-2 shrink-0 text-amber-500"
          />
        )}
      </div>
      {showPatternError && (
        <p className="text-xs text-red-400">{t(patternError)}</p>
      )}
      {checking && (
        <p
          className={`text-xs ${isBrand ? "text-text-dark-secondary" : "text-zinc-400"}`}
        >
          {t("urlChecking")}
        </p>
      )}
      {showReachWarning && (
        <p className="text-xs text-amber-500">{t(reachError)}</p>
      )}
    </div>
  );
}
