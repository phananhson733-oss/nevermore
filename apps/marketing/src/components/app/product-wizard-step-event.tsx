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
    <div className="space-y-5">
      <div>
        <Label
          className={
            "text-[14px] font-semibold " +
            (isBrand ? "text-text-dark-primary" : "text-text-dark-strong")
          }
        >
          {t("conversionEvent")}
        </Label>
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t("conversionEventDesc")}
        </p>
      </div>
      <div className="space-y-2.5">
        {CONVERSION_EVENTS.map((evt) => (
          <label
            key={evt.value}
            className={
              "flex cursor-pointer items-center gap-3 rounded-[10px] border p-3.5 text-[13px] transition-colors " +
              (conversionEvent === evt.value
                ? isBrand
                  ? "border-brand-accent/50 bg-brand-accent/[0.08] text-text-dark-primary"
                  : "border-brand-border-strong bg-brand-panel-raised text-text-dark-primary"
                : isBrand
                  ? "border-brand-border-strong text-text-dark-secondary hover:border-brand-accent/40"
                  : "border-brand-border text-text-dark-secondary hover:border-brand-border-strong")
            }
          >
            <input
              type="radio"
              name="conversion_event"
              checked={conversionEvent === evt.value}
              onChange={() => onConversionEventChange(evt.value)}
              className={
                isBrand ? "accent-brand-accent" : "accent-brand-accent-2"
              }
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
              "flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.12em] uppercase transition-colors " +
              (isBrand
                ? "text-text-dark-secondary hover:text-brand-accent-text"
                : "text-text-dark-secondary hover:text-text-dark-primary")
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
                "space-y-5 rounded-[12px] border p-4 " +
                (isBrand
                  ? "border-brand-border bg-brand-panel-sunken"
                  : "border-brand-border bg-brand-panel-sunken")
              }
            >
              {/* Language override */}
              <div>
                <Label className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
                  {t("languageOverride")}
                </Label>
                <Input
                  type="text"
                  placeholder={t("langPlaceholder")}
                  value={languageOverride ?? ""}
                  onChange={(e) => onLanguageOverrideChange?.(e.target.value)}
                  className="mt-2"
                />
              </div>

              {/* Production cap with description and recommendation */}
              <div>
                <Label className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
                  {t("productionCap")}
                </Label>
                <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                  {t("capDesc")}
                </p>
                <Input
                  type="number"
                  placeholder={t("capPlaceholder")}
                  value={productionCapOverride ?? ""}
                  onChange={(e) =>
                    onProductionCapOverrideChange?.(e.target.value)
                  }
                  className="mt-2 font-mono"
                />
                <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                  {t("capRecommendation")}
                </p>
              </div>

              {/* Brand safety / content compliance with presets */}
              <div>
                <Label className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
                  {t("brandSafetyPolicy")}
                </Label>
                <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                  {t("brandSafetyDesc")}
                </p>

                {/* Preset toggles */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {BRAND_SAFETY_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => togglePreset(preset)}
                      className={
                        "rounded-full border px-3 py-1.5 text-[12.5px] transition-colors " +
                        (isPresetActive(preset)
                          ? isBrand
                            ? "border-brand-accent/50 bg-brand-accent/12 text-brand-accent-text"
                            : "border-brand-border-strong bg-brand-panel-raised text-text-dark-primary"
                          : isBrand
                            ? "border-brand-border-strong text-text-dark-secondary hover:border-brand-accent/40"
                            : "border-brand-border text-text-dark-secondary hover:border-brand-border-strong")
                      }
                    >
                      {t(preset as Parameters<typeof t>[0])}
                    </button>
                  ))}
                </div>

                {/* Custom rules textarea */}
                <Label className="mt-4 block font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
                  {t("brandSafetyCustomLabel")}
                </Label>
                <textarea
                  placeholder={t("brandSafetyPlaceholder")}
                  value={brandSafetyPolicy ?? ""}
                  onChange={(e) => onBrandSafetyPolicyChange?.(e.target.value)}
                  rows={3}
                  className="mt-2 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 py-3 text-[13px] leading-[1.6] text-text-dark-primary transition-colors outline-none placeholder:text-text-dark-faint focus-visible:border-brand-accent/70 focus-visible:ring-2 focus-visible:ring-brand-accent/25"
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
