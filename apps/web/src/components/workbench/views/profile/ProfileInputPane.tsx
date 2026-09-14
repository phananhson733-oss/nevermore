"use client";

import Link from "next/link";
import { useId } from "react";
import { useTranslations } from "next-intl";
import { domainOf, splitList } from "@/lib/workbench/mock/text";
import { legacyHref } from "@/lib/workbench/routes";
import type { Profile } from "@/lib/workbench/types";
import { Field } from "../../ui/Field.tsx";
import { InPane } from "../../ui/InPane.tsx";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "../../ui/panel.ts";
import { Toggle } from "../../ui/Toggle.tsx";
import type { ProfileSources } from "./build-profile-doc.ts";

/**
 * The profile page's input pane (plan Task 9 Step 2; outward form
 * `ref:opengengrowth/views/SiteProfileView.tsx:19-141`, behaviour jsx:1214-1236).
 *
 * - URL, brand and market mirror the real project (design §6.7): the provider
 *   rewrites them on every hydration, so they are read-only inputs here, not the
 *   prototype's editable fields and market `<select>`. Only the three fields
 *   `patchProfile` accepts are editable, one field per dispatch.
 * - Three source switches. The prototype's fourth, "AI summary", is gone: there
 *   is no model, and the placeholder AI document is always part of the profile.
 * - The prototype's "GSC (not connected)" hint and "go connect" button read the
 *   dead `conns` field (Q31) and are not ported; whether GSC rows exist is shown
 *   by the profile itself.
 * - "New site" (`reboot`) became a link to the real product profile (design
 *   §12): creating a site is the top bar's job.
 * - The run button says what it will do, and while a run is in flight it says
 *   so and is disabled; the run itself is `useProfileRun`'s.
 * - When the last run's document was refused because the data changed while
 *   it ran, a standing alert says nothing was saved and that it can be
 *   generated again (T9 review #1). It names no cause beyond the change.
 *
 * The whole pane is framework copy (`data-wb-frame`, Q30): the profile's values
 * live in input `value`s, which are not text content; the only value printed
 * as text is the URL's host, and a URL host is ASCII (IDNA).
 */

export type ProfilePatch = Partial<Pick<Profile, "positioning" | "features" | "competitors">>;

export interface ProfileInputPaneProps {
  readonly projectId: string;
  readonly profile: Profile;
  readonly srcs: ProfileSources;
  readonly running: boolean;
  readonly hasDoc: boolean;
  /** The last run's document was refused (`useProfileRun`'s `refused`). */
  readonly stale: boolean;
  readonly onRun: () => void;
  readonly onPatch: (patch: ProfilePatch) => void;
  readonly onSrcsChange: (next: ProfileSources) => void;
}

type EditableKey = keyof Required<ProfilePatch>;

const SOURCE_KEYS = ["crawl", "gsc", "third"] as const;
const INPUT =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-500";
const INPUT_READONLY =
  "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600";

function patchOf(key: EditableKey, value: string): ProfilePatch {
  switch (key) {
    case "positioning":
      return { positioning: value };
    case "features":
      return { features: value };
    case "competitors":
      return { competitors: value };
  }
}

function ReadonlyFields({ profile }: { readonly profile: Profile }) {
  const t = useTranslations("workbench.profile.fields");
  const id = useId();
  const rows = [
    ["url", profile.url, domainOf(profile.url)],
    ["brand", profile.brand, undefined],
    ["market", profile.market, undefined],
  ] as const;
  return (
    <>
      {rows.map(([key, value, meta]) => (
        <Field key={key} label={t(key)} meta={meta} htmlFor={`${id}-${key}`}>
          <input id={`${id}-${key}`} type="text" value={value} readOnly className={INPUT_READONLY} />
        </Field>
      ))}
    </>
  );
}

function EditableFields({
  profile,
  onPatch,
}: {
  readonly profile: Profile;
  readonly onPatch: (patch: ProfilePatch) => void;
}) {
  const t = useTranslations("workbench.profile.fields");
  const id = useId();
  const rows: readonly (readonly [EditableKey, string])[] = [
    // Code points, not UTF-16 units: an emoji is one character to the reader.
    ["positioning", t("charCount", { count: Array.from(profile.positioning).length })],
    ["features", t("itemCount", { count: splitList(profile.features).length })],
    ["competitors", t("itemCount", { count: splitList(profile.competitors).length })],
  ];
  return (
    <>
      {rows.map(([key, meta]) => (
        <Field key={key} label={t(key)} meta={meta} htmlFor={`${id}-${key}`}>
          <input
            id={`${id}-${key}`}
            type="text"
            value={profile[key]}
            placeholder={t(`${key}Placeholder`)}
            onChange={(event) => onPatch(patchOf(key, event.currentTarget.value))}
            className={INPUT}
          />
        </Field>
      ))}
    </>
  );
}

function SourceSwitches({
  srcs,
  onChange,
}: {
  readonly srcs: ProfileSources;
  readonly onChange: (next: ProfileSources) => void;
}) {
  const t = useTranslations("workbench.profile");
  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 pt-5">
      <fieldset className="m-0 flex min-w-0 flex-col gap-3 p-0">
        <legend className="mb-3 text-sm font-medium text-slate-600">{t("sources.title")}</legend>
        {SOURCE_KEYS.map((key) => (
          <Toggle
            key={key}
            checked={srcs[key]}
            label={t(`sources.${key}`)}
            onChange={(next) => onChange({ ...srcs, [key]: next })}
          />
        ))}
      </fieldset>
      <p className="text-xs text-slate-500">{t("run.note")}</p>
    </div>
  );
}

function runLabel(running: boolean, hasDoc: boolean): "run.busy" | "run.rerun" | "run.button" {
  if (running) return "run.busy";
  return hasDoc ? "run.rerun" : "run.button";
}

export function ProfileInputPane(props: ProfileInputPaneProps) {
  const { projectId, profile, srcs, running, hasDoc, stale, onRun, onPatch, onSrcsChange } = props;
  const t = useTranslations("workbench.profile");
  const tPanes = useTranslations("workbench.panes");
  const footer = (
    <>
      <button type="button" disabled={running} onClick={onRun} className={BUTTON_PRIMARY}>
        {t(runLabel(running, hasDoc))}
      </button>
      <Link href={legacyHref(projectId, "context")} className={BUTTON_SECONDARY}>
        {t("legacyCta")}
      </Link>
    </>
  );
  return (
    <div data-wb-frame="">
      <InPane title={t("inputTitle")} tag={tPanes("in")} note={t("readonlyNote")} footer={footer}>
        <div className="flex flex-col gap-5">
          <ReadonlyFields profile={profile} />
          <EditableFields profile={profile} onPatch={onPatch} />
          <SourceSwitches srcs={srcs} onChange={onSrcsChange} />
          {stale ? (
            <p role="alert" data-wb-profile-stale="" className="text-sm text-slate-700">
              {t("run.stale")}
            </p>
          ) : null}
        </div>
      </InPane>
    </div>
  );
}
