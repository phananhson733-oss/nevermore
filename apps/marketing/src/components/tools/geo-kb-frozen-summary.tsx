"use client";
// @input  -- one exact frozen V2 version
// @output -- the one line that says what this saved knowledge base holds
// @pos    -- counts come from the frozen record itself, never from the live draft
import { useTranslations } from "next-intl";
import type { GeoKbFrozenV2Wire } from "./geo-kb-v2-wire.ts";

export function GeoKbFrozenSummary({ frozen }: { readonly frozen: GeoKbFrozenV2Wire }) {
  const t = useTranslations("tools.geoKnowledgeBase");
  return <p data-frozen-summary className="text-sm text-text-dark-primary">
    {t("asset.frozenSummary", {
      revision: frozen.revision,
      questions: frozen.questionCount,
      roles: frozen.payload.roles.length,
      // Only a confirmed mapping takes part in share-of-voice, so both numbers
      // are shown rather than a single count that would overstate coverage.
      confirmed: frozen.payload.competitors.filter((competitor) => competitor.confirmed).length,
      competitors: frozen.payload.competitors.length,
      facts: frozen.payload.facts.length,
    })}
    {" · "}
    <time dateTime={frozen.frozenAt}>{frozen.frozenAt}</time>
  </p>;
}
