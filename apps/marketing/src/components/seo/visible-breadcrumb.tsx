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
    <nav
      aria-label="Breadcrumb"
      className="text-text-dark-secondary text-[13px] mb-8"
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <span key={item.label}>
            {idx > 0 && (
              <span data-breadcrumb-separator="" className="mx-2 opacity-40">
                /
              </span>
            )}
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="hover:text-text-dark-primary transition-colors"
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
