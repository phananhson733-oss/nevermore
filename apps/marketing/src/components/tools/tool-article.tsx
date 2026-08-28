// @input  -- locale and one ToolArticle object
// @output -- the long-form sections rendered between "what you get" and the FAQ
// @pos    -- shared presentation for connected-tool explainers; no copy lives here
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
// Relative, not `@/`: the shared Vitest config maps `@/` to apps/web only, so
// an aliased import would make this file unimportable from a test.
import { localePath } from "../../lib/locale-path";
import type { ToolArticle, ToolArticleTable } from "./tool-article-shape";

const H2 =
  "max-w-2xl text-[27px] font-semibold tracking-[-0.03em] text-text-dark-primary";
/** Navigation-type links go cyan; the accent green stays reserved for actions. */
const NAV_LINK =
  "text-[14.5px] font-medium text-brand-accent-2 transition-colors hover:text-brand-info";
const LABEL =
  "font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase";

function ExampleTable({ table }: { readonly table: ToolArticleTable }) {
  return (
    <div className="mt-8">
      <p className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
        {table.label}
      </p>
      <div className="rounded-card border-brand-border-card mt-3 overflow-x-auto border">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-brand-border-card bg-brand-panel">
              {table.columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="px-4 py-2.5 font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((cells) => (
              <tr
                key={cells[0]}
                className="border-b border-brand-border-card/60 last:border-b-0"
              >
                {cells.map((cell, index) => (
                  <td
                    key={`${cells[0] ?? ""}-${String(index)}`}
                    className={`px-4 py-3 align-top text-[12.5px] leading-[1.55] ${
                      index === 0
                        ? "text-text-dark-primary"
                        : "text-text-dark-secondary"
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ToolArticleSections({
  locale,
  article,
}: {
  readonly locale: string;
  readonly article: ToolArticle;
}) {
  return (
    <>
      <section className="py-16 md:py-22">
        <h2 className={H2}>{article.exampleHeading}</h2>
        {/*
         * 1px gap over the divider colour — the example reads as a record.
         * 奇数条目进两列会余一格；底色即分隔线颜色，空格子会显示成一块更亮的实心
         * 矩形，所以末格跨满剩余列宽。
         */}
        <dl className="rounded-card border-brand-border-card bg-brand-border-card mt-8 grid gap-px overflow-hidden border md:grid-cols-2 md:[&>*:last-child]:col-span-2">
          {article.example.map((item) => (
            <div key={item.heading} className="bg-brand-panel-sunken p-[22px]">
              <dt className={LABEL}>{item.heading}</dt>
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
          <h2 className={H2}>{section.heading}</h2>
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

          {section.table ? <ExampleTable table={section.table} /> : null}
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
