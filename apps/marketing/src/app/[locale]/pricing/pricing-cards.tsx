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
      className="grid grid-cols-1 gap-4 md:grid-cols-3"
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
      className={`relative flex flex-col rounded-card border p-[26px] ${
        isPro
          ? "border-brand-accent/50 bg-brand-accent/[0.08] shadow-[inset_2px_0_0_#3DDC97]"
          : "border-brand-border-card bg-brand-panel"
      }`}
    >
      {isPro && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded bg-brand-accent px-2.5 py-[3px] font-mono text-[9.5px] tracking-[0.08em] text-brand-on-accent uppercase">
          {t("badge")}
        </span>
      )}

      <h3 className="text-[16.5px] font-semibold text-text-dark-primary">
        {t("name")}
      </h3>
      <p className="mt-2 mb-6 text-[13px] leading-[1.6] text-text-dark-secondary">
        {t("description")}
      </p>

      <div className="mb-6 flex items-baseline gap-1.5">
        <span className="font-mono text-[28px] tracking-[-0.02em] text-text-dark-primary">
          {t("price")}
        </span>
        <span className="font-mono text-[11px] tracking-[0.06em] text-text-dark-secondary">
          {t("period")}
        </span>
      </div>

      <ul className="mb-7 flex-1 space-y-2.5">
        {features.map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-2.5 text-[13px] leading-[1.6] text-text-dark-strong"
          >
            <Check
              className="mt-[3px] size-[15px] shrink-0 text-brand-accent"
              aria-hidden="true"
            />
            {feature}
          </li>
        ))}
      </ul>

      <Button
        onClick={onCtaClick}
        size="lg"
        className={`h-11.5 w-full rounded-[10px] text-[14px] font-semibold ${
          isPro
            ? "bg-brand-gradient text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta"
            : "border border-brand-border-strong bg-brand-panel-raised text-text-dark-primary transition-colors hover:border-brand-accent/50 hover:bg-brand-panel-raised"
        }`}
      >
        {t("cta")}
      </Button>
    </motion.div>
  );
}
