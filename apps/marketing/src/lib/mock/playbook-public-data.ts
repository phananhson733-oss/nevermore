// @input  -- none (static data)
// @output -- PublicPlaybook data, getPublicPlaybooks(), getPublicPlaybookBySlug(), filterPlaybooks()
// @pos    -- static data layer for /playbooks/* public SEO pages (Phase 3.2)
// once this file is updated, update header comments and _DIR.md in this folder

export interface PublicPlaybookStep {
  readonly order: number;
  readonly title: string;
  readonly description: string;
}

export interface PublicPlaybookContent {
  readonly title: string;
  readonly description: string;
  readonly applicableConditions: readonly string[];
  readonly steps: readonly PublicPlaybookStep[];
  readonly expectedResults: string;
}

export interface PublicPlaybook {
  readonly slug: string;
  readonly industry: "saas" | "content" | "ecommerce" | "devtool";
  readonly channel: "seo" | "social" | "link" | "email" | "community";
  readonly goal: "traffic" | "conversion" | "retention";
  readonly successRate: number;
  readonly stepCount: number;
  readonly content: Record<string, PublicPlaybookContent>;
}

const PUBLIC_PLAYBOOKS: readonly PublicPlaybook[] = [
  {
    slug: "seo-scale-up",
    industry: "saas",
    channel: "seo",
    goal: "traffic",
    successRate: 0.78,
    stepCount: 6,
    content: {
      en: {
        title: "SEO Scale-Up",
        description:
          "Scale organic traffic from 0 to 10K monthly visitors with a structured SEO foundation, keyword clustering, and content velocity system.",
        applicableConditions: [
          "Product has fewer than 500 monthly organic visitors",
          "Domain age is at least 6 months",
          "Team can publish at least 4 articles per month",
          "Target market uses search engines as a primary discovery channel",
        ],
        steps: [
          {
            order: 1,
            title: "Audit and baseline",
            description:
              "Run a full technical SEO audit. Record crawl errors, Core Web Vitals scores, and existing keyword rankings as your baseline.",
          },
          {
            order: 2,
            title: "Keyword cluster map",
            description:
              "Group 100-200 target keywords into topic clusters. Identify one pillar page per cluster and supporting long-tail targets.",
          },
          {
            order: 3,
            title: "Content calendar setup",
            description:
              "Build a 90-day content calendar covering pillar pages and cluster articles. Assign owners and set publish cadence.",
          },
          {
            order: 4,
            title: "On-page optimization pass",
            description:
              "Optimize title tags, meta descriptions, H1-H3 hierarchy, and internal linking for all existing pages.",
          },
          {
            order: 5,
            title: "Publish and index",
            description:
              "Publish cluster articles weekly. Submit sitemaps and request indexing via Search Console after each publish.",
          },
          {
            order: 6,
            title: "Measure and iterate",
            description:
              "Review ranking movements monthly. Refresh underperforming articles and expand high-ranking clusters.",
          },
        ],
        expectedResults:
          "Reach 10K monthly organic visitors within 6-9 months. Domain authority improvement of 10-15 points. Top-3 rankings on 20+ long-tail keywords.",
      },
      zh: {
        title: "SEO 流量放大",
        description:
          "通过系统化的 SEO 基础建设、关键词聚类和内容发布节奏，将自然流量从零增长至月均 1 万访客。",
        applicableConditions: [
          "产品每月自然访客少于 500",
          "域名注册时间至少 6 个月",
          "团队每月可发布至少 4 篇文章",
          "目标市场主要通过搜索引擎发现产品",
        ],
        steps: [
          {
            order: 1,
            title: "审计与基线建立",
            description:
              "执行完整的技术 SEO 审计，记录抓取错误、Core Web Vitals 分数和当前关键词排名作为基线。",
          },
          {
            order: 2,
            title: "关键词聚类地图",
            description:
              "将 100-200 个目标关键词分组为主题簇，每个簇确定一个支柱页面和若干长尾辅助关键词。",
          },
          {
            order: 3,
            title: "内容日历规划",
            description:
              "制定覆盖支柱页面和聚类文章的 90 天内容日历，分配责任人并确定发布节奏。",
          },
          {
            order: 4,
            title: "页面内容优化",
            description:
              "对所有现有页面优化标题标签、元描述、H1-H3 层级结构和内部链接。",
          },
          {
            order: 5,
            title: "发布与收录",
            description:
              "每周发布聚类文章，每次发布后提交站点地图并通过 Search Console 申请收录。",
          },
          {
            order: 6,
            title: "衡量与迭代",
            description:
              "每月审查排名变化，刷新表现不佳的文章，扩展排名靠前的关键词聚类。",
          },
        ],
        expectedResults:
          "6-9 个月内实现月均 1 万自然访客。域名权威度提升 10-15 分。20+ 个长尾关键词进入前三名。",
      },
    },
  },
  {
    slug: "social-first-probe",
    industry: "content",
    channel: "social",
    goal: "traffic",
    successRate: 0.65,
    stepCount: 5,
    content: {
      en: {
        title: "Social-First Topic Probe",
        description:
          "Validate content topics via social media engagement before committing SEO resources. Reduces wasted content investment by testing demand signals first.",
        applicableConditions: [
          "Content team produces 8+ pieces per month",
          "Brand has at least one active social media account with 500+ followers",
          "SEO content production cost exceeds $500 per article",
          "Team struggles to predict which topics will drive organic traffic",
        ],
        steps: [
          {
            order: 1,
            title: "Build a topic hypothesis list",
            description:
              "Brainstorm 20-30 content topics based on audience pain points, competitor analysis, and keyword research.",
          },
          {
            order: 2,
            title: "Create social probe posts",
            description:
              "For each topic, write a short social post (thread, carousel, or short video) presenting the core idea. Keep production cost minimal.",
          },
          {
            order: 3,
            title: "Publish and track engagement",
            description:
              "Post all probe content over two weeks. Track saves, shares, comments, and click-throughs as demand signals.",
          },
          {
            order: 4,
            title: "Score and prioritize",
            description:
              "Rank topics by engagement score (saves + shares weighted 2x). Select the top 5 topics for full SEO articles.",
          },
          {
            order: 5,
            title: "Convert winners to SEO content",
            description:
              "Expand the highest-scoring social posts into long-form SEO articles. Reuse validated angles and hooks from social.",
          },
        ],
        expectedResults:
          "35-50% higher organic click-through rates on validated topics versus unvalidated. Reduction of low-traffic articles by 40%.",
      },
      zh: {
        title: "社交优先选题验证",
        description:
          "在投入 SEO 资源之前，先通过社交媒体互动验证内容选题，用最低成本测试需求信号，减少内容浪费。",
        applicableConditions: [
          "内容团队每月产出 8 篇以上内容",
          "品牌至少有一个粉丝超 500 的活跃社交账号",
          "每篇 SEO 内容制作成本超过 500 元",
          "团队难以预判哪些选题能带来自然流量",
        ],
        steps: [
          {
            order: 1,
            title: "建立选题假设清单",
            description:
              "基于受众痛点、竞品分析和关键词研究，头脑风暴 20-30 个内容选题。",
          },
          {
            order: 2,
            title: "创建社交探针帖子",
            description:
              "为每个选题撰写简短的社交帖子（长推、轮播图或短视频），呈现核心观点，保持低制作成本。",
          },
          {
            order: 3,
            title: "发布并追踪互动数据",
            description:
              "在两周内发布所有探针内容，追踪收藏、转发、评论和点击率作为需求信号。",
          },
          {
            order: 4,
            title: "评分与优先级排序",
            description:
              "按互动得分（收藏 + 转发加权 2 倍）对选题排名，选取前 5 个选题制作完整 SEO 文章。",
          },
          {
            order: 5,
            title: "将赢家转化为 SEO 内容",
            description:
              "将得分最高的社交帖子扩展为长篇 SEO 文章，复用社交验证过的角度和钩子。",
          },
        ],
        expectedResults:
          "经过验证的选题自然点击率比未验证选题高 35-50%，低流量文章减少 40%。",
      },
    },
  },
  {
    slug: "link-building-starter",
    industry: "saas",
    channel: "link",
    goal: "traffic",
    successRate: 0.72,
    stepCount: 5,
    content: {
      en: {
        title: "Link Building Starter",
        description:
          "Build your first 50 quality backlinks to establish domain authority. Focused on resource pages, digital PR, and broken-link reclamation.",
        applicableConditions: [
          "Domain Rating (DR) is below 20",
          "Product has fewer than 30 referring domains",
          "Team can allocate 5+ hours per week to outreach",
          "Product solves a problem with a defined professional community",
        ],
        steps: [
          {
            order: 1,
            title: "Identify link targets",
            description:
              "Find 100 prospects: resource pages, industry roundups, broken links on competitor topics, and journalist contacts covering your niche.",
          },
          {
            order: 2,
            title: "Create linkable assets",
            description:
              "Produce 2-3 high-value linkable assets: a free tool, original data report, or definitive guide that provides standalone value.",
          },
          {
            order: 3,
            title: "Broken-link reclamation",
            description:
              "Scan competitor backlink profiles for broken links. Offer your content as a replacement to the linking site owner.",
          },
          {
            order: 4,
            title: "Personalized outreach",
            description:
              "Send personalized emails to resource page owners and journalists. Reference their specific content and explain why your asset adds value.",
          },
          {
            order: 5,
            title: "Track and follow up",
            description:
              "Log all outreach in a spreadsheet. Follow up once after 7 days. Record acquired links and analyze which asset types converted best.",
          },
        ],
        expectedResults:
          "50 quality backlinks within 90 days. DR increase of 8-12 points. 15-25% growth in organic traffic from improved authority.",
      },
      zh: {
        title: "外链建设入门",
        description:
          "通过资源页面、数字 PR 和失效链接回收，建立前 50 条高质量外链，奠定域名权威度基础。",
        applicableConditions: [
          "域名评级 (DR) 低于 20",
          "产品外链域名数少于 30 个",
          "团队每周可投入 5 小时以上进行外联工作",
          "产品解决的问题有明确的专业社群",
        ],
        steps: [
          {
            order: 1,
            title: "识别外链目标",
            description:
              "找出 100 个候选目标：资源页面、行业汇总文章、竞品话题的失效链接和覆盖你所在领域的记者联系方式。",
          },
          {
            order: 2,
            title: "创建可链接资产",
            description:
              "制作 2-3 个高价值可链接资产：免费工具、原创数据报告或权威指南，需具备独立使用价值。",
          },
          {
            order: 3,
            title: "失效链接回收",
            description:
              "扫描竞品外链档案中的失效链接，向链接来源站点所有者提供你的内容作为替代。",
          },
          {
            order: 4,
            title: "个性化外联邮件",
            description:
              "向资源页面所有者和记者发送个性化邮件，引用他们的具体内容，说明你的资产如何增加价值。",
          },
          {
            order: 5,
            title: "追踪与跟进",
            description:
              "在表格中记录所有外联情况，7 天后跟进一次，记录已获取链接并分析哪类资产转化率最高。",
          },
        ],
        expectedResults:
          "90 天内获得 50 条高质量外链。DR 提升 8-12 分。因权威度提升带动自然流量增长 15-25%。",
      },
    },
  },
  {
    slug: "product-page-optimization",
    industry: "ecommerce",
    channel: "seo",
    goal: "conversion",
    successRate: 0.85,
    stepCount: 5,
    content: {
      en: {
        title: "Product Page Optimization",
        description:
          "Optimize e-commerce product pages for both search discovery and on-page conversion. Addresses technical SEO, copy, and trust signals simultaneously.",
        applicableConditions: [
          "Product catalog has at least 20 pages",
          "Pages receive organic traffic but conversion rate is below 2%",
          "Product pages lack structured data markup",
          "Average session duration on product pages is under 60 seconds",
        ],
        steps: [
          {
            order: 1,
            title: "Structured data audit",
            description:
              "Add Product, Offer, and Review schema markup to all product pages. Test with Google Rich Results tool and fix validation errors.",
          },
          {
            order: 2,
            title: "Title and description rewrite",
            description:
              "Rewrite meta titles to include primary keyword, product benefit, and brand. Expand meta descriptions with price, availability, and a CTA.",
          },
          {
            order: 3,
            title: "Image optimization",
            description:
              "Compress all product images to under 100KB. Add descriptive alt text. Implement lazy loading and WebP format.",
          },
          {
            order: 4,
            title: "Trust signals injection",
            description:
              "Add review counts, star ratings, stock urgency indicators, and payment security badges above the fold on every product page.",
          },
          {
            order: 5,
            title: "A/B test CTA copy",
            description:
              "Run A/B tests on primary CTA button copy across 10 top product pages. Measure add-to-cart rate as the primary conversion metric.",
          },
        ],
        expectedResults:
          "30-50% improvement in organic click-through rate from rich snippets. Conversion rate increase of 0.5-1.5 percentage points within 60 days.",
      },
      zh: {
        title: "商品页面优化",
        description:
          "同步优化电商商品页面的搜索发现和页面转化，涵盖技术 SEO、文案和信任信号三个维度。",
        applicableConditions: [
          "商品目录至少有 20 个页面",
          "页面有自然流量但转化率低于 2%",
          "商品页面缺少结构化数据标记",
          "商品页面平均会话时长不足 60 秒",
        ],
        steps: [
          {
            order: 1,
            title: "结构化数据审计",
            description:
              "为所有商品页面添加 Product、Offer 和 Review schema 标记，使用 Google 富结果工具测试并修复验证错误。",
          },
          {
            order: 2,
            title: "标题与描述重写",
            description:
              "重写 meta 标题，包含主关键词、商品核心卖点和品牌名；扩展 meta 描述，加入价格、库存状态和行动号召。",
          },
          {
            order: 3,
            title: "图片优化",
            description:
              "将所有商品图片压缩至 100KB 以内，添加描述性 alt 文本，实现懒加载并采用 WebP 格式。",
          },
          {
            order: 4,
            title: "注入信任信号",
            description:
              "在每个商品页面的首屏添加评价数量、星级评分、库存紧张提示和支付安全标志。",
          },
          {
            order: 5,
            title: "CTA 文案 A/B 测试",
            description:
              "对 10 个核心商品页面的主要按钮文案进行 A/B 测试，以加购率作为主要转化指标。",
          },
        ],
        expectedResults:
          "富摘要带动自然点击率提升 30-50%，60 天内转化率提升 0.5-1.5 个百分点。",
      },
    },
  },
  {
    slug: "community-devrel-loop",
    industry: "devtool",
    channel: "community",
    goal: "retention",
    successRate: 0.6,
    stepCount: 6,
    content: {
      en: {
        title: "Community DevRel Loop",
        description:
          "Turn community engagement into product adoption and retention by building a structured developer relations loop between support, feedback, and product updates.",
        applicableConditions: [
          "Product targets developers or technical users",
          "Monthly active users between 500 and 10,000",
          "Churn rate above 8% monthly",
          "Team has at least one person who can engage technically with developers",
        ],
        steps: [
          {
            order: 1,
            title: "Set up community hub",
            description:
              "Establish a primary community space (Discord, Slack, or GitHub Discussions). Define channels for support, announcements, showcase, and feedback.",
          },
          {
            order: 2,
            title: "Onboard top users as champions",
            description:
              "Identify the top 10-20 most active users. Invite them to a private champions channel. Offer early access and direct product feedback sessions.",
          },
          {
            order: 3,
            title: "Weekly changelog posts",
            description:
              "Publish detailed weekly changelogs in the community. Tag users who requested each improvement. Celebrate small wins publicly.",
          },
          {
            order: 4,
            title: "Monthly community calls",
            description:
              "Host monthly 30-minute live calls. Demo new features, answer questions, and collect structured feedback on the roadmap.",
          },
          {
            order: 5,
            title: "Showcase user projects",
            description:
              "Create a monthly showcase thread where users share projects built with the tool. Amplify top submissions on social channels.",
          },
          {
            order: 6,
            title: "Close the feedback loop",
            description:
              "When a feature requested by the community ships, personally notify the users who asked for it. Track the rate of community-sourced features shipped.",
          },
        ],
        expectedResults:
          "Monthly churn reduction of 2-4 percentage points within 6 months. 3x increase in community-sourced bug reports. 40% of new features originating from community feedback.",
      },
      zh: {
        title: "社区开发者关系循环",
        description:
          "通过在支持、反馈和产品更新之间建立结构化的开发者关系循环，将社区参与转化为产品采用率和留存率提升。",
        applicableConditions: [
          "产品面向开发者或技术用户",
          "月活跃用户在 500 到 10,000 之间",
          "月留存流失率超过 8%",
          "团队中至少有一人能与开发者进行技术交流",
        ],
        steps: [
          {
            order: 1,
            title: "建立社区中心",
            description:
              "搭建主要社区空间（Discord、Slack 或 GitHub Discussions），定义支持、公告、展示和反馈等频道。",
          },
          {
            order: 2,
            title: "邀请顶级用户成为布道者",
            description:
              "找出 10-20 名最活跃用户，邀请他们加入私有布道者频道，提供早期访问权限和直接产品反馈渠道。",
          },
          {
            order: 3,
            title: "每周更新日志发布",
            description:
              "在社区中发布详细的每周更新日志，@提及提出每项改进需求的用户，公开庆祝小成果。",
          },
          {
            order: 4,
            title: "每月社区电话会议",
            description:
              "每月举办 30 分钟线上直播，演示新功能、解答问题，并收集关于产品路线图的结构化反馈。",
          },
          {
            order: 5,
            title: "展示用户项目",
            description:
              "每月创建项目展示帖，用户分享使用该工具构建的作品，在社交渠道放大优秀案例。",
          },
          {
            order: 6,
            title: "闭合反馈循环",
            description:
              "当社区请求的功能上线时，主动通知提出需求的用户，追踪社区来源功能的落地率。",
          },
        ],
        expectedResults:
          "6 个月内月流失率降低 2-4 个百分点。社区来源的 Bug 报告增加 3 倍。40% 的新功能来自社区反馈。",
      },
    },
  },
  {
    slug: "email-nurture-sequence",
    industry: "saas",
    channel: "email",
    goal: "conversion",
    successRate: 0.7,
    stepCount: 5,
    content: {
      en: {
        title: "Email Nurture Sequence",
        description:
          "Convert trial users to paid subscribers with a structured automated email sequence that delivers value touchpoints at key activation moments.",
        applicableConditions: [
          "Product offers a free trial or freemium tier",
          "Trial-to-paid conversion rate is below 15%",
          "Team has email automation tooling in place",
          "Average time-to-value is under 7 days",
        ],
        steps: [
          {
            order: 1,
            title: "Map trial user journey",
            description:
              "Identify the 3-5 key activation events that correlate with paid conversion. Define milestones (Day 1, Day 3, Day 7, Day 14).",
          },
          {
            order: 2,
            title: "Write the sequence",
            description:
              "Write 5-7 emails: welcome, first activation prompt, feature spotlight, social proof, trial expiry warning, and win-back. Each email under 150 words.",
          },
          {
            order: 3,
            title: "Set up behavioral triggers",
            description:
              "Configure sends based on user behavior. Send feature spotlight only if activation event has not occurred. Delay expiry email until day 12.",
          },
          {
            order: 4,
            title: "A/B test subject lines",
            description:
              "Run A/B tests on subject lines for the welcome and trial expiry emails. Use open rate and click rate as primary metrics. Run for 1,000+ sends.",
          },
          {
            order: 5,
            title: "Analyze and optimize",
            description:
              "Review conversion funnel from each email after 30 days. Remove emails with under 5% click rate. Rewrite subject lines below 20% open rate.",
          },
        ],
        expectedResults:
          "Trial-to-paid conversion improvement of 5-10 percentage points. Email open rates above 35%. Revenue impact visible within 45 days of launch.",
      },
      zh: {
        title: "邮件培育序列",
        description:
          "通过在关键激活节点提供价值触点的结构化自动化邮件序列，将试用用户转化为付费订阅者。",
        applicableConditions: [
          "产品提供免费试用或 Freemium 版本",
          "试用转付费率低于 15%",
          "团队已具备邮件自动化工具",
          "平均首次体验到价值的时间不超过 7 天",
        ],
        steps: [
          {
            order: 1,
            title: "绘制试用用户旅程",
            description:
              "识别与付费转化相关的 3-5 个关键激活事件，定义里程碑节点（第 1、3、7、14 天）。",
          },
          {
            order: 2,
            title: "撰写邮件序列",
            description:
              "撰写 5-7 封邮件：欢迎信、首次激活提示、功能亮点、社交证明、试用到期提醒和挽回邮件，每封不超过 150 字。",
          },
          {
            order: 3,
            title: "设置行为触发条件",
            description:
              "根据用户行为配置发送逻辑：仅在激活事件未发生时发送功能亮点邮件，到期提醒延迟到第 12 天发送。",
          },
          {
            order: 4,
            title: "主题行 A/B 测试",
            description:
              "对欢迎邮件和到期提醒邮件的主题行进行 A/B 测试，以打开率和点击率为主要指标，测试量达 1,000 次以上。",
          },
          {
            order: 5,
            title: "分析与优化",
            description:
              "30 天后审查每封邮件的转化漏斗，删除点击率低于 5% 的邮件，重写打开率低于 20% 的主题行。",
          },
        ],
        expectedResults:
          "试用转付费率提升 5-10 个百分点。邮件打开率超过 35%。上线 45 天内可见收入影响。",
      },
    },
  },
];

export function getPublicPlaybooks(): PublicPlaybook[] {
  return [...PUBLIC_PLAYBOOKS];
}

export function getPublicPlaybookBySlug(slug: string): PublicPlaybook | null {
  return PUBLIC_PLAYBOOKS.find((p) => p.slug === slug) ?? null;
}

export function filterPlaybooks(filters: {
  industry?: string;
  channel?: string;
  goal?: string;
}): PublicPlaybook[] {
  return PUBLIC_PLAYBOOKS.filter((p) => {
    if (filters.industry !== undefined && p.industry !== filters.industry) {
      return false;
    }
    if (filters.channel !== undefined && p.channel !== filters.channel) {
      return false;
    }
    if (filters.goal !== undefined && p.goal !== filters.goal) {
      return false;
    }
    return true;
  });
}
