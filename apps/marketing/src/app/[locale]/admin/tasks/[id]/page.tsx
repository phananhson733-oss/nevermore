// @input  -- locale and drama id params; the admin check; the drama and all its assets; R2 for the cover
// @output -- the admin edit page: details form, publish switch with a note on what a draft hides, cover upload, clip upload, rename, retag and delete
// @pos    -- /admin/tasks/<id> (Chinese only); 404 for anyone not on TASK_ADMIN_EMAILS
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AssetTitle,
  ClipTypeSelect,
  DeleteAssetButton,
  StatusControl,
  UploadControl,
} from "@/components/task-center/admin/drama-admin-controls";
import { DramaForm } from "@/components/task-center/admin/drama-form";
import { checkTaskAdmin } from "@/lib/task-center/admin";
import { isUuid } from "@/lib/task-center/contracts";
import { DRAMA_STATUS_LABELS } from "@/lib/task-center/copy";
import { getTaskDb } from "@/lib/task-center/db";
import { getDramaForAdmin } from "@/lib/task-center/dramas-store";
import { coverImageUrl, readR2Config } from "@/lib/task-center/r2";
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
  const r2 = readR2Config();

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
          </p>
        </div>
        <StatusControl dramaId={drama.id} status={drama.status} />
      </div>
      {drama.status !== "published" && (
        <p className="rounded-[8px] border border-brand-border-card bg-brand-panel-raised px-4 py-3 text-[13.5px] leading-[1.6] text-text-dark-secondary">
          {drama.status === "draft" ? "草稿" : "已下架"}：推广者在任务中心看不到这部剧，也看不到它的素材，没法下载。
          {drama.promoTargetUrl === null ? "先在下面填好推广目标地址，再点「上架」。" : "点「上架」后才对推广者显示。"}
        </p>
      )}

      <div className={PANEL}>
        <h2 className={H2}>基本信息</h2>
        <div className="mt-5">
          <DramaForm
            dramaId={drama.id}
            adminBase={base}
            initial={{
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
            }}
          />
        </div>
      </div>

      <div className={PANEL}>
        <h2 className={H2}>封面</h2>
        <div className="mt-4 flex flex-wrap items-start gap-6">
          <div className="aspect-[3/4] w-32 overflow-hidden rounded-[8px] border border-brand-border-card bg-brand-panel-raised">
            {r2 !== null && drama.coverKey !== null && (
              <img src={coverImageUrl(r2, drama.coverKey)} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-3 text-[13.5px] text-text-dark-secondary">JPG、PNG 或 WebP，不超过 20 MB，建议竖版 3:4。换封面会删掉旧的。</p>
            <UploadControl dramaId={drama.id} purpose="cover" storageReady={r2 !== null} />
          </div>
        </div>
      </div>

      <div className={PANEL}>
        <h2 className={H2}>推广素材</h2>
        <p className="mt-1 text-[13.5px] text-text-dark-secondary">
          剪好的视频（MP4、MOV、WebM，单个不超过 4 GB）或图片。浏览器直接传到 R2，传完核对过大小才对推广者显示。
        </p>
        <div className="mt-4">
          <UploadControl dramaId={drama.id} purpose="asset" storageReady={r2 !== null} />
        </div>
        {assets.length > 0 && (
          <ul className="mt-6 divide-y divide-brand-border-card rounded-[8px] border border-brand-border-card">
            {assets.map((asset) => (
              <li key={asset.id} className="flex flex-wrap items-center gap-4 px-4 py-3 text-[13.5px]">
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
    </div>
  );
}

const H2 = "text-[18px] font-semibold text-text-dark-primary";
const PANEL = "rounded-card border border-brand-border-card bg-brand-panel p-6";
