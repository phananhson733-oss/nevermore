// @input  — @/types/legal (LegalDocumentVersion), VisibleBreadcrumb
// @output — LegalPageTemplate 法务页面共用模板组件
// @pos    — 法务组件层，被 4 个法务页面共用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import type { LegalDocumentVersion } from "@/types";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { marked } from "marked";
import { localePath } from "@/lib/locale-path";

interface LegalPageTemplateProps {
  title: string;
  effectiveDate: string;
  version: string;
  content: string;
  versions: LegalDocumentVersion[];
  locale: string;
  breadcrumbLabel: string;
}

export function LegalPageTemplate({
  title,
  effectiveDate,
  version,
  content,
  versions,
  locale,
  breadcrumbLabel,
}: LegalPageTemplateProps) {
  const formattedDate = new Date(effectiveDate).toLocaleDateString(
    locale === "zh" ? "zh-CN" : "en-US",
    { year: "numeric", month: "long", day: "numeric" },
  );

  // Strip the leading markdown title + date/version lines (already shown in header)
  const stripped = content
    .replace(/^#\s+.+\n+/, "")
    .replace(/^\*\*.*?\*\*\n*/gm, (match) =>
      /生效日期|Effective Date|版本|Version/i.test(match) ? "" : match,
    )
    .replace(/^---\n*/m, "")
    .trim();

  const htmlContent = marked.parse(stripped, { async: false }) as string;

  return (
    /* 顶部间距只留 36px：PageShell 已经为 fixed 导航垫了 68px */
    <div className="bg-brand-bg min-h-screen pt-9 pb-24">
      <div className="mx-auto max-w-3xl px-6 md:px-8">
        <VisibleBreadcrumb
          items={[
            {
              label: locale === "en" ? "Home" : "首页",
              href: localePath(locale),
            },
            { label: breadcrumbLabel },
          ]}
        />

        {/* Header */}
        <header className="border-brand-border mb-12 border-b pt-7 pb-10">
          <h1 className="text-page-title text-text-dark-primary">{title}</h1>
          {/* 生效日期与版本号是元数据，走 mono 小标签而不是正文 */}
          <p className="text-text-dark-secondary mt-5 font-mono text-[10px] tracking-[0.12em] uppercase">
            {locale === "zh" ? "生效日期" : "Effective date"}:{" "}
            <span className="text-text-dark-secondary">{formattedDate}</span>
            <span className="mx-2.5 opacity-50">|</span>
            {locale === "zh" ? "版本" : "Version"}:{" "}
            <span className="text-text-dark-secondary">{version}</span>
          </p>
        </header>

        {/* Content —— 正文一律 sans，mono 只留给行内代码；标题靠字号+分隔线分层 */}
        <div
          className={[
            "max-w-none",
            /* Headings — 全局已给 h1/h2/h3 600 字重，这里只定字号与节奏；
               scroll-mt 给文档内锚点跳转留出 fixed 导航的高度 */
            "[&_h2]:text-text-dark-primary [&_h2]:mt-12 [&_h2]:mb-4 [&_h2]:scroll-mt-24 [&_h2]:text-[21px] [&_h2]:tracking-[-0.02em]",
            "[&_h2]:border-brand-border [&_h2]:border-b [&_h2]:pb-3",
            "[&_h3]:text-text-dark-primary [&_h3]:mt-8 [&_h3]:mb-2.5 [&_h3]:scroll-mt-24 [&_h3]:text-[16.5px]",
            "[&_h4]:text-text-dark-primary [&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-[14px] [&_h4]:font-semibold",
            /* Body text — 行高交给 globals.css 的 p 规则（en 1.65 / zh 1.75） */
            "[&_p]:text-text-dark-strong [&_p]:mb-4 [&_p]:text-[15px]",
            "[&_strong]:text-text-dark-primary [&_strong]:font-semibold",
            /* Lists — li 不是 p，行高要显式给到中文的 1.75 */
            "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5",
            "[&_ol]:my-4 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5",
            "[&_li]:text-text-dark-strong [&_li]:text-[15px] [&_li]:leading-[1.75]",
            "[&_li::marker]:text-text-dark-faint",
            /* Quotes + rules */
            "[&_blockquote]:border-brand-accent/60 [&_blockquote]:text-text-dark-secondary [&_blockquote]:my-6 [&_blockquote]:border-l-2 [&_blockquote]:pl-5",
            "[&_hr]:border-brand-border [&_hr]:my-10",
            /* Links */
            "[&_a]:text-brand-accent-text [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-brand-accent-hover",
            /* Code */
            "[&_code]:bg-brand-panel [&_code]:border-brand-border [&_code]:text-text-dark-primary [&_code]:rounded [&_code]:border [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12.5px]",
            /* Tables — 表头是标签走 mono，行分隔用最弱的一档描边 */
            "[&_table]:my-6 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[13px]",
            "[&_thead]:border-brand-border [&_thead]:border-b",
            "[&_th]:text-text-dark-secondary [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:font-mono [&_th]:text-[10px] [&_th]:font-normal [&_th]:tracking-[0.12em] [&_th]:uppercase",
            "[&_td]:text-text-dark-strong [&_td]:border-brand-border-faint [&_td]:border-b [&_td]:px-4 [&_td]:py-3",
          ].join(" ")}
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />

        {/* Version History */}
        {versions.length > 0 && (
          <section className="border-brand-border mt-16 border-t pt-10">
            <h2 className="text-text-dark-primary mb-5 text-[21px] tracking-[-0.02em]">
              {locale === "zh" ? "版本历史" : "Version History"}
            </h2>
            <div className="border-brand-border-card bg-brand-panel rounded-card overflow-x-auto border">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-brand-border border-b">
                    <th className="text-text-dark-secondary px-5 py-3 text-left font-mono text-[10px] font-normal tracking-[0.12em] uppercase">
                      {locale === "zh" ? "版本" : "Version"}
                    </th>
                    <th className="text-text-dark-secondary px-5 py-3 text-left font-mono text-[10px] font-normal tracking-[0.12em] uppercase">
                      {locale === "zh" ? "生效日期" : "Effective Date"}
                    </th>
                    <th className="text-text-dark-secondary px-5 py-3 text-left font-mono text-[10px] font-normal tracking-[0.12em] uppercase">
                      {locale === "zh" ? "变更摘要" : "Changes"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr
                      key={v.id}
                      className="border-brand-border-faint border-b last:border-b-0"
                    >
                      {/* 版本号与日期是数字/标识，走 mono */}
                      <td className="text-text-dark-primary px-5 py-3 font-mono text-[12px]">
                        {v.version}
                      </td>
                      <td className="text-text-dark-secondary px-5 py-3 font-mono text-[12px] whitespace-nowrap">
                        {new Date(v.effective_date).toLocaleDateString(
                          locale === "zh" ? "zh-CN" : "en-US",
                          {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          },
                        )}
                      </td>
                      <td className="text-text-dark-strong px-5 py-3 leading-[1.6]">
                        {v.change_summary}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
