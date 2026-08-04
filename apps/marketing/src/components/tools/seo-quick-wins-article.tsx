// @input  -- locale
// @output -- the long-form sections rendered between "what you get" and the FAQ
// @pos    -- presentation for seo-quick-wins-article-content; no copy lives here
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
import { localePath } from "@/lib/locale-path";
import { getQuickWinsArticle } from "./seo-quick-wins-article-content";

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
      <section className="py-14 md:py-20">
        <h2 className="max-w-2xl text-[30px] font-semibold tracking-[-0.04em] text-text-dark-primary">
          {article.exampleHeading}
        </h2>
        <dl className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-brand-border/70 bg-brand-border/40 md:grid-cols-2">
          {article.example.map((item) => (
            <div key={item.heading} className="bg-brand-bg-alt/35 p-5">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-accent-text">
                {item.heading}
              </dt>
              <dd className="mt-3 text-[14px] leading-relaxed text-text-dark-secondary">
                {item.body}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {article.sections.map((section) => (
        <section
          key={section.heading}
          className="border-t border-brand-border/60 py-14 md:py-20"
        >
          <h2 className="max-w-2xl text-[30px] font-semibold tracking-[-0.04em] text-text-dark-primary">
            {section.heading}
          </h2>
          {section.intro ? (
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-text-dark-secondary">
              {section.intro}
            </p>
          ) : null}

          {section.paragraphs ? (
            <div className="mt-6 max-w-2xl space-y-4">
              {section.paragraphs.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 32)}
                  className="text-[15px] leading-relaxed text-text-dark-secondary"
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
                  <h3 className="text-[16px] font-semibold leading-snug text-text-dark-primary">
                    {item.heading}
                  </h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-text-dark-secondary">
                    {item.body}
                  </p>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ))}

      <section className="grid gap-10 border-t border-brand-border/60 py-14 md:grid-cols-2 md:py-20">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.03em] text-text-dark-primary">
            {article.relatedToolsHeading}
          </h2>
          <ul className="mt-5 space-y-4">
            {article.relatedTools.map((link) => (
              <li key={link.href}>
                <Link
                  href={localePath(locale, link.href)}
                  className="text-[15px] font-semibold text-brand-accent-text hover:underline"
                >
                  {link.label}
                </Link>
                <p className="mt-1 text-[13px] leading-relaxed text-text-dark-secondary">
                  {link.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.03em] text-text-dark-primary">
            {article.relatedReadingHeading}
          </h2>
          <ul className="mt-5 space-y-4">
            {article.relatedReading.map((link) => (
              <li key={link.href}>
                <Link
                  href={localePath(locale, link.href)}
                  className="text-[15px] font-semibold text-brand-accent-text hover:underline"
                >
                  {link.label}
                </Link>
                <p className="mt-1 text-[13px] leading-relaxed text-text-dark-secondary">
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
