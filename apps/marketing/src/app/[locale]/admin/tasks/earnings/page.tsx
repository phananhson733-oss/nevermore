// @input  -- locale param; the admin check; the settlement import history
// @output -- the settlement import form, the CSV template it reads, and past imports
// @pos    -- /admin/tasks/earnings (Chinese only); 404 for anyone not on TASK_ADMIN_EMAILS
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
import { notFound } from "next/navigation";

import { SettlementImportForm } from "@/components/task-center/admin/settlement-import-form";
import { checkTaskAdmin } from "@/lib/task-center/admin";
import { getTaskDb } from "@/lib/task-center/db";
import { listEarningImports, type EarningImport } from "@/lib/task-center/earnings-store";
import { localePath } from "@/lib/locale-path";

export const dynamic = "force-dynamic";

export default async function AdminEarningsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const admin = await checkTaskAdmin();
  if (admin.status !== "admin") notFound();
  const db = getTaskDb();
  let imports: readonly EarningImport[] | null = null;
  if (db !== null) {
    imports = await listEarningImports(db).catch((error: unknown) => {
      console.error("[admin tasks] import history failed", error);
      return null;
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <Link href={localePath(locale, "/admin/tasks")} className="text-[13.5px] text-brand-accent-text hover:underline">
        ← 任务后台
      </Link>
      <h1 className="text-page-title text-text-dark-primary">结算导入</h1>

      <div className="rounded-card border border-brand-border-card bg-brand-panel p-6">
        <p className="text-[14px] leading-[1.7] text-text-dark-secondary">
          CSV，第一行是表头，之后每个推广码每天一行。日期和推广码必填，订单数、广告金额、收益至少有一列；空着的格子按「平台没给」处理，前台显示 —，不当成 0。金额按所选币种的常规小数位填（美元两位，日元不带小数）。整份文件全部通过才导入；同一推广码同一天再次导入会覆盖上一次。
        </p>
        <pre className="mt-4 overflow-x-auto rounded-[8px] bg-brand-bg p-4 font-mono text-[12.5px] text-text-dark-primary">
{`date,code,orders,ad_amount,income
2026-11-04,k7m2xq9p,12,30.50,8.25`}
        </pre>
        <p className="mt-2 text-[13px] text-text-dark-secondary">表头也可以写中文：日期、推广码、订单数、广告金额、收益。</p>
        <div className="mt-6">
          <SettlementImportForm />
        </div>
      </div>

      <div>
        <h2 className="text-[18px] font-semibold text-text-dark-primary">导入记录</h2>
        {imports === null ? (
          <p className="mt-4 text-[14px] text-text-dark-secondary">任务数据库暂时不可用。</p>
        ) : imports.length === 0 ? (
          <p className="mt-4 text-[14px] text-text-dark-secondary">还没有导入过。</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-card border border-brand-border-card">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-brand-panel text-[12.5px] text-text-dark-secondary">
                <tr>
                  <th className="px-4 py-3 font-medium">时间（UTC）</th>
                  <th className="px-4 py-3 font-medium">文件</th>
                  <th className="px-4 py-3 font-medium">币种</th>
                  <th className="px-4 py-3 font-medium">行数</th>
                  <th className="px-4 py-3 font-medium">导入人</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((item) => (
                  <tr key={item.id} className="border-t border-brand-border-card text-text-dark-primary">
                    <td className="px-4 py-3 whitespace-nowrap">{item.importedAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-4 py-3">{item.fileName}</td>
                    <td className="px-4 py-3 font-mono">{item.currency}</td>
                    <td className="px-4 py-3">{item.rowCount}</td>
                    <td className="px-4 py-3">{item.importedBy}</td>
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
