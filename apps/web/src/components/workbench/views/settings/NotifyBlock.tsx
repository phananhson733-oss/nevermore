"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import type { WorkbenchContextValue } from "@/lib/workbench/store/WorkbenchProvider";
import { cn } from "../../ui/cn.ts";
import { CARD_SHELL, PANEL_TITLE } from "../../ui/panel.ts";
import { Toggle } from "../../ui/Toggle.tsx";

/**
 * Notification preferences (design §6.2, T11, Q24): four switches kept in this
 * browser's workbench store. Nothing reads them to send anything, which the
 * block says in so many words (`settings.notify.note`). No sample-data chip
 * (codex S11 #1): the switches read and write the operator's own preferences,
 * so "Sample data" would be false after a flip, and the chip's title (module
 * results are generated locally as samples, GSC rows the operator imports are
 * not, sample content is in Chinese only) says nothing about them. There is no
 * save button: a flip is the write.
 *
 * A flip dispatches `setNotify` with that switch's key and value, and the
 * reducer merges it into the `notify` it holds when the action runs (codex S11
 * #2). Not a whole object built from the `notify` this render showed: two flips
 * in one frame, or a flip landing after another tab's write, would put the
 * other switches back to what this render showed.
 *
 * Before the store has read storage the switches are a skeleton, not the seed's
 * values and not "all off" (Q10): either would state preferences the operator
 * may not have, and a flip then would be overwritten by hydration.
 *
 * Frame copy (title, note, labels) carries `data-wb-frame` (Q30).
 *
 * 一旦本文件被更新，务必更新开头注释
 */
export function NotifyBlock() {
  const { state, ready, dispatch } = useWorkbench();
  const t = useTranslations("workbench.settings.notify");
  const titleId = useId();
  return (
    <section
      data-wb-notify=""
      aria-labelledby={titleId}
      className={cn(CARD_SHELL, "mb-6 p-6")}
    >
      <div
        data-wb-frame=""
        className="mb-2 flex flex-wrap items-center justify-between gap-3"
      >
        <h2 id={titleId} className={PANEL_TITLE}>
          {t("title")}
        </h2>
      </div>
      <p
        data-wb-frame=""
        data-wb-notify-note=""
        className="mb-5 text-sm text-slate-600"
      >
        {t("note")}
      </p>
      {ready ? (
        <NotifyToggles
          notify={state.notify}
          onChange={(key, value) => dispatch({ type: "setNotify", key, value })}
        />
      ) : (
        <NotifySkeleton />
      )}
    </section>
  );
}

type NotifyPrefs = WorkbenchContextValue["state"]["notify"];

const NOTIFY_ROWS = [
  { key: "weekly", label: "weekly.label", description: "weekly.description" },
  { key: "drop", label: "drop.label", description: "drop.description" },
  {
    key: "mention",
    label: "mention.label",
    description: "mention.description",
  },
  { key: "gsc", label: "gsc.label", description: "gsc.description" },
] as const satisfies readonly {
  readonly key: keyof NotifyPrefs;
  readonly label: string;
  readonly description: string;
}[];

function NotifyToggles({
  notify,
  onChange,
}: {
  readonly notify: NotifyPrefs;
  readonly onChange: (key: keyof NotifyPrefs, value: boolean) => void;
}) {
  const t = useTranslations("workbench.settings.notify");
  return (
    <div data-wb-frame="" className="flex flex-col gap-4">
      {NOTIFY_ROWS.map((row) => (
        <Toggle
          key={row.key}
          checked={notify[row.key]}
          label={t(row.label)}
          description={t(row.description)}
          onChange={(next) => onChange(row.key, next)}
        />
      ))}
    </div>
  );
}

function NotifySkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      {NOTIFY_ROWS.map((row) => (
        <div
          key={row.key}
          aria-hidden="true"
          className="h-10 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
