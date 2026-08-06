// @input  -- locale
// @output -- the long-form sections rendered between "what you get" and the FAQ
// @pos    -- presentation for seo-quick-wins-article-content; no copy lives here
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
import { localePath } from "@/lib/locale-path";
import { getQuickWinsArticle } from "./seo-quick-wins-article-content";

/** Navigation-type links go cyan; the accent green stays reserved for actions. */
const NAV_LINK =
  "text-[14.5px] font-medium text-brand-accent-2 transition-colors hover:text-brand-info";

export function SeoQuickWinsArticle({
  locale,
  draftsEnabled,
}: {
  readonly locale: string;
  /** False strips the paragraphs that describe a capability this deployment lacks. */
  readonly draftsEnabled: boolean;
}) {
  const article = getQuickWinsArticle(locale, { draftsEnabled });

  return (
    <>
      <section className="py-16 md:py-22">
        <h2 className="max-w-2xl text-[27px] font-semibold tracking-[-0.03em] text-text-dark-primary">
          {article.exampleHeading}
        </h2>
        {/*
         * 1px gap over the divider colour — the example reads as a record.
         * 奇数条目进两列会余一格；底色即分隔线颜色，空格子会显示成一块更亮的实心
         * 矩形，所以末格跨满剩余列宽。
         */}
        <dl className="mt-8 grid gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card md:grid-cols-2 md:[&>*:last-child]:col-span-2">
          {article.example.map((item) => (
            <div key={item.heading} className="bg-brand-panel-sunken p-[22px]">
              <dt className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {item.heading}
              </dt>
              <dd className="mt-3 text-[13.5px] leading-[1.65] text-text-dark-secondary">
                {item.body}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {article.sections.map((section) => (
        <section
          key={section.heading}
          className="border-t border-brand-border py-16 md:py-22"
        >
          <h2 className="max-w-2xl text-[27px] font-semibold tracking-[-0.03em] text-text-dark-primary">
            {section.heading}
          </h2>
          {section.intro ? (
            <p className="mt-4 max-w-2xl text-[15.5px] leading-[1.65] text-text-dark-secondary">
              {section.intro}
            </p>
          ) : null}

          {section.paragraphs ? (
            <div className="mt-6 max-w-2xl space-y-4">
              {section.paragraphs.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 32)}
                  className="text-[15.5px] leading-[1.65] text-text-dark-strong"
                >
                  {paragraph}
                </p>
              ))}
            </div>
          ) : null}

          {section.items ? (
            <div className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-2">
              {section.items.map((item) => (
                <article key={item.heading}>
                  <h3 className="text-[16.5px] leading-snug font-semibold text-text-dark-primary">
                    {item.heading}
                  </h3>
                  <p className="mt-2 text-[13.5px] leading-[1.65] text-text-dark-secondary">
                    {item.body}
                  </p>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ))}

      <section className="grid gap-10 border-t border-brand-border py-16 md:grid-cols-2 md:py-22">
        <div>
          <h2 className="text-[21px] font-semibold tracking-[-0.03em] text-text-dark-primary">
            {article.relatedToolsHeading}
          </h2>
          <ul className="mt-5 space-y-4">
            {article.relatedTools.map((link) => (
              <li key={link.href}>
                <Link href={localePath(locale, link.href)} className={NAV_LINK}>
                  {link.label}
                </Link>
                <p className="mt-1.5 text-[13px] leading-[1.6] text-text-dark-secondary">
                  {link.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-[21px] font-semibold tracking-[-0.03em] text-text-dark-primary">
            {article.relatedReadingHeading}
          </h2>
          <ul className="mt-5 space-y-4">
            {article.relatedReading.map((link) => (
              <li key={link.href}>
                <Link href={localePath(locale, link.href)} className={NAV_LINK}>
                  {link.label}
                </Link>
                <p className="mt-1.5 text-[13px] leading-[1.6] text-text-dark-secondary">
                  {link.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
