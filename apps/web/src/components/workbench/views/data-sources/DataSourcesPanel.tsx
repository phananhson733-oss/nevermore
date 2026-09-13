"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useProjectSources } from "@/lib/api/hooks-sources";
import { formatLocalStamp } from "@/lib/workbench/mock/time";
import { legacyHref } from "@/lib/workbench/routes";
import { Chip, type ChipTone } from "../../ui/Chip.tsx";
import { cn } from "../../ui/cn.ts";
import { BUTTON_MINI, CARD_SHELL, PANEL_TITLE } from "../../ui/panel.ts";
import {
  REAL_PROVIDERS,
  realConnectionsView,
  type ConnectionStatus,
  type ProviderSlot,
  type ProviderView,
  type RealConnectionsView,
  type RealProvider,
  type SnapshotFacts,
} from "./real-connections.ts";

/**
 * The real connections, read only: one card per provider (GSC, GA4) with the
 * connection verdict, the slot's state and its latest snapshot's facts. Shared
 * by the data-sources page and the settings page's sources block (T11), which
 * is why it carries no heading and no "manage on the legacy page" link of its
 * own — each host names the block and links out in its own words
 * (`dataSources.real.title` / `settings.sources.*`).
 *
 * Contract for a host: `<DataSourcesPanel projectId={projectId} />` inside a
 * `QueryClientProvider` (the app provides one). It reads `useProjectSources`
 * itself; the query key is shared with the rail site card, so both mounts share
 * one request. It renders no button, no form and no sample marker: nothing here
 * is sample data and nothing here writes.
 *
 * What it may say is decided by `real-connections.ts`:
 * - loading → a skeleton, never "unknown" or "not connected";
 * - `CONTEXT_INCOMPLETE` → the one cause we can name, with the way out to the
 *   product profile (`/context`), and both cards "unknown";
 * - any other failure → the neutral sentence plus "unknown is not the same as
 *   not connected" (Q4), both cards "unknown";
 * - a read → each card from its own slot; the hint appears when either card is
 *   unknown.
 *
 * GA4 always says no module uses its data yet (S10): a connected GA4 must not
 * read as if something here consumed it. The capture time is the workbench's
 * local wall-clock stamp (Q22); the data only exists after the client read, so
 * there is no server render for it to disagree with. The server's `limitation`
 * sentence is data, not catalogue copy, so it sits outside `data-wb-frame`.
 *
 * 一旦本文件被更新，务必更新开头注释
 */
export function DataSourcesPanel({ projectId }: { readonly projectId: string }) {
  const query = useProjectSources(projectId);
  const view = realConnectionsView({
    sources: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  });
  if (view.kind === "loading") return <PanelSkeleton />;
  return (
    <div data-wb-sources-panel={view.kind} className="flex flex-col gap-3">
      <PanelNotice view={view} projectId={projectId} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {REAL_PROVIDERS.map((provider) => (
          <ProviderCard key={provider} provider={provider} view={view.kind === "read" ? view[provider] : UNKNOWN} />
        ))}
      </div>
    </div>
  );
}

const DASH = "—";

const UNKNOWN: ProviderView = { status: "unknown", slot: null };

const STATUS_TONE: Readonly<Record<ConnectionStatus, ChipTone>> = {
  connected: "seo",
  notConnected: "neutral",
  unknown: "neutral",
};

type SettledView = Exclude<RealConnectionsView, { readonly kind: "loading" }>;

function PanelSkeleton() {
  return (
    <div aria-busy="true" data-wb-sources-panel="loading" className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {REAL_PROVIDERS.map((provider) => (
        <div
          key={provider}
          aria-hidden="true"
          className={cn(CARD_SHELL, "h-32 animate-pulse motion-reduce:animate-none")}
        />
      ))}
    </div>
  );
}

function PanelNotice({ view, projectId }: { readonly view: SettledView; readonly projectId: string }) {
  const t = useTranslations("workbench.dataSources.real");
  if (view.kind === "needProfile") {
    return (
      <div data-wb-frame="" data-wb-sources-notice="needProfile" className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-700">{t("needProfile")}</p>
        <Link href={legacyHref(projectId, "context")} className={BUTTON_MINI}>
          {t("needProfileCta")}
        </Link>
      </div>
    );
  }
  const statuses = view.kind === "read" ? [view.gsc.status, view.ga4.status] : [];
  if (view.kind === "read" && !statuses.includes("unknown")) return null;
  return (
    <div data-wb-frame="" data-wb-sources-notice={view.kind} className="flex flex-col gap-1 text-sm text-slate-600">
      {view.kind === "failed" ? <p>{t("otherError")}</p> : null}
      <p>{t("unknownHint")}</p>
    </div>
  );
}

function ProviderCard({ provider, view }: { readonly provider: RealProvider; readonly view: ProviderView }) {
  const t = useTranslations("workbench.dataSources.real");
  return (
    <section
      data-wb-source={provider}
      data-wb-status={view.status}
      className={cn(CARD_SHELL, "flex min-w-0 flex-col gap-3 p-5")}
    >
      <div data-wb-frame="" className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={PANEL_TITLE}>{t(provider)}</h3>
        <Chip tone={STATUS_TONE[view.status]} title={view.status === "unknown" ? t("unknownHint") : undefined}>
          {t(view.status)}
        </Chip>
      </div>
      {view.slot === null ? null : <SlotFacts slot={view.slot} />}
      {provider === "ga4" ? (
        <p data-wb-frame="" className="text-sm text-slate-500">
          {t("ga4NoConsumer")}
        </p>
      ) : null}
    </section>
  );
}

function SlotFacts({ slot }: { readonly slot: ProviderSlot }) {
  const t = useTranslations("workbench.dataSources.real");
  const tState = useTranslations("sourceState");
  return (
    <>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        <Fact id="state" label={t("state")} value={slot.state === null ? DASH : tState(slot.state)} />
        {slot.snapshot === null ? null : <SnapshotFactRows facts={slot.snapshot} />}
      </dl>
      {slot.snapshot === null ? (
        <p data-wb-frame="" data-wb-no-snapshot="" className="text-sm text-slate-500">
          {t("noSnapshot")}
        </p>
      ) : null}
    </>
  );
}

function SnapshotFactRows({ facts }: { readonly facts: SnapshotFacts }) {
  const t = useTranslations("workbench.dataSources.real");
  const tState = useTranslations("sourceState");
  const format = useFormatter();
  const captured =
    facts.capturedAt === null ? DASH : (
      <time dateTime={facts.capturedAt}>{formatLocalStamp(new Date(facts.capturedAt))}</time>
    );
  return (
    <>
      <Fact id="lastCollected" label={t("lastCollected")} value={captured} />
      <Fact
        id="availability"
        label={t("availability")}
        value={facts.availability === null ? DASH : tState(facts.availability)}
      />
      <Fact id="rows" label={t("rows")} value={facts.rowCount === null ? DASH : format.number(facts.rowCount)} />
      <Fact id="limitation" label={t("limitation")} value={facts.limitation ?? DASH} />
    </>
  );
}

function Fact({ id, label, value }: { readonly id: string; readonly label: string; readonly value: ReactNode }) {
  return (
    <>
      <dt data-wb-frame="" className="text-slate-500">
        {label}
      </dt>
      <dd data-wb-fact={id} className="min-w-0 break-words text-slate-900">
        {value}
      </dd>
    </>
  );
}
