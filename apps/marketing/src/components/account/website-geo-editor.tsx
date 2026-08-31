"use client";

// @input  -- route-owned website identity resolved privately by the account API
// @output -- one canonical website GEO entry using the shared KB editor
// @pos    -- no URL picker or independent editable copy of Product Profile

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { normalizeAccountWebsiteUrl } from "../../lib/account-websites/contracts.ts";
import { GeoKnowledgeBase } from "../tools/geo-knowledge-base.tsx";
import { isGeoKbView, type GeoKbView } from "../tools/geo-kb-wire.ts";

interface WebsiteGeoData {
  readonly website: { readonly websiteId: string; readonly origin: string; readonly host: string; readonly profileState: string };
  readonly knowledgeBase: GeoKbView;
}
type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly code: "auth_required" | "website_not_found" | "bad_response" | "store_unavailable" | "network" }
  | { readonly kind: "ready"; readonly data: WebsiteGeoData };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readData(value: unknown, websiteId: string): WebsiteGeoData | null {
  if (!isRecord(value) || !isRecord(value["data"])) return null;
  const { website, knowledgeBase } = value["data"];
  if (!isRecord(website) || website["websiteId"] !== websiteId ||
      typeof website["origin"] !== "string" || typeof website["host"] !== "string" ||
      typeof website["profileState"] !== "string" ||
      !["not_generated", "draft", "confirmed", "unconfirmed_changes"].includes(website["profileState"]) ||
      !isGeoKbView(knowledgeBase)) return null;
  const site = normalizeAccountWebsiteUrl(website["origin"]);
  const kbSite = normalizeAccountWebsiteUrl(knowledgeBase.origin);
  if (site === null || kbSite === null || site.canonicalSiteKey !== kbSite.canonicalSiteKey ||
      (knowledgeBase.profile != null && knowledgeBase.profile.reference.websiteId !== websiteId)) return null;
  return { website: { websiteId, origin: website["origin"], host: website["host"], profileState: website["profileState"] }, knowledgeBase };
}

function WebsiteGeoLoader({ websiteId }: { readonly websiteId: string }) {
  const locale = useLocale();
  const t = useTranslations("tools.geoKnowledgeBase");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/account/websites/${encodeURIComponent(websiteId)}/geo`, {
          method: "POST", headers: { "content-type": "application/json" }, body: "{}",
          cache: "no-store", signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setState({ kind: "error", code: response.status === 401 ? "auth_required" : response.status === 404 ? "website_not_found" : "store_unavailable" });
          return;
        }
        const data = readData(body, websiteId);
        setState(data === null ? { kind: "error", code: "bad_response" } : { kind: "ready", data });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "error", code: "network" });
      }
    };
    void load();
    return () => controller.abort();
  }, [websiteId, attempt]);

  if (state.kind === "loading") return <p role="status">{t("asset.loading")}</p>;
  if (state.kind === "error") return (
    <section className="grid gap-3 rounded-xl border border-brand-border-card bg-brand-panel p-6">
      <p role="alert">{state.code === "website_not_found" ? t("asset.websiteNotFound") : t(`errors.${state.code}`)}</p>
      <button type="button" onClick={() => { setState({ kind: "loading" }); setAttempt((current) => current + 1); }}>{t("asset.retry")}</button>
    </section>
  );
  return (
    <div>
      <nav className="flex gap-4 text-sm text-brand-accent-text" aria-label={t("asset.title")}>
        <a href={`/${locale}/account/websites`}>{t("asset.backToWebsites")}</a>
        <a href={`/${locale}/account/websites/${websiteId}`}>{t("asset.editProfile")}</a>
      </nav>
      <h1 className="mt-4 text-2xl text-text-dark-primary">{t("asset.title")}</h1>
      <GeoKnowledgeBase key={state.data.knowledgeBase.kbId} locale={locale} signedIn
        initialUrl={state.data.website.origin} initialView={state.data.knowledgeBase}
        canonicalWebsiteId={websiteId} profileState={state.data.website.profileState} />
    </div>
  );
}

export function WebsiteGeoEditor({ websiteId }: { readonly websiteId: string }) {
  // New identity remounts once; ordinary rerenders never refetch over a draft.
  return <WebsiteGeoLoader key={websiteId} websiteId={websiteId} />;
}
