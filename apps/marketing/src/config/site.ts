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
  // LinkedIn 主页尚未开通，入口与 sameAs 声明一并移除：sameAs 指向不存在的
  // 主页等于给搜索引擎一条错误的实体声明。开通后再把 linkedin 加回来。
  social: {
    x: "https://x.com/GenGrowthAI",
  },
} as const;
