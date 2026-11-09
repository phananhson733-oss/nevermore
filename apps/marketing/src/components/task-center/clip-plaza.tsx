// @input  -- the page locale, one page of clip cards (signed poster and cover URLs made on the server), each listed drama's public details (no platform URLs), the visitor's links per drama, the /promotions href
// @output -- the clip grid with type and 本周爆款 badges; a card opens a dialog laid out like RS Boost's resource page: the clip playing beside the drama's title, chips, 上架时间 · 共 N 集 · 前 M 集免费, synopsis, numbered free downloads, the promo link (no 口令) with a link to the drama page it opens, the 账号报白 banner and the how-to
// @pos    -- the body of /tasks, the task center's 素材广场
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { Flame, Play, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { ClipType, DramaAudience } from "../../lib/task-center/contracts.ts";
import { genreLabel, languageName, taskCopy } from "../../lib/task-center/copy.ts";
import { ClaimPanel, type LinkView } from "./claim-panel.tsx";
import { ClipDownloads, DramaChips, DramaFacts, HowTo, WhitelistBanner, type DownloadClip } from "./drama-info.tsx";

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

/** What a drama's dialog shows beyond the card; built on the server, never with the platform's own URLs. */
export interface PlazaDrama {
  readonly synopsis: string | null;
  readonly listedAt: string | null;
  readonly episodes: number | null;
  readonly payStart: number | null;
  readonly clips: readonly DownloadClip[];
}

export function ClipPlaza({
  locale,
  cards,
  dramas,
  signedIn,
  signInHref,
  promotionsHref,
  links,
}: {
  locale: string;
  cards: readonly ClipCard[];
  dramas: Readonly<Record<string, PlazaDrama>>;
  signedIn: boolean;
  signInHref: string;
  promotionsHref: string;
  links: Readonly<Record<string, LinkView>>;
}) {
  const copy = taskCopy(locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<ClipCard | null>(null);
  // Links claimed in a dialog stay shown when it is opened again. Kept apart
  // from the server's links, which change with each page of the grid.
  const [held, setHeld] = useState<Readonly<Record<string, LinkView>>>({});
  const detail = open === null ? undefined : dramas[open.dramaId];

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
          return (
            <li key={card.id}>
              <button
                type="button"
                onClick={() => setOpen(card)}
                aria-label={copy.playClip(`${card.dramaTitle} · ${card.title}`)}
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
                    <p className="mt-1 truncate text-[12.5px] text-text-dark-secondary">{card.title}</p>
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
        className="m-auto max-h-[calc(100dvh-32px)] w-[min(920px,calc(100vw-32px))] overflow-y-auto rounded-card border border-brand-border-card bg-brand-panel p-0 text-text-dark-primary backdrop:bg-scrim md:overflow-hidden"
      >
        {open !== null && (
          <>
            {/* Sticky on the dialog, not in the scrolling column: on a phone the
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
            <div className="grid md:grid-cols-[minmax(0,340px)_1fr]">
              <div className="flex items-center justify-center bg-media">
                {!signedIn ? (
                  <div className="relative aspect-[9/16] max-h-[70vh] w-full">
                    {(open.posterUrl ?? open.coverUrl) !== null && (
                      <img src={open.posterUrl ?? open.coverUrl ?? ""} alt="" className="h-full w-full object-cover opacity-60" />
                    )}
                    <p className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-[14px] text-on-media">
                      {copy.signInForClips}{" "}
                      <a href={signInHref} className="underline">
                        {copy.signIn}
                      </a>
                    </p>
                  </div>
                ) : open.kind === "video" ? (
                  <video
                    key={open.id}
                    controls
                    autoPlay
                    playsInline
                    preload="metadata"
                    poster={open.posterUrl ?? open.coverUrl ?? undefined}
                    src={`/api/tasks/assets/${open.id}`}
                    className="aspect-[9/16] max-h-[75vh] w-full"
                  />
                ) : (
                  <img src={`/api/tasks/assets/${open.id}`} alt="" className="max-h-[75vh] w-full object-contain" />
                )}
              </div>
              <div className="space-y-5 p-6 md:max-h-[calc(100dvh-32px)] md:overflow-y-auto">
                <div className="space-y-2.5 pr-8">
                  <h2 className="text-[20px] leading-[1.3] font-semibold">{open.dramaTitle}</h2>
                  <DramaChips
                    locale={locale}
                    language={open.language}
                    audience={open.audience}
                    genre={open.genre}
                    tags={open.tags}
                  />
                  <DramaFacts
                    locale={locale}
                    listedAt={detail?.listedAt ?? null}
                    episodes={detail?.episodes ?? null}
                    payStart={detail?.payStart ?? null}
                  />
                  {detail?.synopsis && (
                    <p className="line-clamp-5 text-[13.5px] leading-[1.65] whitespace-pre-line text-text-dark-secondary">
                      {detail.synopsis}
                    </p>
                  )}
                </div>

                <section className="border-t border-brand-border-card pt-5">
                  <h3 className={H3}>{copy.clips}</h3>
                  <p className="mt-1 text-[13px] text-text-dark-secondary">
                    {open.clipType !== null && (
                      <span className="mr-2 rounded-[6px] bg-brand-panel-raised px-1.5 py-0.5 text-[12px]">
                        {copy.clipType[open.clipType]}
                      </span>
                    )}
                    {open.title}
                  </p>
                  {signedIn ? (
                    <div className="mt-3 space-y-3">
                      <a
                        href={`/api/tasks/assets/${open.id}?download=1`}
                        className="inline-flex h-10 items-center rounded-[10px] bg-primary px-5 text-[14px] font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        {copy.download} · {open.size}
                      </a>
                      {detail !== undefined && detail.clips.length > 1 && (
                        <div>
                          <p className="mb-2 text-[12.5px] text-text-dark-secondary">
                            {copy.allClips} · {copy.clipsBody}
                          </p>
                          <ClipDownloads locale={locale} clips={detail.clips} current={open.id} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 text-[13.5px] text-text-dark-secondary">
                      {copy.signInForClips}{" "}
                      <a href={signInHref} className="font-medium text-brand-accent-text hover:underline">
                        {copy.signIn}
                      </a>
                    </p>
                  )}
                </section>

                <section className="border-t border-brand-border-card pt-5">
                  <h3 className={H3}>{copy.promote}</h3>
                  <p className="mt-1 text-[13px] leading-[1.55] text-text-dark-secondary">{copy.promoteBody}</p>
                  <div className="mt-3">
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
                    />
                  </div>
                </section>

                <WhitelistBanner locale={locale} href={promotionsHref} />

                <section className="border-t border-brand-border-card pt-5">
                  <h3 className={H3}>{copy.howTo}</h3>
                  <div className="mt-3">
                    <HowTo locale={locale} />
                  </div>
                </section>

                <Link href={open.dramaHref} className="inline-block text-[13.5px] text-brand-accent-text hover:underline">
                  {copy.viewDrama} →
                </Link>
              </div>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}

const H3 = "text-[15px] font-semibold text-text-dark-primary";
