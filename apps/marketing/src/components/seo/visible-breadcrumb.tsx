// @input  — items: { label, href? }[]
// @output — VisibleBreadcrumb 可见面包屑导航（SPEC 8.1.5）
// @pos    — SEO 组件层，为子页面提供可见面包屑导航
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface VisibleBreadcrumbProps {
  items: BreadcrumbItem[];
}

export function VisibleBreadcrumb({ items }: VisibleBreadcrumbProps) {
  return (
    /* 面包屑属于「路径标签」而非正文，走 mono + 宽字距；分隔符退到 faint 层。 */
    <nav
      aria-label="Breadcrumb"
      className="mb-8 font-mono text-[12px] tracking-[0.06em] text-text-dark-secondary uppercase"
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <span key={item.label}>
            {idx > 0 && (
              <span
                data-breadcrumb-separator=""
                className="mx-2 text-text-dark-faint"
              >
                /
              </span>
            )}
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="transition-colors hover:text-text-dark-primary"
              >
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "text-text-dark-primary" : ""}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
