"use client";

// @input  -- route-owned website identity resolved privately by the account API
// @output -- one canonical website GEO entry, drawn in whichever format the route stored
// @pos    -- no URL picker or independent editable copy of Product Profile

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { normalizeAccountWebsiteUrl } from "../../lib/account-websites/contracts.ts";
import { GeoKnowledgeBase } from "../tools/geo-knowledge-base.tsx";
import { isGeoKbView, type GeoKbView } from "../tools/geo-kb-wire.ts";
import { parseGeoKbEditorViewV2, type GeoKbEditorViewV2 } from "../tools/geo-kb-v2-wire.ts";
import { GeoKnowledgeBaseV2 } from "../tools/geo-knowledge-base-v2.tsx";
import { GEO_KB_EDITOR_V3_SCHEMA_VERSION, parseGeoKbEditorViewV3, type GeoKbEditorViewV3Wire } from "../tools/use-geo-kb-v3-editor.ts";

/**
 * The three shapes this route can answer with, and the one thing they share.
 *
 * A knowledge base is a v1 view, a v2 editor view or a v3 review view, and the
 * server decides which by what is actually stored -- this page never asks for a
 * format. `schemaVersion` is the discriminator: absent on v1, and a different
 * literal for each of the other two.
 */
type LoadedKnowledgeBase = GeoKbView | GeoKbEditorViewV2 | GeoKbEditorViewV3Wire;
function isV3(knowledgeBase: LoadedKnowledgeBase): knowledgeBase is GeoKbEditorViewV3Wire {
  return "schemaVersion" in knowledgeBase && knowledgeBase.schemaVersion === GEO_KB_EDITOR_V3_SCHEMA_VERSION;
}

interface WebsiteGeoData {
  readonly website: { readonly websiteId: string; readonly origin: string; readonly host: string; readonly profileState: string };
  readonly knowledgeBase: LoadedKnowledgeBase;
}
type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly code: "auth_required" | "website_not_found" | "profile_copy_required" | "bad_response" | "store_unavailable" | "network" }
  | { readonly kind: "ready"; readonly data: WebsiteGeoData };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readData(value: unknown, websiteId: string): WebsiteGeoData | null {
  if (!isRecord(value) || !isRecord(value["data"])) return null;
  const { website, knowledgeBase: rawKnowledgeBase } = value["data"];
  const knowledgeBase: LoadedKnowledgeBase | null = isRecord(rawKnowledgeBase) && rawKnowledgeBase.schemaVersion === GEO_KB_EDITOR_V3_SCHEMA_VERSION
    ? parseGeoKbEditorViewV3(rawKnowledgeBase)
    : isRecord(rawKnowledgeBase) && rawKnowledgeBase.schemaVersion === "marketing-geo-kb-editor.v2"
      ? parseGeoKbEditorViewV2(rawKnowledgeBase) : isGeoKbView(rawKnowledgeBase) ? rawKnowledgeBase : null;
  if (!isRecord(website) || website["websiteId"] !== websiteId ||
      typeof website["origin"] !== "string" || typeof website["host"] !== "string" ||
      typeof website["profileState"] !== "string" ||
      !["not_generated", "draft", "confirmed", "unconfirmed_changes"].includes(website["profileState"]) ||
      knowledgeBase === null) return null;
  const site = normalizeAccountWebsiteUrl(website["origin"]);
  const kbSite = normalizeAccountWebsiteUrl(knowledgeBase.origin);
  if (site === null || kbSite === null || site.canonicalSiteKey !== kbSite.canonicalSiteKey) return null;
  // The knowledge base has to be about the website this route resolved, and the
  // three formats say so in three places. A v3 draft carries no Profile copy at
  // all: the confirmed revision it was locked to is named by `profileRef`, so
  // that is the field the same check reads. Dropping the check for v3 would
  // make it the one format that renders another website's product facts.
  if (isV3(knowledgeBase)
    ? knowledgeBase.payload.generationInput.profileRef.websiteId !== websiteId
    : (knowledgeBase.profile != null && knowledgeBase.profile.reference.websiteId !== websiteId) ||
      (knowledgeBase.payload.profileCopy !== undefined && knowledgeBase.payload.profileCopy.websiteId !== websiteId)) return null;
  return { website: { websiteId, origin: website["origin"], host: website["host"], profileState: website["profileState"] }, knowledgeBase };
}

