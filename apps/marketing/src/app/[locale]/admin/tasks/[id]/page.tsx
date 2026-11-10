// @input  -- locale and drama id params; the admin check; the drama and all its assets; R2 for the cover
// @output -- the admin drama page: cover, title, episodes, pay start, tags, synopsis and where the details came from (a drama from 查剧 links to its page on the theater's site where there is a link to make: ReelShort, DramaBox, StardustTV, MoboReels, NetShort, YourChannel) up top, and 从官网补全资料 for a drama on a platform 查剧 knows (re-runs 查剧 and writes its details over the drama's); links to the promoter page and, once listed, the reader's drama page (no draft or 查剧 notes: the status line says draft); clip upload (files or a whole folder, in file-name order), each clip numbered as 系列资源 numbers it, rename, retag and delete; the publish switch under the clips, on the right (上架 as a large button); the platform-link panel hidden for now (SHOW_PROMO_LINK, still editable in the details form); the full details form folded away
// @pos    -- /admin/tasks/<id> (Chinese only); 404 for anyone not on TASK_ADMIN_EMAILS
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import {
  AssetTitle,
  ClipTypeSelect,
  DeleteAssetButton,
  RefillControl,
  StatusControl,
  UploadControl,
} from "@/components/task-center/admin/drama-admin-controls";
import { DramaForm, PromoLinkForm, type DramaFormValues } from "@/components/task-center/admin/drama-form";
import { TagList } from "@/components/task-center/admin/drama-quick-create";
import { checkTaskAdmin } from "@/lib/task-center/admin";
import { isUuid, LOOKUP_PLATFORMS, THEATER_PLATFORMS } from "@/lib/task-center/contracts";
import { DRAMA_STATUS_LABELS, languageName, platformLabel } from "@/lib/task-center/copy";
import { getTaskDb } from "@/lib/task-center/db";
import { getDramaForAdmin } from "@/lib/task-center/dramas-store";
import { coverImageUrl, readR2Config } from "@/lib/task-center/r2";
import { theaterPageUrl } from "@/lib/task-center/theater-details";
import { localePath } from "@/lib/locale-path";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export default async function AdminDramaPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const admin = await checkTaskAdmin();
  if (admin.status !== "admin" || !isUuid(id)) notFound();
  const base = localePath(locale, "/admin/tasks");
  const db = getTaskDb();
  if (db === null) {
    return <p className="mx-auto max-w-5xl text-text-dark-secondary">没有配置 TASKS_DATABASE_URL，任务数据库不可用。</p>;
  }
  const found = await getDramaForAdmin(db, id);
  if (found === null) notFound();
  const { drama, assets } = found;
  const readyNumber = new Map(
    assets.filter((asset) => asset.status === "ready").map((asset, index) => [asset.id, index + 1] as const),
  );
  const sourcePage = drama.source === "beidou" ? theaterPageUrl(drama.platform, drama.sourceDramaId) : null;
  const r2 = readR2Config();
  const values: DramaFormValues = {
    title: drama.title,
    titleCn: drama.titleCn,
    platform: drama.platform,
    language: drama.language,
    episodes: drama.episodes,
    payStart: drama.payStart,
    synopsis: drama.synopsis,
    promoTargetUrl: drama.promoTargetUrl,
    promoCodeParam: drama.promoCodeParam,
    audience: drama.audience,
    genre: drama.genre,
    tags: drama.tags,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <Link href={base} className="text-[13.5px] text-brand-accent-text hover:underline">
        ← 全部短剧
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold text-text-dark-primary">{drama.titleCn ?? drama.title}</h1>
          <p className="mt-1 text-[14px] text-text-dark-secondary">
            {DRAMA_STATUS_LABELS[drama.status]} · {drama.promoterCount} 人推广
            {drama.status === "published" && (
              <>
                {" · "}
                <Link href={localePath(locale, `/tasks/${drama.id}`)} className="text-brand-accent-text hover:underline">
                  看前台页面
                </Link>
              </>
            )}
            {drama.listedAt !== null && (
              <>
                {" · "}
                <Link href={localePath(locale, `/watch/${drama.id}`)} className="text-brand-accent-text hover:underline">
                  看读者的剧页面
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
      <div className={`${PANEL} flex flex-col gap-6 sm:flex-row`}>
        <div className="w-full shrink-0 sm:w-48">
          <div className="aspect-[3/4] w-full overflow-hidden rounded-[10px] border border-brand-border-card bg-brand-panel-raised">
            {r2 !== null && drama.coverKey !== null ? (
              <img src={coverImageUrl(r2, drama.coverKey)} alt="" className="h-full w-full object-cover" />
            ) : (
              <p className="flex h-full items-center justify-center text-[13px] text-text-dark-secondary">还没有封面</p>
            )}
          </div>
          <div className="mt-3">
            <UploadControl dramaId={drama.id} purpose="cover" storageReady={r2 !== null} />
          </div>
          <p className="mt-2 text-[12px] leading-[1.5] text-text-dark-secondary">JPG、PNG 或 WebP，不超过 20 MB，建议竖版 3:4。换封面会删掉旧的。</p>
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13.5px] md:grid-cols-3">
            <Fact label="平台" value={platformLabel(drama.platform)} />
            <Fact label="语言" value={`${languageName(drama.language, "zh")}（${drama.language}）`} />
            <Fact label="集数" value={drama.episodes === null ? "未知" : `${drama.episodes} 集`} />
            <Fact label="收费起始" value={drama.payStart === null ? "未知" : `第 ${drama.payStart} 集`} />
            <Fact label="完结" value={drama.finished === null ? "未知" : drama.finished ? "已完结" : "连载中"} />
            <Fact
              label="来源"
              value={
                drama.source !== "beidou" ? (
                  "手填"
                ) : sourcePage !== null ? (
                  <>
                    查剧 ·{" "}
                    <a href={sourcePage} target="_blank" rel="noopener noreferrer" className="text-brand-accent-text hover:underline">
                      {platformLabel(drama.platform)} 官网页面 ↗
                    </a>
                  </>
                ) : (
                  `选剧台（${drama.sourceDramaId}）`
                )
              }
            />
          </dl>
          {drama.titleCn !== null && drama.titleCn !== drama.title && (
            <p className="text-[13.5px] text-text-dark-secondary">原名：{drama.title}</p>
          )}
          {drama.tags.length > 0 && <TagList tags={drama.tags} />}
          <p className="whitespace-pre-line text-[14px] leading-[1.65] text-text-dark-primary">
            {drama.synopsis ?? <span className="text-text-dark-secondary">没有简介。</span>}
          </p>
          {LOOKUP_PLATFORMS.some((known) => known === drama.platform) && (
            <RefillControl
              dramaId={drama.id}
              platform={platformLabel(drama.platform)}
              fromTheater={THEATER_PLATFORMS.has(drama.platform)}
            />
          )}
        </div>
      </div>

      {/* Hidden for now: promoters land on our drama page either way. The link can still be
          set in 修改剧集信息 below; flip SHOW_PROMO_LINK to bring the panel back. */}
      {SHOW_PROMO_LINK && (
        <div className={PANEL}>
          <h2 className={H2}>平台链接</h2>
          <p className="mt-1 text-[13.5px] leading-[1.6] text-text-dark-secondary">
            推广者拿到的是我们的链接（/t/推广码），点击记在他名下，然后打开我们站上这部剧的页面（封面、简介、预告片，按上传的素材自动生成）。这里填平台给的原始链接后，剧页面才有「去看全集」按钮，跳过去时带上推广码；不填也能上架。
          </p>
          <div className="mt-4">
            <PromoLinkForm dramaId={drama.id} initial={values} />
          </div>
        </div>
      )}

      <div className={PANEL}>
        <h2 className={H2}>推广素材</h2>
        <p className="mt-1 text-[13.5px] text-text-dark-secondary">
          剪好的视频（MP4、MOV、WebM，单个不超过 4 GB）或图片。浏览器直接传到 R2，传完核对过大小才对推广者显示。同一部剧的素材在任务中心合成一张卡片，弹窗里按下面的编号列成系列资源 1、2、3。
        </p>
        <div className="mt-4">
          <UploadControl dramaId={drama.id} purpose="asset" storageReady={r2 !== null} />
        </div>
        {assets.length > 0 && (
          <ul className="mt-6 divide-y divide-brand-border-card rounded-[8px] border border-brand-border-card">
            {assets.map((asset) => (
              <li key={asset.id} className="flex flex-wrap items-center gap-4 px-4 py-3 text-[13.5px]">
                {/* The number 系列资源 gives it on /tasks: only ready clips count. */}
                <span className="w-6 shrink-0 text-right font-mono text-text-dark-secondary">
                  {asset.status === "ready" ? (readyNumber.get(asset.id) ?? "") : "–"}
                </span>
                <AssetTitle assetId={asset.id} title={asset.title} />
                <span className="text-text-dark-secondary">{asset.kind === "video" ? "视频" : "图片"}</span>
                <ClipTypeSelect assetId={asset.id} clipType={asset.clipType} />
                <span className="font-mono text-text-dark-secondary">{formatBytes(asset.byteSize)}</span>
                <span className={asset.status === "ready" ? "text-brand-accent-text" : "text-brand-error"}>
                  {asset.status === "ready" ? "可用" : "未传完"}
                </span>
                {r2 !== null && asset.status === "ready" && (
                  <a
                    href={`/api/admin/tasks/assets/${asset.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-accent-text hover:underline"
                  >
                    预览
                  </a>
                )}
                <DeleteAssetButton assetId={asset.id} title={asset.title} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 上架 sits under the clips, on the right: upload first, then publish. */}
      <div className="flex justify-end">
        <StatusControl dramaId={drama.id} status={drama.status} />
      </div>

      <details className={PANEL}>
        <summary className="cursor-pointer text-[15px] font-medium text-text-dark-primary">修改剧集信息（剧名、集数、简介、标签等）</summary>
        <div className="mt-5">
          {/* Remounted on any write (从官网补全 included): its fields are uncontrolled, and a stale
              select would write the old value back on the next save. */}
          <DramaForm key={drama.updatedAt} dramaId={drama.id} adminBase={base} initial={values} />
        </div>
      </details>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-text-dark-secondary">{label}</dt>
      <dd className="mt-0.5 truncate text-text-dark-primary">{value}</dd>
    </div>
  );
}

const SHOW_PROMO_LINK = false;
const H2 = "text-[18px] font-semibold text-text-dark-primary";
const PANEL = "rounded-card border border-brand-border-card bg-brand-panel p-6";
