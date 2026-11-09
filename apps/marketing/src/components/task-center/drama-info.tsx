// @input  -- the page locale and a published drama's public facts (never its platform URLs), its ready clips, the /promotions href
// @output -- the pieces of a drama's details laid out like RS Boost's resource page: language, 频道, genre and tag chips; the 上架时间 · 共 N 集 · 前 M 集免费 line; numbered free clip downloads; the 账号报白 banner; the compact how-to
// @pos    -- shared by the clip dialog on /tasks (client) and /tasks/<id> (server); no state, so either side can render it
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { ShieldCheck } from "lucide-react";
import Link from "next/link";

import type { DramaAudience } from "../../lib/task-center/contracts.ts";
import { episodeLine, formatBytes, formatDay, genreLabel, languageName, taskCopy } from "../../lib/task-center/copy.ts";

export function DramaChips({
  locale,
  language,
  audience,
  genre,
  tags,
  max = 8,
}: {
  locale: string;
  language: string;
  audience: DramaAudience | null;
  genre: string | null;
  tags: readonly string[];
  max?: number;
}) {
  const copy = taskCopy(locale);
  const facts = [
    languageName(language, locale),
    audience === null ? null : copy.audience[audience],
    genre === null ? null : genreLabel(genre),
  ].filter((chip): chip is string => chip !== null);
  // A tag that only repeats a chip above (genre "revenge", tag "Revenge") shows once.
  const shown = new Set(facts.map((chip) => chip.toLowerCase()));
  const extra = tags.filter((tag) => !shown.has(tag.toLowerCase())).slice(0, max);
  return (
    <ul className="flex flex-wrap gap-1.5">
      {facts.map((chip) => (
        <li key={`f:${chip}`} className="rounded-[6px] bg-brand-accent-soft px-2 py-0.5 text-[12px] font-medium text-brand-accent-text">
          {chip}
        </li>
      ))}
      {extra.map((tag) => (
        <li key={`t:${tag}`} className="rounded-[6px] bg-brand-panel-raised px-2 py-0.5 text-[12px] text-text-dark-secondary">
          {tag}
        </li>
      ))}
    </ul>
  );
}

/** 上架时间 2026年11月5日 · 共 60 集 · 前 9 集免费; parts nobody knows are left out. */
export function DramaFacts({
  locale,
  listedAt,
  episodes,
  payStart,
}: {
  locale: string;
  listedAt: string | null;
  episodes: number | null;
  payStart: number | null;
}) {
  const copy = taskCopy(locale);
  const parts = [
    listedAt === null ? null : `${copy.listedOn} ${formatDay(listedAt, locale)}`,
    episodeLine(episodes, payStart, copy),
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return <p className="text-[13px] text-text-dark-secondary">{parts.join(" · ")}</p>;
}

export interface DownloadClip {
  readonly id: string;
  readonly title: string;
  readonly byteSize: number;
}

/** One numbered button per ready clip, in the drama's order; `current` marks the clip a dialog is playing. */
export function ClipDownloads({
  locale,
  clips,
  current,
}: {
  locale: string;
  clips: readonly DownloadClip[];
  current?: string;
}) {
  const copy = taskCopy(locale);
  return (
    <ol className="flex flex-wrap gap-2">
      {clips.map((clip, index) => (
        <li key={clip.id}>
          <a
            href={`/api/tasks/assets/${clip.id}?download=1`}
            title={`${clip.title} · ${formatBytes(clip.byteSize)}`}
            aria-label={copy.clipLabel(index + 1, clip.title, formatBytes(clip.byteSize))}
            aria-current={clip.id === current ? "true" : undefined}
            className={`flex size-11 items-center justify-center rounded-[8px] border font-mono text-[14px] transition-colors hover:border-brand-accent-text hover:text-brand-accent-text ${
              clip.id === current
                ? "border-brand-accent-text bg-brand-accent-soft text-brand-accent-text"
                : "border-brand-border-card bg-brand-panel text-text-dark-primary"
            }`}
          >
            {index + 1}
          </a>
        </li>
      ))}
    </ol>
  );
}

export function WhitelistBanner({ locale, href }: { locale: string; href: string }) {
  const copy = taskCopy(locale);
  return (
    // On a phone the action takes its own line under the text, lined up with it.
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-[10px] border border-brand-accent/25 bg-brand-accent-soft px-4 py-3">
      <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-accent-text" />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-[1.5] font-semibold text-text-dark-primary">{copy.whitelistTitle}</p>
        <p className="mt-0.5 text-[13px] leading-[1.55] text-text-dark-secondary">{copy.whitelistBody}</p>
      </div>
      <Link
        href={href}
        className="ml-7 basis-full text-[13px] font-medium text-brand-accent-text hover:underline sm:ml-0 sm:shrink-0 sm:basis-auto sm:self-center"
      >
        {copy.whitelistAction} →
      </Link>
    </div>
  );
}

export function HowTo({ locale }: { locale: string }) {
  const copy = taskCopy(locale);
  return (
    <ol className="space-y-2 text-[13.5px] leading-[1.6] text-text-dark-secondary">
      {copy.howToSteps.map((step, index) => (
        <li key={step} className="flex gap-2.5">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-panel-raised font-mono text-[11.5px] text-text-dark-primary">
            {index + 1}
          </span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}
