// @input  -- next-intl, framer-motion
// @output -- PricingCards component (3 tier cards with features)
// @pos    -- pricing page sub-component, rendered by pricing-page-client
// Once this file is updated, update the header comment and the folder's _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

const TIERS = ["starter", "pro", "growth"] as const;

export function PricingCards({
  onCtaClick,
}: {
  onCtaClick?: () => void;
}) {
  return (
    <motion.div
      {...staggerContainer}
      initial="initial"
      whileInView="animate"
      viewport={{ once: true }}
      className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8"
    >
      {TIERS.map((tier) => (
        <TierCard key={tier} tier={tier} onCtaClick={onCtaClick} />
      ))}
    </motion.div>
  );
}

function TierCard({
  tier,
  onCtaClick,
}: {
  tier: (typeof TIERS)[number];
  onCtaClick?: () => void;
}) {
  const t = useTranslations(`pricing.${tier}`);
  const isPro = tier === "pro";
  const features: string[] = t.raw("features");

  return (
    <motion.div
      {...staggerItem}
      className={`relative flex flex-col rounded-card border p-6 lg:p-8 ${
        isPro
          ? "border-brand-accent bg-brand-bg-alt"
          : "border-white/10 bg-brand-bg-alt"
      }`}
    >
      {isPro && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-accent px-4 py-1 text-xs font-semibold text-white">
          {t("badge")}
        </span>
      )}

      <h3 className="text-text-dark-primary text-xl font-semibold">
        {t("name")}
      </h3>
      <p className="text-text-dark-secondary text-sm mt-1 mb-6">
        {t("description")}
      </p>

      <div className="mb-6">
        <span className="text-text-dark-primary text-4xl font-bold">
          {t("price")}
        </span>
        <span className="text-text-dark-secondary text-sm">
          {t("period")}
        </span>
      </div>

      <ul className="flex-1 space-y-3 mb-8">
        {features.map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-2 text-text-dark-secondary text-sm"
          >
            <Check
              className="size-4 shrink-0 mt-0.5 text-brand-accent"
              aria-hidden="true"
            />
            {feature}
          </li>
        ))}
      </ul>

      <Button
        onClick={onCtaClick}
        size="lg"
        className={`w-full ${
          isPro
            ? "bg-brand-accent hover:bg-brand-accent-hover text-white"
            : "bg-white/10 hover:bg-white/15 text-text-dark-primary"
        }`}
      >
        {t("cta")}
      </Button>
    </motion.div>
  );
}
