// @input  -- the page locale, one page of drama cards (each fronted by the drama's first clip; signed poster and cover URLs made on the server), each listed drama's public details and clips with their stills (no platform URLs), the visitor's links per drama
// @output -- the grid, one card per drama, with type, clip count and 本周爆款 badges (a clip named only by a UUID or hash shows no title); a card opens a wide two-column dialog: on the right the clip playing (first on a phone) with its own download under it; on the left, in MoboReels' order, the drama's cover with its title, its chips (language first, then 频道, genre and tags), 上架时间 · 共 N 集 · 前 M 集免费, the full synopsis, the 推广链接 and 资源推广链接 (made for a signed-in visitor as the dialog opens, no 口令), 系列资源 (one numbered button per clip that switches the player and its download to that clip), the how-to as an open box and a link to the drama's page
// @pos    -- the body of /tasks, the task center's 素材广场
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { Download, Flame, Play, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { ClipType, DramaAudience } from "../../lib/task-center/contracts.ts";
import { clipTitle, formatBytes, genreLabel, languageName, taskCopy } from "../../lib/task-center/copy.ts";
import { ClaimPanel, type LinkView } from "./claim-panel.tsx";
import { DramaChips, DramaFacts, HowTo, type DownloadClip } from "./drama-info.tsx";

export interface ClipCard {
  readonly id: string;
  readonly kind: "video" | "image";
  readonly title: string;
  readonly clipType: ClipType | null;
  /** The clip's still, or for an image the image itself; null shows the drama's cover. */
  readonly posterUrl: string | null;
  readonly coverUrl: string | null;
  readonly size: string;
  readonly hot: boolean;
  /** Every ready clip of the drama; the card stands for all of them. */
  readonly clipCount: number;
  readonly dramaId: string;
  readonly dramaTitle: string;
  readonly dramaHref: string;
  /** /watch/<id>, the reader's page every promo link opens. */
  readonly watchHref: string;
  readonly audience: DramaAudience | null;
  readonly genre: string | null;
  readonly tags: readonly string[];
  readonly language: string;
}

/** One of a drama's clips in its dialog: 系列资源 numbers them and the player switches between them. */
export interface PlazaClip extends DownloadClip {
  readonly kind: "video" | "image";
  readonly clipType: ClipType | null;
  /** Signed; the clip's still, or an image itself. Null shows the drama's cover. */
  readonly stillUrl: string | null;
}

/** What a drama's dialog shows beyond the card; built on the server, never with the platform's own URLs. */
export interface PlazaDrama {
  readonly synopsis: string | null;
  readonly listedAt: string | null;
  readonly episodes: number | null;
  readonly payStart: number | null;
  readonly clips: readonly PlazaClip[];
}

/** What the player shows: the card's own clip, or the one picked in 系列资源. */
interface Playing {
  readonly id: string;
  readonly kind: "video" | "image";
  readonly title: string;
  readonly clipType: ClipType | null;
  readonly stillUrl: string | null;
  readonly size: string;
}

export function ClipPlaza({
  locale,
  cards,
  dramas,
  signedIn,
  signInHref,
  links,
}: {
  locale: string;
  cards: readonly ClipCard[];
  dramas: Readonly<Record<string, PlazaDrama>>;
  signedIn: boolean;
  signInHref: string;
  links: Readonly<Record<string, LinkView>>;
}) {
  const copy = taskCopy(locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<ClipCard | null>(null);
  // Links claimed in a dialog stay shown when it is opened again. Kept apart
  // from the server's links, which change with each page of the grid.
  const [held, setHeld] = useState<Readonly<Record<string, LinkView>>>({});
  // The clip picked in 系列资源; null plays the card's own clip.
  const [picked, setPicked] = useState<string | null>(null);
  const detail = open === null ? undefined : dramas[open.dramaId];
  const pickedClip = picked === null ? undefined : detail?.clips.find((clip) => clip.id === picked);
  const playing: Playing | null =
    open === null
      ? null
      : pickedClip === undefined || pickedClip.id === open.id
        ? { id: open.id, kind: open.kind, title: open.title, clipType: open.clipType, stillUrl: open.posterUrl, size: open.size }
        : {
            id: pickedClip.id,
            kind: pickedClip.kind,
            title: pickedClip.title,
            clipType: pickedClip.clipType,
            stillUrl: pickedClip.stillUrl,
            size: formatBytes(pickedClip.byteSize),
          };
  const openName = playing === null ? null : clipTitle(playing.title);

  useEffect(() => {
    if (open !== null && dialog.current?.open === false) dialog.current.showModal();
  }, [open]);

  const meta = (card: ClipCard) =>
    [
      card.audience === null ? null : copy.audience[card.audience],
      card.genre === null ? null : genreLabel(card.genre),
      languageName(card.language, locale),
    ]
      .filter((part): part is string => part !== null)
      .join(" · ");

  return (
    <>
      <ul className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {cards.map((card) => {
          const still = card.posterUrl ?? card.coverUrl;
          const name = clipTitle(card.title);
          return (
            <li key={card.id}>
              <button
                type="button"
                onClick={() => {
                  setPicked(null);
                  setOpen(card);
                }}
                aria-label={copy.playClip(card.dramaTitle)}
                className="group block w-full overflow-hidden rounded-card border border-brand-border-card bg-brand-panel text-left transition-colors hover:border-brand-accent/50"
              >
                <div className="relative aspect-[9/16] bg-brand-panel-raised">
                  {still !== null && (
                    // Signed R2 URLs change every hour; next/image would cache them as new images.
                    <img src={still} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )}
                  {card.clipType !== null && (
                    <span className="absolute top-2 left-2 rounded-[6px] bg-media/60 px-2 py-0.5 text-[12px] text-on-media">
                      {copy.clipType[card.clipType]}
                    </span>
                  )}
                  {card.clipCount > 1 && (
                    <span className="absolute top-2 right-2 rounded-[6px] bg-media/60 px-2 py-0.5 text-[12px] text-on-media">
                      {copy.clipCount(card.clipCount)}
                    </span>
                  )}
                  {card.kind === "video" && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex size-11 items-center justify-center rounded-full bg-media/45 text-on-media transition-transform group-hover:scale-110">
                        <Play aria-hidden className="size-5 translate-x-px fill-current" />
                      </span>
                    </span>
                  )}
                  {card.hot && (
                    <span
                      title={copy.hotNote}
                      className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-[6px] bg-brand-warning px-2 py-0.5 text-[12px] font-medium text-brand-on-warning"
                    >
                      <Flame aria-hidden className="size-3.5" />
                      {copy.hotThisWeek}
                    </span>
                  )}
                </div>
                <div className="flex gap-3 p-3">
                  {card.coverUrl !== null && (
                    <img src={card.coverUrl} alt="" loading="lazy" className="h-12 w-9 shrink-0 rounded-[4px] object-cover" />
                  )}
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-[14px] leading-[1.35] font-semibold text-text-dark-primary group-hover:text-brand-accent-text">
                      {card.dramaTitle}
                    </p>
                    {/* A drama of several clips is named by the drama alone; one clip keeps its own name. */}
                    {card.clipCount === 1 && name !== null && (
                      <p className="mt-1 truncate text-[12.5px] text-text-dark-secondary">{name}</p>
                    )}
                    <p className="mt-0.5 truncate text-[12px] text-text-dark-secondary">{meta(card)}</p>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <dialog
        ref={dialog}
        onClose={() => setOpen(null)}
        // A click on the backdrop lands on the dialog itself, not its content.
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        className="m-auto max-h-[calc(100dvh-32px)] w-[min(1120px,calc(100vw-32px))] overflow-y-auto rounded-card border border-brand-border-card bg-brand-panel p-0 text-text-dark-primary backdrop:bg-scrim md:overflow-hidden"
      >
        {open !== null && (
          <>
            {/* Sticky on the dialog, not in a scrolling column: on a phone the
                whole dialog scrolls and the button stays at its top right. */}
            <div className="sticky top-0 z-10 flex h-0 justify-end">
              <button
                type="button"
                onClick={() => dialog.current?.close()}
                aria-label={copy.close}
                className="mt-3 mr-3 h-fit rounded-[8px] bg-brand-panel/80 p-1.5 text-text-dark-secondary hover:bg-brand-panel-raised"
              >
                <X className="size-5" />
              </button>
            </div>
            {/* Information on the left, the player on the right. From md up the
                columns scroll on their own and the dialog does not; on a phone
                the player comes first. The column is capped at the dialog's
                width even there, or a link's unbroken URL would widen it past
                the screen. */}
            <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_320px] lg:grid-cols-[minmax(0,1fr)_380px]">
              {/* MoboReels' order: what the drama is, then the links, then
                  every clip to download, then how it all works. */}
              <div className="space-y-5 p-6 md:max-h-[calc(100dvh-34px)] md:overflow-y-auto lg:p-8">
                {/* MoboReels' header: the cover on the left, the title, chips,
                    facts and synopsis beside it. On a phone the synopsis drops
                    under both, where it gets the full width. */}
                <div
                  className={
                    open.coverUrl === null
                      ? "space-y-3"
                      : "grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 gap-y-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-x-5"
                  }
                >
                  {open.coverUrl !== null && (
                    <img
                      src={open.coverUrl}
                      alt=""
                      className="aspect-[3/4] w-full self-start rounded-[8px] border border-brand-border-card bg-brand-panel-raised object-cover sm:row-span-2"
                    />
                  )}
                  <div className="min-w-0 space-y-2.5">
                    <h2 className="text-[20px] leading-[1.3] font-semibold">{open.dramaTitle}</h2>
                    <DramaChips
                      locale={locale}
                      language={open.language}
                      audience={open.audience}
                      genre={open.genre}
                      tags={open.tags}
                    />
                    {detail !== undefined && (
                      <DramaFacts
                        locale={locale}
                        listedAt={detail.listedAt}
                        episodes={detail.episodes}
                        payStart={detail.payStart}
                      />
                    )}
                  </div>
                  {detail?.synopsis && (
                    <section className={open.coverUrl === null ? undefined : "col-span-2 sm:col-span-1 sm:col-start-2"}>
                      <h3 className="sr-only">{copy.synopsis}</h3>
                      <p className="text-[13.5px] leading-[1.65] whitespace-pre-line text-text-dark-secondary">
                        {detail.synopsis}
                      </p>
                    </section>
                  )}
                </div>

                <ClaimPanel
                  key={open.dramaId}
                  dramaId={open.dramaId}
                  watchHref={open.watchHref}
                  locale={locale}
                  signedIn={signedIn}
                  signInHref={signInHref}
                  initialLink={held[open.dramaId] ?? links[open.dramaId] ?? null}
                  onClaimed={(view) => {
                    const dramaId = open.dramaId;
                    setHeld((previous) => ({ ...previous, [dramaId]: view }));
                  }}
                  linkLevel={3}
                />

                {/* Downloads need sign-in, so the page sends the list only then. */}
                {detail !== undefined && detail.clips.length > 0 && (
                  <section>
                    <h3 className={H3}>{copy.seriesClips}</h3>
                    <p className="mt-1 mb-3 text-[13px] text-text-dark-secondary">{copy.seriesClipsBody}</p>
                    <ol className="flex flex-wrap gap-2">
                      {detail.clips.map((clip, index) => {
                        const current = clip.id === playing?.id;
                        const clipName = clipTitle(clip.title);
                        const size = formatBytes(clip.byteSize);
                        return (
                          <li key={clip.id}>
                            <button
                              type="button"
                              onClick={() => setPicked(clip.id)}
                              title={clipName === null ? size : `${clipName} · ${size}`}
                              aria-label={copy.playNumbered(index + 1, clipName, size)}
                              aria-pressed={current}
                              className={`flex size-11 items-center justify-center rounded-[8px] border font-mono text-[14px] transition-colors hover:border-brand-accent-text hover:text-brand-accent-text ${
                                current
                                  ? "border-brand-accent-text bg-brand-accent-soft text-brand-accent-text"
                                  : "border-brand-border-card bg-brand-panel text-text-dark-primary"
                              }`}
                            >
                              {index + 1}
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                )}

                <section className="rounded-[10px] border border-brand-border-card bg-brand-panel-raised px-4 py-3.5">
                  <h3 className={H3}>{copy.howTo}</h3>
                  <div className="mt-3">
                    <HowTo locale={locale} />
                  </div>
                </section>

                <Link href={open.dramaHref} className="inline-block text-[13.5px] text-brand-accent-text hover:underline">
                  {copy.viewDrama} →
                </Link>
              </div>

              {/* The clip and what to do with it: watch it and download it. */}
              <div className="order-first flex flex-col bg-media md:order-none md:max-h-[calc(100dvh-34px)] md:overflow-y-auto">
                <div className="flex min-h-0 flex-1 items-center justify-center">
                  {!signedIn ? (
                    <div className="relative aspect-[9/16] max-h-[70vh] w-full md:max-h-[calc(100dvh-34px)]">
                      {(playing?.stillUrl ?? open.coverUrl) !== null && (
                        <img src={playing?.stillUrl ?? open.coverUrl ?? ""} alt="" className="h-full w-full object-cover opacity-60" />
                      )}
                      <p className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-[14px] text-on-media">
                        {copy.signInForClips}{" "}
                        <a href={signInHref} className="underline">
                          {copy.signIn}
                        </a>
                      </p>
                    </div>
                  ) : playing?.kind === "video" ? (
                    <video
                      key={playing.id}
                      controls
                      autoPlay
                      playsInline
                      preload="metadata"
                      poster={playing.stillUrl ?? open.coverUrl ?? undefined}
                      src={`/api/tasks/assets/${playing.id}`}
                      // Room left under the player for the download panel.
                      className="aspect-[9/16] max-h-[70vh] w-full md:max-h-[calc(100dvh-150px)]"
                    />
                  ) : (
                    <img
                      src={`/api/tasks/assets/${playing?.id ?? open.id}`}
                      alt=""
                      className="max-h-[70vh] w-full object-contain md:max-h-[calc(100dvh-150px)]"
                    />
                  )}
                </div>
                {signedIn && (
                  <div className="space-y-3 border-t border-brand-border-card bg-brand-panel p-4">
                    {(playing?.clipType != null || openName !== null) && (
                      <p className="flex items-center gap-2 text-[13px]">
                        {playing?.clipType != null && (
                          <span className="shrink-0 rounded-[6px] bg-brand-panel-raised px-1.5 py-0.5 text-[12px] text-text-dark-secondary">
                            {copy.clipType[playing.clipType]}
                          </span>
                        )}
                        {openName !== null && <span className="min-w-0 truncate text-text-dark-primary">{openName}</span>}
                      </p>
                    )}
                    <a
                      href={`/api/tasks/assets/${playing?.id ?? open.id}?download=1`}
                      className="flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-primary px-5 text-[14px] font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      <Download aria-hidden className="size-4" />
                      {copy.downloadThis} · {playing?.size ?? open.size}
                    </a>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}

const H3 = "text-[15px] font-semibold text-text-dark-primary";
