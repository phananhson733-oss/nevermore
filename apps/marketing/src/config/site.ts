// @input  — 无
// @output — siteConfig 营销站点配置对象
// @pos    — 静态配置，供 Header/Footer/SEO 等消费
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
export const siteConfig = {
  name: "GenGrowth",
  url: "https://gengrowth.ai",
  contactEmail: "hello@gengrowth.ai",
  analytics: {
    ga4MeasurementId:
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "G-71TET2Y97Q",
  },
  social: {
    x: "https://x.com/gengrowth",
    linkedin: "https://linkedin.com/company/gengrowth",
  },
} as const;
