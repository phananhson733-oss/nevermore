"use client";
// @input  -- one exact frozen V2 version
// @output -- the one line that says what this saved knowledge base holds
// @pos    -- counts come from the frozen record itself, never from the live draft
import { useTranslations } from "next-intl";
import type { GeoKbFrozenV2Wire } from "./geo-kb-v2-wire.ts";

export function GeoKbFrozenSummary({ frozen }: { readonly frozen: GeoKbFrozenV2Wire }) {
  const t = useTranslations("tools.geoKnowledgeBase");
  return <div data-frozen-summary className="text-sm text-text-dark-primary">
    <p>{t("asset.frozenSummary", {
      revision: frozen.revision,
      questions: frozen.questionCount,
      // The frozen payload keeps excluded rows for the record; only accepted
      // ones take part in measurement, so both numbers are shown for each.
      acceptedRoles: frozen.payload.roles.filter((role) => role.review === "accepted").length,
      roles: frozen.payload.roles.length,
      acceptedFacts: frozen.payload.facts.filter((fact) => fact.review === "accepted").length,
      // Both numbers, because a single count would read as coverage. Confirming
      // a mapping is necessary for it to take part in share of voice, not
      // sufficient: a measurement run also drops one that resolves to this
      // site's own identity.
      confirmed: frozen.payload.competitors.filter((competitor) => competitor.confirmed).length,
      competitors: frozen.payload.competitors.length,
      facts: frozen.payload.facts.length,
    })}
    {" · "}
    <time dateTime={frozen.frozenAt}>{frozen.frozenAt}</time></p>
    <details className="mt-2 text-xs font-normal text-text-dark-secondary">
      <summary className="cursor-pointer">{t("asset.frozenIdentity")}</summary>
      <span className="mt-2 block break-all font-mono">{frozen.snapshotId}</span>
    </details>
  </div>;
}
