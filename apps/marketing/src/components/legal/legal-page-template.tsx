// @input  — @/types/legal (LegalDocumentVersion), VisibleBreadcrumb
// @output — LegalPageTemplate 法务页面共用模板组件
// @pos    — 法务组件层，被 4 个法务页面共用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import type { LegalDocumentVersion } from "@/types";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { marked } from "marked";

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
    <div className="bg-brand-bg min-h-screen py-16 md:py-24">
      <div className="max-w-3xl mx-auto px-4">
        <VisibleBreadcrumb
          items={[
            { label: locale === "en" ? "Home" : "首页", href: `/${locale}` },
            { label: breadcrumbLabel },
          ]}
        />

        {/* Header */}
        <header className="mb-12">
          <h1 className="text-text-dark-primary font-semibold mb-4">{title}</h1>
          <p className="text-text-dark-secondary text-sm">
            {locale === "zh" ? "生效日期" : "Effective date"}: {formattedDate}
            <span className="mx-2">|</span>
            {locale === "zh" ? "版本" : "Version"}: {version}
          </p>
        </header>

        {/* Content */}
        <div
          className={[
            "prose prose-invert max-w-none",
            /* Headings */
            "[&_h2]:text-text-dark-primary [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:border-b [&_h2]:border-brand-border/40 [&_h2]:pb-3",
            "[&_h3]:text-text-dark-primary [&_h3]:text-lg [&_h3]:font-medium [&_h3]:mt-6 [&_h3]:mb-3",
            /* Body text */
            "[&_p]:text-text-dark-secondary [&_p]:leading-7 [&_p]:mb-4",
            /* Lists */
            "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-4 [&_ul]:space-y-2",
            "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-4 [&_ol]:space-y-2",
            "[&_li]:text-text-dark-secondary [&_li]:leading-7",
            "[&_li_strong]:text-text-dark-primary",
            /* Links */
            "[&_a]:text-brand-accent-text [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-brand-accent-hover",
            /* Code */
            "[&_code]:bg-brand-bg-alt [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm [&_code]:text-text-dark-primary",
            /* Tables */
            "[&_table]:w-full [&_table]:my-6 [&_table]:text-sm [&_table]:border-collapse",
            "[&_thead]:border-b [&_thead]:border-brand-border",
            "[&_th]:text-left [&_th]:text-text-dark-secondary [&_th]:font-medium [&_th]:py-3 [&_th]:px-4",
            "[&_td]:text-text-dark-secondary [&_td]:py-3 [&_td]:px-4 [&_td]:border-b [&_td]:border-brand-border/30",
            "[&_tr:hover_td]:bg-brand-bg-alt/30",
          ].join(" ")}
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />

        {/* Version History */}
        {versions.length > 0 && (
          <section className="mt-16 border-t border-brand-border pt-8">
            <h2 className="text-text-dark-primary font-semibold text-lg mb-4">
              {locale === "zh" ? "版本历史" : "Version History"}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-brand-border">
                    <th className="text-left text-text-dark-secondary py-2 pr-4 font-medium">
                      {locale === "zh" ? "版本" : "Version"}
                    </th>
                    <th className="text-left text-text-dark-secondary py-2 pr-4 font-medium">
                      {locale === "zh" ? "生效日期" : "Effective Date"}
                    </th>
                    <th className="text-left text-text-dark-secondary py-2 font-medium">
                      {locale === "zh" ? "变更摘要" : "Changes"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id} className="border-b border-brand-border/50">
                      <td className="text-text-dark-primary py-3 pr-4">
                        {v.version}
                      </td>
                      <td className="text-text-dark-secondary py-3 pr-4">
                        {new Date(v.effective_date).toLocaleDateString(
                          locale === "zh" ? "zh-CN" : "en-US",
                          {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          },
                        )}
                      </td>
                      <td className="text-text-dark-secondary py-3">
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
