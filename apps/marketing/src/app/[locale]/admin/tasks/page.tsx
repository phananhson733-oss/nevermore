// @input  -- locale param; the admin check; every drama in the task database
// @output -- links to 账号报白 and 结算导入, the admin drama list with status and promoter counts, and 查剧 to list a new drama by title and platform
// @pos    -- /admin/tasks, the operators' entry page (Chinese only); 404 for anyone not on TASK_ADMIN_EMAILS
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
import { notFound } from "next/navigation";

import { DramaQuickCreate } from "@/components/task-center/admin/drama-quick-create";
import { checkTaskAdmin } from "@/lib/task-center/admin";
import { DRAMA_STATUS_LABELS, platformLabel } from "@/lib/task-center/copy";
import { getTaskDb } from "@/lib/task-center/db";
import { listAllDramas, type DramaDetail } from "@/lib/task-center/dramas-store";
import { readR2Config } from "@/lib/task-center/r2";
import { localePath } from "@/lib/locale-path";

export const dynamic = "force-dynamic";

export default async function AdminTasksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const admin = await checkTaskAdmin();
  if (admin.status !== "admin") notFound();
  const base = localePath(locale, "/admin/tasks");

  const db = getTaskDb();
  let dramas: readonly DramaDetail[] | null = null;
  if (db !== null) {
    dramas = await listAllDramas(db).catch((error: unknown) => {
      console.error("[admin tasks] list failed", error);
      return null;
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-page-title text-text-dark-primary">任务后台</h1>
          <p className="mt-2 text-[14px] text-text-dark-secondary">登录身份：{admin.email}</p>
        </div>
        <div className="flex gap-5">
          <Link href={`${base}/accounts`} className="text-[14px] text-brand-accent-text hover:underline">
            账号报白 →
          </Link>
          <Link href={`${base}/earnings`} className="text-[14px] text-brand-accent-text hover:underline">
            结算导入 →
          </Link>
        </div>
      </div>

      {db === null && <p className={NOTE}>没有配置 TASKS_DATABASE_URL，任务数据库不可用。</p>}
      {readR2Config() === null && (
        <p className={NOTE}>R2 还没配置（R2_ACCOUNT_ID、R2_BUCKET、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY），封面和素材暂时不能上传，前台也不显示。</p>
      )}

      <div className={PANEL}>
        <h2 className={H2}>新建短剧</h2>
        <p className="mt-1 text-[13.5px] text-text-dark-secondary">
          填剧名和平台，选剧台找到这部剧后，集数、收费集、简介、标签和封面自动带出：ReelShort 的按它官网的原样（标签照官网语言，频道和题材也一并带出），其他平台先用选剧台的资料。建好是草稿，上传剪好的素材、填好推广目标地址再上架。
        </p>
        <div className="mt-5">
          <DramaQuickCreate adminBase={base} />
        </div>
      </div>

      <div>
        <h2 className={H2}>全部短剧</h2>
        {dramas === null ? (
          <p className={`mt-4 ${NOTE}`}>读取失败，任务数据库暂时不可用。</p>
        ) : dramas.length === 0 ? (
          <p className={`mt-4 ${NOTE}`}>还没有短剧。</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-card border border-brand-border-card">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-brand-panel text-[12.5px] text-text-dark-secondary">
                <tr>
                  <th className={TH}>剧名</th>
                  <th className={TH}>平台</th>
                  <th className={TH}>语言</th>
                  <th className={TH}>状态</th>
                  <th className={TH}>推广人数</th>
                  <th className={TH}>最后修改</th>
                </tr>
              </thead>
              <tbody>
                {dramas.map((drama) => (
                  <tr key={drama.id} className="border-t border-brand-border-card text-text-dark-primary">
                    <td className={TD}>
                      <Link href={`${base}/${drama.id}`} className="text-brand-accent-text hover:underline">
                        {drama.titleCn ?? drama.title}
                      </Link>
                    </td>
                    <td className={TD}>{platformLabel(drama.platform)}</td>
                    <td className={TD}>{drama.language}</td>
                    <td className={TD}>{DRAMA_STATUS_LABELS[drama.status]}</td>
                    <td className={TD}>{drama.promoterCount}</td>
                    <td className={TD}>{drama.updatedAt.slice(0, 16).replace("T", " ")} UTC</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const H2 = "text-[18px] font-semibold text-text-dark-primary";
const TH = "px-4 py-3 font-medium whitespace-nowrap";
const TD = "px-4 py-3 whitespace-nowrap";
const PANEL = "rounded-card border border-brand-border-card bg-brand-panel p-6";
const NOTE =
  "rounded-card border border-brand-border-card bg-brand-panel p-5 text-[14px] leading-[1.6] text-text-dark-secondary";
