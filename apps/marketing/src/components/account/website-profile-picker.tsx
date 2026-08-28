// @input  -- Agent target URL plus authenticated account website list/details
// @output -- explicit detached import or exact confirmed-snapshot selection
// @pos    -- private website-profile chooser shared across SEO Agent modes
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  normalizeAccountWebsiteUrl,
  parseWebsiteDetails,
  parseWebsiteList,
  type WebsiteDetails,
  type WebsiteSummary,
} from "../../lib/account-websites/contracts.ts";
import { Button } from "../ui/button.tsx";

type PickerPhase = "closed" | "loading" | "hidden" | "unavailable" | "ready";
type DetailPhase = "idle" | "loading" | "unavailable" | "ready";

export function WebsiteProfilePicker({
  targetUrl,
  onImport,
  onReference,
}: {
  readonly targetUrl: string;
  readonly onImport?: (website: WebsiteDetails) => void;
  readonly onReference: (website: WebsiteDetails) => void;
}) {
  const t = useTranslations("agents.workbench.websiteProfile");
  const [phase, setPhase] = useState<PickerPhase>("closed");
  const [activated, setActivated] = useState(false);
  const [websites, setWebsites] = useState<readonly WebsiteSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [suggestedId, setSuggestedId] = useState<string | null>(null);
  const [detailPhase, setDetailPhase] = useState<DetailPhase>("idle");
  const [details, setDetails] = useState<WebsiteDetails | null>(null);
  const detailController = useRef<AbortController | null>(null);

  const loadDetails = useCallback(async (websiteId: string): Promise<void> => {
    detailController.current?.abort();
    if (websiteId === "") {
      detailController.current = null;
      setDetails(null);
      setDetailPhase("idle");
      return;
    }
    const controller = new AbortController();
    detailController.current = controller;
    setDetails(null);
    setDetailPhase("loading");
    try {
      const response = await fetch("/api/account/websites/" + websiteId, {
        signal: controller.signal,
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as unknown;
      if (controller.signal.aborted) return;
      if (response.status !== 200) {
        setDetailPhase("unavailable");
        return;
      }
      const value =
        body !== null && typeof body === "object" && !Array.isArray(body)
          ? (body as { readonly data?: { readonly website?: unknown } }).data
              ?.website
          : null;
      const parsed = await parseWebsiteDetails(value);
      if (parsed.websiteId !== websiteId) {
        throw new Error("website detail identity mismatch");
      }
      setDetails(parsed);
      setDetailPhase("ready");
    } catch {
      if (!controller.signal.aborted) setDetailPhase("unavailable");
    } finally {
      if (detailController.current === controller) {
        detailController.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (!activated) return;
    const controller = new AbortController();
    setPhase("loading");
    setWebsites([]);
    setSelectedId("");
    setSuggestedId(null);
    setDetails(null);
    setDetailPhase("idle");

    void (async () => {
      try {
        const session = await fetch("/api/auth/session", {
          signal: controller.signal,
          cache: "no-store",
        });
        const sessionBody = (await session.json().catch(() => null)) as {
          readonly signedIn?: unknown;
        } | null;
        if (controller.signal.aborted) return;
        if (!session.ok || sessionBody === null) {
          setPhase("unavailable");
          return;
        }
        if (sessionBody.signedIn === false) {
          setPhase("hidden");
          return;
        }
        if (sessionBody.signedIn !== true) {
          setPhase("unavailable");
          return;
        }

        const response = await fetch("/api/account/websites", {
          signal: controller.signal,
          cache: "no-store",
        });
        const body = (await response.json().catch(() => null)) as unknown;
        if (controller.signal.aborted) return;
        if (response.status !== 200) {
          setPhase("unavailable");
          return;
        }
        const value =
          body !== null && typeof body === "object" && !Array.isArray(body)
            ? (body as { readonly data?: { readonly websites?: unknown } }).data
                ?.websites
            : null;
        const parsed = parseWebsiteList(value);
        const normalized = normalizeAccountWebsiteUrl(targetUrl);
        const exact =
          normalized === null
            ? undefined
            : parsed.find(
                (website) =>
                  website.canonicalSiteKey === normalized.canonicalSiteKey,
              );
        setWebsites(parsed);
        setPhase("ready");
        if (exact !== undefined) {
          setSelectedId(exact.websiteId);
          setSuggestedId(exact.websiteId);
          void loadDetails(exact.websiteId);
        }
      } catch {
        if (!controller.signal.aborted) setPhase("unavailable");
      }
    })();

    return () => {
      controller.abort();
      detailController.current?.abort();
      detailController.current = null;
    };
  }, [activated, loadDetails, targetUrl]);

  if (phase === "hidden") return null;
  if (phase === "closed") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setPhase("loading");
          setActivated(true);
        }}
      >
        {t("open")}
      </Button>
    );
  }
  if (phase === "loading") {
    return (
      <p aria-live="polite" className="text-[12px] text-text-dark-secondary">
        {t("loading")}
      </p>
    );
  }
  if (phase === "unavailable") {
    return (
      <p aria-live="polite" className="text-[12px] text-text-dark-secondary">
        {t("unavailable")}
      </p>
    );
  }

  const canImport =
    onImport !== undefined &&
    details?.currentConfirmedSnapshot !== null &&
    details !== null;
  const canReference = details?.currentConfirmedSnapshot !== null && details !== null;

  return (
    <section
      data-website-profile-picker
      className="rounded-row border border-brand-border bg-brand-panel-sunken p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label
            htmlFor="agent-website-profile"
            className="text-[11px] font-medium text-text-dark-secondary"
          >
            {t("title")}
          </label>
          <select
            id="agent-website-profile"
            name="websiteProfile"
            autoComplete="off"
            value={selectedId}
            onChange={(event) => {
              const websiteId = event.target.value;
              setSelectedId(websiteId);
              void loadDetails(websiteId);
            }}
            className="mt-1 h-10 w-full rounded-[8px] border border-brand-border-card bg-brand-panel px-3 text-[12px] text-text-dark-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            <option value="">{t("placeholder")}</option>
            {websites.map((website) => (
              <option key={website.websiteId} value={website.websiteId}>
                {(website.displayName ?? website.host) +
                  (website.isPrimary ? " · " + t("primary") : "")}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {onImport !== undefined ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canImport}
              onClick={() => {
                if (details !== null) onImport(details);
              }}
            >
              {t("import")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canReference}
            onClick={() => {
              if (details !== null) onReference(details);
            }}
          >
            {t("reference")}
          </Button>
        </div>
      </div>

      {selectedId !== "" && selectedId === suggestedId ? (
        <p className="mt-2 text-[10.5px] text-brand-accent-text">
          {t("suggested")}
        </p>
      ) : null}
      {detailPhase === "loading" ? (
        <p aria-live="polite" className="mt-2 text-[11px] text-text-dark-faint">
          {t("loading")}
        </p>
      ) : detailPhase === "unavailable" ? (
        <p aria-live="polite" className="mt-2 text-[11px] text-brand-error">
          {t("unavailable")}
        </p>
      ) : details !== null &&
        details.currentConfirmedSnapshot === null &&
        details.draft !== null ? (
        <p className="mt-2 text-[11px] text-text-dark-secondary">
          {t("draftOnly")}
        </p>
      ) : details !== null &&
        details.currentConfirmedSnapshot === null &&
        details.draft === null ? (
        <p className="mt-2 text-[11px] text-text-dark-secondary">
          {t("noProfile")}
        </p>
      ) : null}
    </section>
  );
}
