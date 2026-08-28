"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  parseWebsiteDetails,
  parseWebsiteList,
  parseWebsiteSummary,
  type WebsiteSummary,
} from "../../lib/account-websites/contracts.ts";
import { localePath } from "../../lib/locale-path.ts";
import { Button } from "../ui/button.tsx";
import { Card, CardContent } from "../ui/card.tsx";
import { AddWebsiteDialog } from "./add-website-dialog.tsx";

type Phase = "loading" | "signed-out" | "unavailable" | "ready";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function readWebsites(body: unknown): readonly WebsiteSummary[] | null {
  const websites = record(record(body)?.data)?.websites;
  try {
    return parseWebsiteList(websites);
  } catch {
    return null;
  }
}

async function readUpdatedWebsite(body: unknown): Promise<WebsiteSummary | null> {
  const website = record(record(body)?.data)?.website;
  try {
    const details = await parseWebsiteDetails(website);
    return parseWebsiteSummary({
      websiteId: details.websiteId,
      origin: details.origin,
      host: details.host,
      canonicalSiteKey: details.canonicalSiteKey,
      displayName: details.displayName,
      isPrimary: details.isPrimary,
      profileState: details.profileState,
      confirmedSnapshotId: details.confirmedSnapshotId,
      confirmedSnapshotRevision: details.confirmedSnapshotRevision,
      confirmedAt: details.confirmedAt,
      createdAt: details.createdAt,
      updatedAt: details.updatedAt,
    });
  } catch {
    return null;
  }
}

const NOTE_CLASS =
  "rounded-card border border-brand-border-card bg-brand-panel p-6 text-[13.5px] leading-[1.6] text-text-dark-secondary";

export function WebsitesAccountClient() {
  const t = useTranslations("account.websites");
  const locale = useLocale();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [websites, setWebsites] = useState<readonly WebsiteSummary[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/account/websites")
      .then(async (response) => {
        const body = await readJson(response);
        if (cancelled) return;
        if (response.status === 401) {
          setPhase("signed-out");
          return;
        }
        if (response.status !== 200) {
          setPhase("unavailable");
          return;
        }
        const next = readWebsites(body);
        if (next === null) {
          setPhase("unavailable");
          return;
        }
        setWebsites(next);
        setPhase("ready");
      })
      .catch(() => {
        if (!cancelled) setPhase("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [requestVersion]);

  function statusLabel(profileState: WebsiteSummary["profileState"]): string {
    switch (profileState) {
      case "draft":
        return t("status.draft");
      case "confirmed":
        return t("status.confirmed");
      case "unconfirmed_changes":
        return t("status.unconfirmed_changes");
      default:
        return t("status.not_generated");
    }
  }

  async function setPrimary(websiteId: string): Promise<void> {
    setSettingPrimaryId(websiteId);
    try {
      const response = await fetch(`/api/account/websites/${websiteId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: "set_primary" }),
      });
      if (response.status !== 200) return;
      const body = await readJson(response);
      const current = await readUpdatedWebsite(body);
      if (current === null) return;
      setWebsites((existing) =>
        existing.map((website) =>
          website.websiteId === current.websiteId
            ? current
            : { ...website, isPrimary: false },
        ),
      );
    } finally {
      setSettingPrimaryId(null);
    }
  }

  function openWebsite(websiteId: string, generate: boolean): void {
    const path = localePath(locale, `/account/websites/${websiteId}`);
    router.push(generate ? `${path}?generate=1` : path);
  }

  if (phase === "loading") {
    return <p className={NOTE_CLASS}>{t("loading")}</p>;
  }
  if (phase === "signed-out") {
    return <p className={NOTE_CLASS}>{t("signedOut")}</p>;
  }
  if (phase !== "ready") {
    return (
      <div className={NOTE_CLASS}>
        <p>{t("unavailable")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => {
            setPhase("loading");
            setRequestVersion((current) => current + 1);
          }}
        >
          {t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => setDialogOpen(true)}
        >
          {t("add")}
        </Button>
      </div>

      {websites.length === 0 ? (
        <section className={NOTE_CLASS}>
          <p className="text-[16px] font-semibold text-text-dark-primary">
            {t("emptyTitle")}
          </p>
          <p className="mt-2">{t("emptyBody")}</p>
        </section>
      ) : (
        <div className="space-y-4">
          {websites.map((website) => (
            <Card
              key={website.websiteId}
              data-website-id={website.websiteId}
              data-profile-state={website.profileState}
              className="gap-0 py-0"
            >
              <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 gap-4">
                  <div
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-brand-border-card bg-brand-panel-raised font-mono text-[13px] font-semibold text-brand-accent-text uppercase"
                  >
                    {website.host.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-[18px] font-semibold text-text-dark-primary">
                        {website.displayName ?? website.host}
                      </h3>
                      {website.isPrimary ? (
                        <span className="rounded-full bg-brand-panel-raised px-2.5 py-1 text-[11px] font-medium text-brand-accent-text">
                          {t("primary")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[13px] text-text-dark-secondary">
                      {website.host}
                    </p>
                    <p className="mt-3 text-[13px] text-text-dark-secondary">
                      {statusLabel(website.profileState)}
                    </p>
                    {website.confirmedSnapshotRevision === null ? null : (
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-text-dark-secondary">
                        <span>
                          {t("version", {
                            revision: website.confirmedSnapshotRevision,
                          })}
                        </span>
                        {website.confirmedAt === null ? null : (
                          <span>
                            {t("confirmedAt", {
                              date: new Intl.DateTimeFormat(locale, {
                                dateStyle: "medium",
                              }).format(new Date(website.confirmedAt)),
                            })}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {website.isPrimary ? null : (
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={t("setPrimaryWebsite", {
                        name: website.displayName ?? website.host,
                      })}
                      disabled={settingPrimaryId !== null}
                      onClick={() => void setPrimary(website.websiteId)}
                    >
                      {settingPrimaryId === website.websiteId
                        ? t("settingPrimary")
                        : t("setPrimary")}
                    </Button>
                  )}
                  <Button variant="ghost" asChild>
                    <Link
                      href={localePath(locale, `/account/websites/${website.websiteId}`)}
                      aria-label={t("editWebsite", {
                        name: website.displayName ?? website.host,
                      })}
                    >
                      {t("edit")}
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AddWebsiteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onComplete={(websiteId, generate) => openWebsite(websiteId, generate)}
      />
    </div>
  );
}
