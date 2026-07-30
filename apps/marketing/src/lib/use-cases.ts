// @input  -- none (static data)
// @output -- UseCase type, getUseCases(), getUseCaseBySlug(), getUseCaseContent()
// @pos    -- data layer for use-cases pages, static content by locale (no i18n), 4 entries
// once this file is updated, update header comments and _DIR.md in this folder

export interface UseCaseContent {
  readonly title: string;
  readonly description: string;
  readonly challenge: string;
  readonly solution: string;
  readonly steps: readonly string[];
  readonly results: string;
}

export interface UseCase {
  readonly slug: string;
  readonly category: string;
  readonly content: Readonly<Record<string, UseCaseContent>>;
}

const USE_CASES: readonly UseCase[] = [
  {
    slug: "saas-zero-to-1000",
    category: "saas",
    content: {
      en: {
        title: "SaaS Product: From 0 to 1,000 Users",
        description: "How early-stage SaaS founders use GenGrowth to systematically acquire their first 1,000 users.",
        challenge: "You have built a great SaaS product but growth is slow. You are trying everything -- blog posts, social media, cold outreach -- but nothing compounds. Your small team spends 20+ hours per week on manual growth tasks with no clear attribution.",
        solution: "GenGrowth automates the entire growth loop for your SaaS: discovers untapped keyword opportunities, generates evidence-based strategies, executes SEO and social campaigns in parallel, and attributes every result to its source.",
        steps: [
          "Enter your product URL and target regions",
          "GenGrowth scans your site and identifies growth opportunities",
          "Review and approve AI-generated strategies ranked by expected ROI",
          "Watch automated execution across SEO, social, and outreach channels",
        ],
        results: "Early-stage SaaS teams using GenGrowth typically see 3-5x faster time to first 1,000 users compared to manual growth, with 70% less time spent on repetitive tasks.",
      },
      zh: {
        title: "SaaS 产品：从 0 到 1000 用户",
        description: "早期 SaaS 创始人如何使用 GenGrowth 系统化获取前 1000 名用户。",
        challenge: "你已经打造了一个很好的 SaaS 产品，但增长缓慢。你什么都在尝试——博客、社交媒体、主动触达——但没有任何效果能持续积累。你的小团队每周花 20+ 小时做手动增长任务，而且归因不清。",
        solution: "GenGrowth 为你的 SaaS 自动化整个增长闭环：发现未开发的关键词机会、生成有证据支持的策略、并行执行 SEO 和社交媒体活动，并将每个结果归因到来源。",
        steps: [
          "输入你的产品 URL 和目标地区",
          "GenGrowth 扫描你的网站并识别增长机会",
          "审核并批准按预期 ROI 排序的 AI 生成策略",
          "观察 SEO、社交和外联渠道的自动执行",
        ],
        results: "使用 GenGrowth 的早期 SaaS 团队通常比手动增长快 3-5 倍达到前 1000 用户，重复性任务时间减少 70%。",
      },
    },
  },
  {
    slug: "content-site-seo-scale",
    category: "content",
    content: {
      en: {
        title: "Content Site: SEO Scale Growth",
        description: "How content-driven websites use GenGrowth to scale from hundreds to thousands of pages with systematic SEO.",
        challenge: "Your content site has good content but plateauing traffic. Manual keyword research, content planning, and SEO audits take too long. You know programmatic SEO could unlock massive growth, but you lack the engineering resources.",
        solution: "GenGrowth turns your content site into an SEO machine: auto-discovers keyword gaps and competitor positions, generates content strategies with evidence chains, and continuously optimizes based on actual ranking data.",
        steps: [
          "Connect your site URL and Google Search Console data",
          "GenGrowth maps your content gaps against competitor positions",
          "Approve prioritized content and SEO strategies",
          "Monitor automated execution and attribution-backed results",
        ],
        results: "Content sites using GenGrowth for SEO automation typically see 2-4x organic traffic growth within 3 months, with content production time reduced by 60%.",
      },
      zh: {
        title: "内容站：SEO 规模化增长",
        description: "内容驱动型网站如何使用 GenGrowth 通过系统化 SEO 从数百页扩展到数千页。",
        challenge: "你的内容站有好内容但流量见顶。手动关键词研究、内容规划和 SEO 审计太耗时。你知道程序化 SEO 能带来巨大增长，但缺少工程资源。",
        solution: "GenGrowth 把你的内容站变成 SEO 机器：自动发现关键词空白和竞品占位，生成带证据链的内容策略，并基于实际排名数据持续优化。",
        steps: [
          "连接你的网站 URL 和 Google Search Console 数据",
          "GenGrowth 对比竞品分析你的内容空白",
          "审批优先排序的内容和 SEO 策略",
          "监控自动执行和归因支持的结果",
        ],
        results: "使用 GenGrowth 进行 SEO 自动化的内容站通常在 3 个月内实现 2-4 倍自然流量增长，内容生产时间减少 60%。",
      },
    },
  },
  {
    slug: "ecommerce-product-seo",
    category: "ecommerce",
    content: {
      en: {
        title: "E-commerce: Product Page SEO + Social Traffic",
        description: "How e-commerce teams use GenGrowth to dominate product search rankings and attribute every sale to its growth channel.",
        challenge: "Product pages get lost in search, competitors dominate Google Shopping, social media efforts are disconnected from SEO, and there is no attribution between channels. You are spending on ads and social without knowing what actually drives purchases.",
        solution: "GenGrowth discovers product keyword gaps, optimizes product pages at scale, coordinates social media campaigns with SEO strategy, and attributes every sale to its growth channel — so you know exactly where to double down.",
        steps: [
          "Connect your store URL and product catalog",
          "GenGrowth analyzes product page SEO gaps and competitor positions",
          "Approve AI-generated product descriptions and meta tags optimized for search",
          "Monitor cross-channel attribution from SEO and social to purchase",
        ],
        results: "E-commerce teams see 40-80% improvement in product page organic visibility, with social-to-purchase attribution providing clear ROI on every campaign.",
      },
      zh: {
        title: "电商：产品页 SEO + 社交流量",
        description: "电商团队如何使用 GenGrowth 主导产品搜索排名，并将每笔销售归因到对应的增长渠道。",
        challenge: "产品页在搜索中被淹没，竞品主导 Google Shopping，社交媒体投入与 SEO 互相割裂，渠道之间缺乏归因。你在广告和社交上持续花钱，却不知道真正带来购买的是什么。",
        solution: "GenGrowth 发现产品关键词空白，批量优化产品页，将社交媒体活动与 SEO 策略协同推进，并将每笔销售归因到具体增长渠道——让你清晰知道该在哪里加大投入。",
        steps: [
          "连接你的店铺 URL 和产品目录",
          "GenGrowth 分析产品页 SEO 空白和竞品占位",
          "审批 AI 生成的、针对搜索优化的产品描述和 meta 标签",
          "监控从 SEO 和社交到购买的全渠道归因数据",
        ],
        results: "电商团队的产品页自然搜索曝光量提升 40-80%，社交到购买的归因数据为每次活动提供清晰的 ROI 依据。",
      },
    },
  },
  {
    slug: "devtool-community-growth",
    category: "devtool",
    content: {
      en: {
        title: "Developer Tool: Technical Content + Community-Driven Growth",
        description: "How developer tool teams use GenGrowth to generate technical content that engineers trust and attribute community activity to real signups.",
        challenge: "Developer tools need highly technical content that resonates with engineers, community building across GitHub, Reddit, and Hacker News is time-intensive, and it is hard to measure which content drives signups versus which just gets stars.",
        solution: "GenGrowth automates developer-focused growth: discovers technical keyword opportunities developers actually search for, generates documentation-quality content strategies, coordinates community engagement, and attributes developer signups to their discovery channel.",
        steps: [
          "Enter your tool's documentation URL and GitHub repo",
          "GenGrowth maps technical keyword gaps and developer community signals",
          "Approve content strategies targeting developer search intent",
          "Track community engagement to signup attribution across channels",
        ],
        results: "Developer tool teams using GenGrowth typically see 2-3x increase in documentation traffic and clear attribution from community activity to signups within 2 months.",
      },
      zh: {
        title: "开发者工具：技术内容 + 社区驱动增长",
        description: "开发者工具团队如何使用 GenGrowth 产出工程师信任的技术内容，并将社区活动归因到真实注册转化。",
        challenge: "开发者工具需要能与工程师产生共鸣的高技术含量内容，在 GitHub、Reddit 和 Hacker News 上经营社区耗时巨大，而且很难衡量哪些内容真正带来注册，哪些只是带来 Star。",
        solution: "GenGrowth 自动化开发者增长全流程：发现开发者真正搜索的技术关键词，生成文档级别的内容策略，协调社区互动，并将开发者注册归因到各自的发现渠道。",
        steps: [
          "输入你的工具文档 URL 和 GitHub 仓库地址",
          "GenGrowth 分析技术关键词空白和开发者社区信号",
          "审批面向开发者搜索意图的内容策略",
          "追踪从社区互动到注册的全渠道归因数据",
        ],
        results: "使用 GenGrowth 的开发者工具团队通常在 2 个月内实现文档流量 2-3 倍增长，并获得从社区活动到注册的清晰归因路径。",
      },
    },
  },
];

export function getUseCases(): UseCase[] {
  return [...USE_CASES];
}

export function getUseCaseBySlug(slug: string): UseCase | null {
  return USE_CASES.find((uc) => uc.slug === slug) ?? null;
}

export function getUseCaseContent(
  useCase: UseCase,
  locale: string,
): UseCaseContent {
  return useCase.content[locale] ?? useCase.content["en"];
}
