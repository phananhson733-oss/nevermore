// @input  -- product-wizard-types (StepEventProps), product-wizard-constants (CONVERSION_EVENTS), next-intl, ui/input, ui/label, lucide-react
// @output -- WizardStepEvent component (step 4: conversion event + optional advanced settings)
// @pos    -- Products module, step 4 of ProductWizard (SPEC 3.3)
// Once this file is updated, update the header comment and the folder _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronUp } from "lucide-react";
import { CONVERSION_EVENTS } from "@/components/app/product-wizard-constants";
import type { StepEventProps } from "@/components/app/product-wizard-types";

const BRAND_SAFETY_PRESETS = [
  "brandSafetyPresetNoCompetitor",
  "brandSafetyPresetNoExaggeration",
  "brandSafetyPresetNoSensitive",
  "brandSafetyPresetCiteSources",
  "brandSafetyPresetNoAdvice",
] as const;

export function WizardStepEvent({
  conversionEvent,
  onConversionEventChange,
  showAdvanced,
  onToggleAdvanced,
  languageOverride,
  onLanguageOverrideChange,
  productionCapOverride,
  onProductionCapOverrideChange,
  brandSafetyPolicy,
  onBrandSafetyPolicyChange,
  variant = "app",
}: StepEventProps & { readonly variant?: "app" | "brand" }) {
  const t = useTranslations("app.products");
  const isBrand = variant === "brand";
  const hasAdvanced = onToggleAdvanced !== undefined;

  const eventLabels: Record<string, string> = {
    signup: t("signup"),
    purchase: t("purchase"),
    trial_start: t("trialStart"),
    contact_form: t("contactForm"),
    newsletter_subscribe: t("newsletterSubscribe"),
  };

  function togglePreset(preset: string) {
    if (!onBrandSafetyPolicyChange || brandSafetyPolicy === undefined) return;
    const current = brandSafetyPolicy;
    const lines = current
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const presetText = t(preset as Parameters<typeof t>[0]);

    if (lines.includes(presetText)) {
      const updated = lines.filter((l) => l !== presetText).join("\n");
      onBrandSafetyPolicyChange(updated);
    } else {
      const updated = [...lines, presetText].join("\n");
      onBrandSafetyPolicyChange(updated);
    }
  }

  function isPresetActive(preset: string): boolean {
    if (brandSafetyPolicy === undefined) return false;
    const presetText = t(preset as Parameters<typeof t>[0]);
    return brandSafetyPolicy
      .split("\n")
      .map((l) => l.trim())
      .includes(presetText);
  }

  return (
    <div className="space-y-4">
      <div>
        <Label className={isBrand ? "text-text-dark-primary" : "text-zinc-900"}>
          {t("conversionEvent")}
        </Label>
        <p
          className={`mt-0.5 text-xs ${isBrand ? "text-text-dark-secondary" : "text-zinc-500"}`}
        >
          {t("conversionEventDesc")}
        </p>
      </div>
      <div className="space-y-2">
        {CONVERSION_EVENTS.map((evt) => (
          <label
            key={evt.value}
            className={
              "flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm transition-colors " +
              (conversionEvent === evt.value
                ? isBrand
                  ? "border-brand-accent bg-brand-accent/10 text-text-dark-primary"
                  : "border-zinc-400 bg-zinc-100 text-zinc-900"
                : isBrand
                  ? "border-brand-border text-text-dark-secondary hover:border-brand-accent/40"
                  : "border-zinc-200 text-zinc-500 hover:border-zinc-300")
            }
          >
            <input
              type="radio"
              name="conversion_event"
              checked={conversionEvent === evt.value}
              onChange={() => onConversionEventChange(evt.value)}
              className={isBrand ? "accent-amber-600" : "accent-zinc-900"}
            />
            {eventLabels[evt.value]}
          </label>
        ))}
      </div>

      {/* Advanced settings - only shown when props are provided */}
      {hasAdvanced && (
        <>
          <button
            type="button"
            onClick={onToggleAdvanced}
            className={
              "flex items-center gap-1 text-xs transition-colors " +
              (isBrand
                ? "text-text-dark-secondary hover:text-text-dark-primary"
                : "text-zinc-500 hover:text-zinc-900")
            }
          >
            {showAdvanced ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
            {t("advancedSettings")}
          </button>

          {showAdvanced && (
            <div
              className={
                "space-y-4 rounded-md border p-3 " +
                (isBrand
                  ? "border-brand-border bg-brand-bg"
                  : "border-zinc-200 bg-zinc-50")
              }
            >
              {/* Language override */}
              <div>
                <Label
                  className={`text-xs ${isBrand ? "text-text-dark-secondary" : "text-zinc-500"}`}
                >
                  {t("languageOverride")}
                </Label>
                <Input
                  type="text"
                  placeholder={t("langPlaceholder")}
                  value={languageOverride ?? ""}
                  onChange={(e) => onLanguageOverrideChange?.(e.target.value)}
                  className={
                    "mt-1 " +
                    (isBrand
                      ? "border-brand-border bg-brand-bg-alt text-text-dark-primary placeholder:text-text-dark-secondary/50"
                      : "border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400")
                  }
                />
              </div>

              {/* Production cap with description and recommendation */}
              <div>
                <Label
                  className={`text-xs ${isBrand ? "text-text-dark-secondary" : "text-zinc-500"}`}
                >
                  {t("productionCap")}
                </Label>
                <p
                  className={`mt-0.5 text-[11px] ${isBrand ? "text-text-dark-secondary/70" : "text-zinc-400"}`}
                >
                  {t("capDesc")}
                </p>
                <Input
                  type="number"
                  placeholder={t("capPlaceholder")}
                  value={productionCapOverride ?? ""}
                  onChange={(e) =>
                    onProductionCapOverrideChange?.(e.target.value)
                  }
                  className={
                    "mt-1 " +
                    (isBrand
                      ? "border-brand-border bg-brand-bg-alt text-text-dark-primary placeholder:text-text-dark-secondary/50"
                      : "border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400")
                  }
                />
                <p
                  className={`mt-1 text-[10px] ${isBrand ? "text-text-dark-secondary/50" : "text-zinc-300"}`}
                >
                  {t("capRecommendation")}
                </p>
              </div>

              {/* Brand safety / content compliance with presets */}
              <div>
                <Label
                  className={`text-xs ${isBrand ? "text-text-dark-secondary" : "text-zinc-500"}`}
                >
                  {t("brandSafetyPolicy")}
                </Label>
                <p
                  className={`mt-0.5 text-[11px] ${isBrand ? "text-text-dark-secondary/70" : "text-zinc-400"}`}
                >
                  {t("brandSafetyDesc")}
                </p>

                {/* Preset toggles */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {BRAND_SAFETY_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => togglePreset(preset)}
                      className={
                        "rounded-full border px-2.5 py-1 text-[11px] transition-colors " +
                        (isPresetActive(preset)
                          ? isBrand
                            ? "border-brand-accent bg-brand-accent/15 text-text-dark-primary"
                            : "border-zinc-400 bg-zinc-100 text-zinc-900"
                          : isBrand
                            ? "border-brand-border text-text-dark-secondary hover:border-brand-accent/40"
                            : "border-zinc-200 text-zinc-500 hover:border-zinc-300")
                      }
                    >
                      {t(preset as Parameters<typeof t>[0])}
                    </button>
                  ))}
                </div>

                {/* Custom rules textarea */}
                <Label
                  className={`mt-3 block text-[11px] ${isBrand ? "text-text-dark-secondary/70" : "text-zinc-400"}`}
                >
                  {t("brandSafetyCustomLabel")}
                </Label>
                <textarea
                  placeholder={t("brandSafetyPlaceholder")}
                  value={brandSafetyPolicy ?? ""}
                  onChange={(e) => onBrandSafetyPolicyChange?.(e.target.value)}
                  rows={3}
                  className={
                    "mt-1 w-full rounded-md border px-3 py-2 text-sm " +
                    (isBrand
                      ? "border-brand-border bg-brand-bg-alt text-text-dark-primary placeholder:text-text-dark-secondary/50"
                      : "border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400")
                  }
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