interface WebsiteGeoEditorProps {
  readonly websiteId: string;
  readonly inline?: boolean;
  readonly confirmedRevision?: number;
}
function WebsiteGeoLoader({ websiteId, inline = false, confirmedRevision }: WebsiteGeoEditorProps) {
  const locale = useLocale();
  const t = useTranslations("tools.geoKnowledgeBase");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reload = () => { setState({ kind: "loading" }); setAttempt((current) => current + 1); };
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
          // Every status that is not one of these renders as "the store did
          // not respond", which is a claim about the store. Read the code the
          // route sent rather than inventing one from the status alone.
          const code: unknown = isRecord(body) && isRecord(body["error"]) ? body["error"]["code"] : null;
          setState({ kind: "error", code: response.status === 401 ? "auth_required"
            : response.status === 404 ? "website_not_found"
            : code === "profile_copy_required" ? "profile_copy_required"
            : "store_unavailable" });
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
      <p role="alert">{state.code === "website_not_found" ? t("asset.websiteNotFound") : state.code === "profile_copy_required" ? t("asset.profileRequired") : t(`errors.${state.code}`)}</p>
      {/* Retrying a website whose Profile was never confirmed cannot succeed;
          the message names the step that has to happen first instead. */}
      {state.code === "profile_copy_required" ? null : <button type="button" onClick={reload}>{t("asset.retry")}</button>}
    </section>
  );
  return (
    <div>
      {inline ? null : <nav className="flex gap-4 text-sm text-brand-accent-text" aria-label={t("asset.title")}>
        <a href={`/${locale}/account/websites`}>{t("asset.backToWebsites")}</a>
        <a href={`/${locale}/account/websites/${websiteId}`}>{t("asset.editProfile")}</a>
      </nav>}
      {inline ? null : <h1 className="mt-4 text-2xl text-text-dark-primary">{t("asset.title")}</h1>}
      {/* One knowledge base, in whichever format it is stored in. A v3 draft
          gets the review card; there is no v2 view to draw beside it, and a v2
          draft is never quietly redrawn as v3.

          `onStarted` is how the one knowledge base that has nothing stored yet
          becomes a v3 one: the card creates the first v3 draft and asks for a
          re-read, and the read that follows is the one that answers with the
          review view. It is the same re-read the error state's retry does, so a
          started knowledge base and a recovered outage take one path. */}
      {isV3(state.data.knowledgeBase) ? <GeoKnowledgeBaseV2 key={state.data.knowledgeBase.kbId}
        v3Draft={state.data.knowledgeBase} locale={locale} inline={inline} />
        : "schemaVersion" in state.data.knowledgeBase ? <GeoKnowledgeBaseV2 key={state.data.knowledgeBase.kbId}
        initialView={state.data.knowledgeBase} locale={locale} canonicalWebsiteId={websiteId} inline={inline}
        onStarted={reload}
        {...(confirmedRevision === undefined ? {} : { confirmedProfileRevision: confirmedRevision })} /> : <GeoKnowledgeBase key={state.data.knowledgeBase.kbId} locale={locale} signedIn
        initialUrl={state.data.website.origin} initialView={state.data.knowledgeBase}
        canonicalWebsiteId={websiteId} profileState={state.data.website.profileState} inline={inline}
        {...(confirmedRevision === undefined ? {} : { confirmedProfileRevision: confirmedRevision })} />}
    </div>
  );
}

export function WebsiteGeoEditor(props: WebsiteGeoEditorProps) {
  // New identity remounts once; ordinary rerenders never refetch over a draft.
  return <WebsiteGeoLoader key={props.websiteId} {...props} />;
}
