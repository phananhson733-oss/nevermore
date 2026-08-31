"use client";
import { useState, type MouseEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { writeGeoKnowledgeRepair, type GeoBriefReturn, type GeoKnowledgeRepair } from "../../lib/geo-tools/brief-knowledge-handoff.ts";
import { TOOL_HANDOFF_LINK_PROPS } from "../../lib/tools/tool-handoff.ts";
import { localePath } from "../../lib/locale-path.ts";

export function GeoKnowledgeRepairLink({ selection, reason, className, children }: {
  selection: GeoBriefReturn; reason: GeoKnowledgeRepair["reason"]; className?: string; children: ReactNode;
}) {
  const locale = useLocale(); const t = useTranslations("tools.geoBrief"); const [failed, setFailed] = useState(false);
  const stage = (event: MouseEvent<HTMLAnchorElement>) => {
    let ok = false;
    try { ok = writeGeoKnowledgeRepair(window.sessionStorage, { ...selection, reason }); } catch { /* Preserve this page if storage is blocked. */ }
    setFailed(!ok); if (!ok) event.preventDefault();
  };
  return <>
    <a {...TOOL_HANDOFF_LINK_PROPS} className={className} data-geo-knowledge-repair={reason}
      href={`${localePath(locale, "/tools/geo-knowledge-base")}?repair=brief`}
      onClick={stage} onContextMenu={stage} onAuxClick={stage}>{children}</a>
    {failed ? <span role="alert">{t("quality.repairStorageError")}</span> : null}
  </>;
}
