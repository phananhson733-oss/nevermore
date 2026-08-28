// @input  -- siteConfig
// @output -- OrganizationJsonLd 组件 (Organization + WebSite 结构化数据)
// @pos    -- json-ld 目录成员，首页使用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { siteConfig } from "@/config/site";

import { safeJsonLd } from "./utils";

export function OrganizationJsonLd() {
  const orgLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteConfig.name,
    url: siteConfig.url,
    logo: `${siteConfig.url}/images/logo.png`,
    contactPoint: {
      "@type": "ContactPoint",
      email: siteConfig.contactEmail,
      contactType: "customer service",
    },
    sameAs: [siteConfig.social.x],
  };

  const websiteLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.name,
    url: siteConfig.url,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(orgLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(websiteLd) }}
      />
    </>
  );
}
