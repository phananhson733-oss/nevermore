// @input  -- 相关条目（标题 + 一句话 + 目标路径）与区块标题
// @output -- 富锚文本的相关资源列表
// @pos    -- 详情页内链网；锚文本带上目标页的说明，而不是裸标题
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";

export interface RelatedResourceItem {
  readonly slug: string;
  readonly href: string;
  readonly title: string;
  readonly description: string;
}

interface RelatedResourcesProps {
  readonly items: readonly RelatedResourceItem[];
  readonly title: string;
}

export function RelatedResources({ items, title }: RelatedResourcesProps) {
  if (items.length === 0) return null;

  return (
    <section className="min-w-0">
      <h2 className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
        {title}
      </h2>
      <ul className="mt-4 border-t border-brand-border">
        {items.map((item) => (
          <li key={item.slug} className="border-b border-brand-border">
            {/*
             * The description sits inside the anchor on purpose: a link whose
             * text is only a title tells a reader — and a crawler — nothing
             * about what is on the other side of it.
             */}
            <Link
              href={item.href}
              className="group block py-3.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
            >
              <span className="block text-[13.5px] leading-[1.45] font-semibold text-text-dark-primary transition-colors group-hover:text-brand-accent-text">
                {item.title}
              </span>
              <span className="mt-1 block text-[12.5px] leading-[1.6] text-text-dark-secondary">
                {item.description}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
