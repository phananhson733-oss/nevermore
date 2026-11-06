// @input  -- locale param; the admin check; every account promoters submitted for whitelisting
// @output -- the 账号报白 list (waiting first), each with the promoter's email, platform, handle, status and the 通过/拒绝 buttons
// @pos    -- /admin/tasks/accounts (Chinese only); 404 for anyone not on TASK_ADMIN_EMAILS
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
import { notFound } from "next/navigation";

import { AccountReviewButtons } from "@/components/task-center/admin/account-review-buttons";
import { listAccountsForReview, type ReviewAccount } from "@/lib/task-center/accounts-store";
import { checkTaskAdmin } from "@/lib/task-center/admin";
import { ACCOUNT_STATUS_LABELS, CHANNEL_LABELS, formatDay } from "@/lib/task-center/copy";
import { getTaskDb } from "@/lib/task-center/db";
import { localePath } from "@/lib/locale-path";

export const dynamic = "force-dynamic";

export default async function AdminAccountsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const admin = await checkTaskAdmin();
  if (admin.status !== "admin") notFound();
  const db = getTaskDb();
  let accounts: readonly ReviewAccount[] | null = null;
  if (db !== null) {
    accounts = await listAccountsForReview(db).catch((error: unknown) => {
      console.error("[admin tasks] account list failed", error);
      return null;
    });
  }
  const waiting = accounts?.filter((account) => account.status === "submitted").length ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <Link href={localePath(locale, "/admin/tasks")} className="text-[13.5px] text-brand-accent-text hover:underline">
        ← 任务后台
      </Link>
      <div>
        <h1 className="text-page-title text-text-dark-primary">账号报白</h1>
        <p className="mt-2 max-w-3xl text-[14px] leading-[1.7] text-text-dark-secondary">
          推广者在「我的推广」里提交的 TikTok、Facebook 账号。在平台上报白以后点「通过」，平台不收的点「拒绝」，推广者那边会看到状态。点错了可以再点另一个。
        </p>
      </div>

      {accounts === null ? (
        <p className={NOTE}>任务数据库暂时不可用。</p>
      ) : accounts.length === 0 ? (
        <p className={NOTE}>还没有人提交账号。</p>
      ) : (
        <>
          <p className="text-[14px] text-text-dark-secondary">待报白 {waiting} 个，共 {accounts.length} 个。</p>
          <div className="overflow-x-auto rounded-card border border-brand-border-card">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-brand-panel text-[12.5px] text-text-dark-secondary">
                <tr>
                  <th className={TH}>推广者</th>
                  <th className={TH}>平台</th>
                  <th className={TH}>账号</th>
                  <th className={TH}>提交时间</th>
                  <th className={TH}>状态</th>
                  <th className={TH}>处理</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className="border-t border-brand-border-card align-top text-text-dark-primary">
                    <td className={TD}>
                      {/* Null when the Google account gave no email; the id still tells promoters apart. */}
                      {account.userEmail ?? <span className="font-mono text-[12px] text-text-dark-secondary">{account.userId}</span>}
                    </td>
                    <td className={TD}>{CHANNEL_LABELS[account.platform]}</td>
                    <td className={`${TD} max-w-80 break-all whitespace-normal select-all`}>{account.handle}</td>
                    <td className={TD}>{formatDay(account.submittedAt, "zh")}</td>
                    <td className={TD}>
                      {ACCOUNT_STATUS_LABELS[account.status]}
                      {account.reviewedBy !== null && (
                        <span className="block text-[12px] text-text-dark-secondary">
                          {account.reviewedBy} · {formatDay(account.reviewedAt, "zh")}
                        </span>
                      )}
                    </td>
                    <td className={TD}>
                      <AccountReviewButtons accountId={account.id} status={account.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const TH = "px-4 py-3 font-medium whitespace-nowrap";
const TD = "px-4 py-3 whitespace-nowrap";
const NOTE =
  "rounded-card border border-brand-border-card bg-brand-panel p-6 text-[14px] leading-[1.6] text-text-dark-secondary";
