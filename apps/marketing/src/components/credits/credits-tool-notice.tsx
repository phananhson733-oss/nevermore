// @input  -- the Phase 2 price of one tool and the credits.toolNotice copy
// @output -- one line saying the run is free today and what it will cost later
// @pos    -- shared by the connected tool pages so the anchor is set before pricing
"use client";

import { useTranslations } from "next-intl";

/**
 * Says the price before there is one.
 *
 * The tools are free while they are in testing, and the day that stops being
 * true a reader who was never told will read it as a paywall going up
 * overnight. The number comes from CREDIT_TOOL_PRICES through the caller, so
 * the page and the ledger cannot quote different prices for the same run.
 */
export function CreditsToolNotice({
  price,
  className = "mt-5 text-[13px] leading-[1.6] text-text-dark-secondary",
}: {
  readonly price: number;
  /** Overridable so the same sentence can sit in a hero or in a card. */
  readonly className?: string;
}) {
  const t = useTranslations("credits.toolNotice");

  return (
    <p className={className}>
      <span className="text-brand-accent-text">{t("free")}</span>
      {" · "}
      {t("price", { price })}
    </p>
  );
}
