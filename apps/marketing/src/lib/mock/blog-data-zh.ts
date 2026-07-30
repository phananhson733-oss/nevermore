// @input  -- BlogPost type, case study content from blog-content-case-study-zh.ts
// @output -- Chinese mock blog posts (7 articles) for dev mode
// @pos    -- mock data for blog data layer, ZH half of blog-data.ts aggregate
// once this file is updated, update header comments and _DIR.md in this folder

import type { BlogPost } from "@/types";
import { ASTROLOGYWIKI_CONTENT_ZH } from "./blog-content-case-study-zh";

const ts = (month: number, day: number) =>
  `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T08:00:00Z`;

export const MOCK_BLOG_POSTS_ZH: BlogPost[] = [
  // --- Post 1: Growth Automation Guide (ZH) ---
  {
    id: "b1000001-0001-4000-8000-000000000002",
    slug: "what-is-growth-automation",
    locale: "zh",
    locale_exclusive: false,
    title: "什么是增长自动化？产品团队完整指南",
    excerpt:
      "增长自动化用系统化工作流替代手动、重复的营销任务，自动发现机会、生成内容、衡量效果。本文介绍其核心概念、团队为什么需要它，以及如何起步。",
    content: `<h2>手动增长的瓶颈</h2>
<p>大多数产品团队的增长方式停留在五年前。营销负责人打开表格，检查关键词排名，写一篇文章，发布到社交媒体，然后等待。两周后重复这个循环。与此同时，拥有更大团队的竞争对手正在同时发布十倍的内容，在数十个渠道上运行实验。</p>
<p>手动增长无法规模化。一个运营人员每月最多管理 5-10 个 SEO 页面，运行 2-3 个社交实验，跟踪 4 个渠道的结果。如果竞争对手有 5 个人做同样的工作，而你只有 1 个人，差距是注定的。</p>

<h2>增长自动化的真正含义</h2>
<p>增长自动化是使用软件系统执行可重复营销任务的实践 -- 内容生成、分发、衡量和迭代 -- 最大限度减少人工干预。它不是要替代人类判断，而是消除战略决策与执行之间的瓶颈。</p>
<p>一个增长自动化系统通常处理四个阶段：</p>
<ul>
<li><strong>发现：</strong>扫描搜索数据、竞争对手内容和社交信号，找到值得追求的机会。</li>
<li><strong>策略：</strong>根据预估 ROI、难度和业务目标对齐度对机会进行评分和排序。</li>
<li><strong>执行：</strong>生成内容、发布到渠道、构建分发资产（如反向链接或社交帖子）。</li>
<li><strong>衡量：</strong>从首次接触到转化全程追踪归因，形成闭环让系统学习什么有效。</li>
</ul>

<h2>产品团队为什么现在就需要它</h2>
<h3>1. 内容产量军备竞赛</h3>
<p>Google 每天处理超过 85 亿次搜索。要获取有意义的自然流量，你需要主题权威性 -- 这要求全面覆盖一个主题。仅靠一篇支柱文章远远不够。持续发布 30-50 篇互联内容的团队，排名稳定优于只有 5 篇独立文章的团队。</p>
<h3>2. 渠道碎片化</h3>
<p>你的目标用户不在一个地方。他们浏览 Reddit、刷 LinkedIn、搜索 Google、逛 Hacker News、关注 X 上的账号。有效增长意味着在所有相关渠道上分发内容 -- 而每个渠道都有自己的格式、语调和互动模式。即使只覆盖 4 个渠道，手动操作也是一份全职工作。</p>
<h3>3. 归因复杂性</h3>
<p>隐私政策变化、Cookie 弃用和多设备用户旅程，让理解哪些努力驱动了转化变得前所未有的困难。手动归因 -- 在 Google Analytics 里查看 UTM 参数 -- 会遗漏全局。自动化归因系统可以追踪从首次社交曝光到最终注册的完整旅程。</p>

<h2>GenGrowth 的增长自动化方法</h2>
<p>GenGrowth 通过四阶段流水线实现增长自动化，模拟最优秀增长团队的运作方式，同时消除手动瓶颈。</p>
<p><a href="/features">发现引擎</a>对搜索格局进行持续审计，识别关键词差距、内容机会和竞争弱点。不再是季度 SEO 审计，而是每日机会推送，按潜在影响力评分。</p>
<p>策略模块将原始机会转化为排序的行动计划。每个策略获得一个综合评分，基于预估流量价值、实施难度和转化目标对齐度。你批准策略，系统负责执行。</p>
<p>执行代理处理实际工作：生成 SEO 优化内容、为每个平台定制社交帖子、构建反向链接外展活动。每条内容都带有 UTM 指纹，归因自动完成。</p>

<h2>自动化 vs. 手动方法对比</h2>
<ul>
<li><strong>内容产出速度：</strong>手动团队月产 5-10 页。自动化系统可月产 50-100 页，同时通过人工审核关卡保证质量。</li>
<li><strong>实验吞吐量：</strong>手动每季度 2-3 个实验，自动化每月 10-15 个实验。</li>
<li><strong>归因准确度：</strong>手动 UTM 追踪覆盖约 60% 的用户旅程。自动化指纹追踪加跨渠道拼接可达 85-90%。</li>
<li><strong>洞察时效：</strong>手动报告每个周期需 3-5 天。自动化仪表盘实时更新。</li>
</ul>

<h2>起步的三个步骤</h2>
<ol>
<li><strong>审计当前工作流。</strong>列出团队每周执行的所有增长任务，识别哪些是重复的、数据驱动的、基于规则的 -- 这些就是自动化的候选。</li>
<li><strong>先自动化一个渠道。</strong>SEO 内容生成通常是最佳起点，因为它有清晰的输入（关键词、搜索意图）和可衡量的输出（排名、流量）。从一个<a href="/templates">内容模板</a>开始，然后扩展。</li>
<li><strong>用 UTM 衡量一切。</strong>在自动化衡量之前，你需要一致的追踪。在所有渠道实施 UTM 命名规范，确保归因数据从第一天起就是干净的。</li>
</ol>

<h2>常见反对意见</h2>
<p><strong>"自动化内容质量差。"</strong> 这在 2022 年是对的。现代 AI 辅助内容生成结合人工编辑审核，产出质量匹配甚至超过匆忙的手动初稿。关键在于审核关卡 -- 自动化处理前 80% 的工作，人工处理最后 20%。</p>
<p><strong>"我们太小了不需要自动化。"</strong> 小团队获益最大。一个有自动化的两人增长团队，可以匹配一个没有自动化的十人团队的产出。自动化是力量倍增器，不是大公司的奢侈品。</p>

<h2>推荐阅读</h2>
<p>如果你准备运行第一个自动化增长实验，请阅读我们的<a href="/zh/blog/growth-experiment-playbook">分步实验手册</a>。专注 SEO 的团队可以参考<a href="/zh/blog/programmatic-seo-at-scale">程序化 SEO 指南</a>。要看增长自动化的实际案例，请查看 <a href="/zh/blog/astrologywiki-case-study">astrologywiki.com 从 0 到 5000 用户的案例研究</a>。</p>`,
    category: "methodology",
    pillar_slug: "growth_automation",
    author: "GenGrowth 团队",
    reading_time: 7,
    status: "published",
    published_at: ts(1, 15),
    updated_at: ts(2, 10),
    created_at: ts(1, 14),
  },

  // --- Post 2: Growth Experiment Playbook (ZH) ---
  {
    id: "b1000001-0002-4000-8000-000000000002",
    slug: "growth-experiment-playbook",
    locale: "zh",
    locale_exclusive: false,
    title: "如何运行你的第一个增长实验：分步操作手册",
    excerpt:
      "大多数增长实验失败的原因是跳过了无聊但关键的步骤：假设构建、样本量计算和衡量标准定义。这本手册覆盖从想法到迭代的完整流程。",
    content: `<h2>为什么大多数增长实验会失败</h2>
<p>根据 Reforge 和 GrowthHackers 的数据，大约 70-80% 的增长实验未能产生统计显著的结果。这个数字听起来令人沮丧，但其实是预期内的 -- 目标不是赢得每个实验，而是运行足够多的实验让赢家复利。问题在于大多数团队运行的实验不够多，而且实验设计不够严谨。</p>
<p>三个最常见的失败模式：</p>
<ul>
<li><strong>没有明确假设。</strong>"试试在 Reddit 发帖"不是假设。"在 r/SaaS 发布价值导向内容，7 天内每帖带来 50 个合格访客"才是假设。</li>
<li><strong>没有预先定义成功标准。</strong>如果你在开始前不决定"成功"的样子，你会把任何结果合理化为胜利，或者把任何结果视为不确定。</li>
<li><strong>样本量不足。</strong>用 200 个访客运行 A/B 测试然后宣布胜者，在统计上毫无意义。你需要在启动前计算最小样本量。</li>
</ul>

<h2>第 1 步：构建可测试假设</h2>
<p>每个实验都始于遵循这个结构的假设：</p>
<p><strong>"如果我们 [采取这个行动]，那么 [这个指标] 将 [以这个方向变化] [这个幅度]，因为 [这个推理]。"</strong></p>
<p>示例：</p>
<ul>
<li>"如果我们在定价页添加产品对比表，那么定价页到注册的转化率将提升 15%，因为访客目前离开去第三方网站比较我们和竞争对手。"</li>
<li>"如果我们发布 10 个针对长尾关键词的术语页面，那么来自信息类查询的自然流量将在 60 天内增加 2,000 月访问，因为我们目前对这些词没有覆盖且竞争较低。"</li>
</ul>

<h2>第 2 步：定义成功与失败标准</h2>
<p>运行任何实验之前，写下三件事：</p>
<ol>
<li><strong>主要指标：</strong>决定成败的一个数字。SEO 实验通常是自然流量或关键词排名。社交实验是点击率或合格访问。转化实验是转化率本身。</li>
<li><strong>最小可检测效应 (MDE)：</strong>在实践中有意义的最小变化。转化率提升 0.1% 在统计上可能显著，但如果不影响收入就毫无价值。定义让实验值得投入的阈值。</li>
<li><strong>护栏指标：</strong>不能恶化的次要指标。如果你测试更激进的 CTA，主要指标可能是点击率，但护栏应该是跳出率。如果 CTR 上升但跳出率也飙升，实验不是真正的胜利。</li>
</ol>

<h2>第 3 步：计算样本量</h2>
<p>对于 A/B 测试和转化实验，样本量决定你需要运行多长时间。公式取决于三个输入：</p>
<ul>
<li>基线转化率（你当前的比率）</li>
<li>最小可检测效应（来自第 2 步）</li>
<li>统计功效（通常 80%）和显著性水平（通常 95%）</li>
</ul>
<p>对于 3% 的基线转化率和 20% 的相对 MDE（到 3.6%），在 80% 功效和 95% 显著性下，你每个变体需要约 14,500 个访客。如果页面每天有 1,000 个访客，双变体测试需要约 29 天。</p>
<p>对于内容和 SEO 实验，样本量的概念不同。你通常需要 60-90 天的数据才能看到自然流量效果，因为 Google 需要时间来爬取、索引和排名新内容。</p>

<h2>第 4 步：设计实验</h2>
<p>保持实验尽可能简单。一次测试一个变量。多变量测试需要指数级更多的流量并引入混杂变量。</p>
<p>使用此模板记录实验设计：</p>
<ul>
<li><strong>假设：</strong>[来自第 1 步]</li>
<li><strong>主要指标：</strong>[来自第 2 步]</li>
<li><strong>护栏指标：</strong>[来自第 2 步]</li>
<li><strong>持续时间：</strong>[来自第 3 步]</li>
<li><strong>对照组：</strong>当前体验的样子</li>
<li><strong>实验组：</strong>新体验的样子</li>
<li><strong>回滚方案：</strong>出问题时如何恢复</li>
</ul>

<h2>第 5 步：带追踪执行</h2>
<p>每个实验都需要干净的归因。至少要做到：</p>
<ul>
<li>为每个实验组使用唯一的 UTM 参数：<code>utm_campaign=exp_001&amp;utm_content=treatment_a</code></li>
<li>在分析系统中记录实验分配（GA4、Mixpanel 或 Amplitude）</li>
<li>设置实时仪表盘监控异常</li>
</ul>
<p>GenGrowth 通过<a href="/features">执行流水线</a>自动化这些，为每条内容分配 UTM 指纹并自动追踪效果。</p>

<h2>第 6 步：衡量与分析</h2>
<p>当实验达到计划的持续时间或样本量时，用这个清单分析结果：</p>
<ol>
<li>主要指标是否朝预测方向变化？</li>
<li>变化是否统计显著（p &lt; 0.05）？</li>
<li>变化是否实际显著（超过 MDE）？</li>
<li>是否有护栏指标恶化？</li>
<li>是否存在细分差异？</li>
</ol>

<h2>第 7 步：迭代</h2>
<p>每个实验都产生学习，无论结果如何：</p>
<ul>
<li><strong>赢家：</strong>上线实验组并设计后续实验进一步推动指标。</li>
<li><strong>输家：</strong>记录假设错误的原因。是推理有缺陷，还是执行不完美？修改假设再测试。</li>
<li><strong>不确定：</strong>增加样本量或延长时间。如果仍然不确定，效应可能太小无关紧要 -- 转向更高影响的实验。</li>
</ul>

<h2>实验速度基准</h2>
<p>最优秀的增长团队每月跨渠道运行 8-12 个实验。流量有限的早期创业团队应聚焦于每月 3-4 个实验，优先选择高影响渠道。关键指标不是胜率 -- 而是实验速度。运行更多实验的团队学习更快，复利优势更大。</p>
<p>关于如何搭建支持快速实验的衡量基础设施，参见<a href="/zh/blog/marketing-attribution-models">营销归因模型指南</a>。要看实验实战案例，阅读<a href="/zh/blog/social-first-week-1">第 1 周社交优先实验报告</a>。</p>`,
    category: "methodology",
    pillar_slug: "experiment_driven",
    author: "GenGrowth 团队",
    reading_time: 8,
    status: "published",
    published_at: ts(2, 1),
    updated_at: ts(2, 20),
    created_at: ts(1, 30),
  },

  // --- Post 3: Marketing Attribution Models (ZH) ---
  {
    id: "b1000001-0003-4000-8000-000000000002",
    slug: "marketing-attribution-models",
    locale: "zh",
    locale_exclusive: false,
    title: "营销归因详解：哪种模型适合你的产品？",
    excerpt:
      "归因决定了你如何在营销触点间分配功劳。选错模型会导致预算错配和对低效渠道的虚假信心。本文介绍六大归因模型及选择方法。",
    content: `<h2>归因到底意味着什么</h2>
<p>营销归因是将转化的功劳分配给影响它的营销触点的过程。当用户注册你的产品时，他们在过去 30 天内与你品牌的 7 次互动中，到底哪些真正起了作用？答案取决于你使用哪种归因模型 -- 不同的模型给出截然不同的答案。</p>
<p>归因之所以重要，因为它决定了你的预算分配。如果最后点击模型显示付费搜索驱动了 80% 的转化，你会大量投入付费搜索。但如果那些用户最初是通过博客文章发现你的（自然流量），然后看了一个社交证明帖子（社交），最后点击了重定向广告（付费）-- 真正的驱动力是自然内容，不是付费搜索。</p>

<h2>六大归因模型</h2>

<h3>1. 最后点击归因</h3>
<p>最简单和最常见的模型。100% 的功劳归于转化前的最后一个触点。</p>
<p><strong>优点：</strong>易于实施。每个分析工具默认支持。清晰明确。</p>
<p><strong>缺点：</strong>严重高估底部漏斗渠道（品牌搜索、重定向、直接访问），低估顶部漏斗渠道（内容、社交、认知）。它告诉你谁完成了交易，但不告诉你谁创造了机会。</p>
<p><strong>适用：</strong>1-2 个触点的简单漏斗，或作为与其他模型比较的基准。</p>

<h3>2. 首次点击归因</h3>
<p>100% 的功劳归于首次将用户引入你品牌的触点。</p>
<p><strong>优点：</strong>正确评估认知和发现渠道。有助于理解新用户来源。</p>
<p><strong>缺点：</strong>忽略发现之后发生的一切。</p>
<p><strong>适用：</strong>聚焦漏斗顶部增长和用户获取的团队。</p>

<h3>3. 线性归因</h3>
<p>所有触点平均分配功劳。如果有 5 个触点，每个获得 20%。</p>
<p><strong>优点：</strong>承认每个触点都发挥作用。没有渠道被完全忽略。</p>
<p><strong>缺点：</strong>将所有触点视为同等重要，这很少是真的。</p>
<p><strong>适用：</strong>数据有限、想要平衡视角的团队。</p>

<h3>4. 时间衰减归因</h3>
<p>更接近转化事件的触点获得更多功劳。较早的触点获得指数级递减的功劳。</p>
<p><strong>优点：</strong>反映了近期互动比远期互动更重要的直觉。在单触点和等权重模型之间取得平衡。</p>
<p><strong>缺点：</strong>低估认知渠道，虽然程度不如最后点击严重。衰减率有一定任意性。</p>
<p><strong>适用：</strong>销售周期较长（30-90 天）的 B2B 产品，其中培育触点很重要但时间近度与意图相关。</p>

<h3>5. 位置归因（U 型）</h3>
<p>40% 功劳给第一个触点，40% 给最后一个触点，剩余 20% 在中间触点间平均分配。</p>
<p><strong>优点：</strong>同时重视发现和转化，同时承认中间漏斗。被广泛认为是大多数产品的最佳默认模型。</p>
<p><strong>缺点：</strong>40/40/20 的分配是任意的。某些漏斗有关键的中间触点（如产品演示或案例研究浏览）值得更大份额。</p>
<p><strong>适用：</strong>大多数 B2B SaaS 产品和任何有多触点漏斗的产品。</p>

<h3>6. 数据驱动归因</h3>
<p>使用机器学习根据转化数据计算每个触点的实际贡献。Google Analytics 4 为数据量足够的账户原生提供此功能。</p>
<p><strong>优点：</strong>最准确。适应你特定的漏斗和用户行为。无任意假设。</p>
<p><strong>缺点：</strong>需要大量数据（通常月 600+ 转化）。黑箱 -- 难以解释模型为何如此分配功劳。</p>
<p><strong>适用：</strong>流量和转化量大、需要精确渠道优化的产品。</p>

<h2>渠道隔离：被遗漏的关键</h2>
<p>归因模型告诉你哪些触点获得功劳，但不告诉你没有特定渠道会怎样。这就是渠道隔离实验的用武之地。</p>
<p>渠道隔离测试这样运作：暂时停止在一个渠道上的支出或活动，衡量对转化的影响。如果你暂停付费搜索而转化下降 5%，那么付费搜索最多驱动 5% 的增量转化 -- 无论归因模型怎么说。</p>
<p>GenGrowth 使用 <a href="/features">UTM 指纹追踪</a>实现轻量渠道隔离。每条内容获得唯一指纹，让你无需黑箱模型就能追踪每个渠道的确切贡献。</p>

<h2>UTM 参数：基础中的基础</h2>
<p>没有干净的追踪数据，任何归因模型都不起作用。UTM 参数是基础：</p>
<ul>
<li><strong>utm_source：</strong>流量来源（google、reddit、newsletter）</li>
<li><strong>utm_medium：</strong>营销媒介（organic、social、email、paid）</li>
<li><strong>utm_campaign：</strong>具体的活动或实验</li>
<li><strong>utm_content：</strong>区分活动内的变体</li>
<li><strong>utm_term：</strong>付费搜索活动的关键词</li>
</ul>
<p>一致性至关重要。如果一个团队成员用 "utm_source=Reddit"，另一个用 "utm_source=reddit"，你的归因数据就碎裂了。建立命名规范文档并在所有渠道强制执行。</p>

<h2>根据阶段选择正确的模型</h2>
<ul>
<li><strong>PMF 前（0-1,000 用户）：</strong>使用首次点击归因。你需要理解哪些渠道驱动认知。转化优化为时过早。</li>
<li><strong>早期增长（1,000-10,000 用户）：</strong>切换到位置归因（U 型）。你现在有足够的触点看到完整漏斗。</li>
<li><strong>规模化（10,000+ 用户）：</strong>如果有数据量，转向数据驱动归因。每季度用渠道隔离测试验证模型准确性。</li>
</ul>

<h2>推荐阅读</h2>
<p>关于归因实战案例，参见<a href="/zh/blog/social-first-week-1">第 1 周社交实验报告</a>，我们追踪了 Reddit、X 和 LinkedIn 的跨渠道归因。要了解如何用程序化 SEO 生成喂养归因漏斗的内容，阅读<a href="/zh/blog/programmatic-seo-at-scale">SEO 页面规模化指南</a>。</p>`,
    category: "methodology",
    pillar_slug: "attribution",
    author: "GenGrowth 团队",
    reading_time: 8,
    status: "published",
    published_at: ts(2, 10),
    updated_at: ts(3, 1),
    created_at: ts(2, 8),
  },

  // --- Post 4: AstrologyWiki Case Study (ZH) ---
  {
    id: "b1000001-0004-4000-8000-000000000002",
    slug: "astrologywiki-case-study",
    locale: "zh",
    locale_exclusive: false,
    title: "从 0 到 5,000 用户：astrologywiki.com 如何用 GenGrowth 实现增长",
    excerpt:
      "一个详细的案例研究：astrologywiki.com 如何在 14 周内从空白域名成长为月活 5,000 用户，使用 GenGrowth 的发现-执行流水线。真实数据，真实策略，真实结果。",
    content: `<h2>起点</h2>
<p>2026 年 1 月，astrologywiki.com 是一块白纸。域名注册了两年，但零索引页面、零反向链接、零自然流量。创始人是一位前星座 App 产品经理，拥有深厚的领域专业知识，但没有增长团队、内容流水线和营销预算 -- 除了 GenGrowth 订阅费。</p>
<p>目标明确：90 天内达到 5,000 月活用户，完全通过自然渠道。没有付费广告，没有网红合作，没有公关代理。只有内容、搜索和社交。</p>

<h2>第一阶段：发现（第 1-2 周）</h2>
<p>GenGrowth 的发现引擎对星座内容格局进行了全面审计。发现结果塑造了整个策略：</p>
<ul>
<li><strong>关键词宇宙：</strong>4,200 个星座相关关键词，合计月搜索量 1,280 万。竞争从低（长尾词如 "水星逆行对金牛座的影响"）到极高（头部词如 "星座"）。</li>
<li><strong>内容差距分析：</strong>前 5 名竞争对手平均各有 340 个索引页面。astrologywiki.com 有零个。差距巨大但也意味着机会 -- 许多长尾主题覆盖不足。</li>
<li><strong>社交信号扫描：</strong>Reddit 的 r/astrology 有 120 万成员。X 上星座相关讨论日均 45,000 条。受众活跃、参与度高、正在寻找权威内容。</li>
</ul>
<p>发现引擎对 186 个机会项目评分，按综合优先级得分（搜索量、竞争难度和转化潜力）表面化前 30 个。</p>

<h2>第二阶段：策略（第 3 周）</h2>
<p>基于发现数据，GenGrowth 生成了三管齐下的策略：</p>
<h3>内容集群策略</h3>
<p>通过互联内容集群构建主题权威性。策略确定了三个支柱主题：</p>
<ol>
<li><strong>出生图解读</strong>（1 个支柱页 + 12 篇覆盖每个星座的支撑文章）</li>
<li><strong>行星过境</strong>（1 个支柱页 + 8 篇覆盖主要行星的支撑文章）</li>
<li><strong>星座配对</strong>（1 个支柱页 + 24 篇覆盖所有星座配对的支撑文章）</li>
</ol>
<p>计划内容总量：3 个集群共 49 页，旨在在 Google 建立主题权威性并捕获长尾流量。</p>

<h3>社交种子策略</h3>
<p>在 Reddit (r/astrology, r/AskAstrologers) 和 X 上发布价值导向内容，在 SEO 增长期间驱动初始流量。每个社交帖子都链接到相关的维基页面，创造流量和参与信号的良性循环。</p>

<h2>第三阶段：执行（第 4-12 周）</h2>
<h3>内容产出</h3>
<ul>
<li>第 4-6 周：发布所有 3 个支柱页面和 15 篇支撑文章（平均每周 5 篇）</li>
<li>第 7-9 周：发布剩余 29 篇支撑文章和 12 个术语条目</li>
<li>第 10-12 周：根据活动期间发现的热门搜索查询额外发布 8 篇文章</li>
</ul>
<p>总发布内容：67 页。平均字数：1,800 字。每篇文章在发布前都经过创始人的准确性审核。</p>

<h3>社交分发</h3>
<ul>
<li>Reddit：在 3 个子论坛发布 34 帖。平均参与率：6.2%（子论坛基线 1.5%）</li>
<li>X：发布 48 个星座主题推文串。平均曝光：每串 2,800</li>
<li>社交驱动的总访问：前 8 周 8,400 次</li>
</ul>

<h3>链接建设</h3>
<p>GenGrowth 的链接外展代理识别了 45 个潜在链接合作方。其中 12 个产生了自然反向链接（27% 转化率）。网站的 Domain Rating 在 12 周内从 0 增长到 18。</p>

<h2>结果：14 周后</h2>
<p>到第 14 周，astrologywiki.com 实现了：</p>
<ul>
<li><strong>5,247 月活用户</strong>（目标：5,000）</li>
<li><strong>67 个 Google 索引页面</strong>（全部获得排名）</li>
<li><strong>847 个 Google 排名关键词</strong>，其中 23 个进入前 10</li>
<li><strong>12,400 月自然会话</strong>（从零开始）</li>
<li><strong>Domain Rating 18</strong>（从零开始）</li>
<li><strong>平均页面停留时间：4 分 12 秒</strong>（表明内容质量高）</li>
</ul>
<p>流量来源分布：</p>
<ul>
<li>自然搜索：62%（7,688 会话）</li>
<li>社交（Reddit + X）：24%（2,976 会话）</li>
<li>直接访问：11%（1,364 会话）</li>
<li>引荐（反向链接）：3%（372 会话）</li>
</ul>

<h2>关键学习</h2>
<ol>
<li><strong>内容集群胜过孤立页面。</strong>三个集群的支柱页面排名速度明显快于独立文章。Google 的主题权威性信号是真实且可衡量的。</li>
<li><strong>社交和 SEO 互补，而非竞争。</strong>社交驱动早期流量（第 1-6 周），SEO 逐步接力。到第 10 周，自然流量超过社交 -- 但社交参与信号可能加速了排名提升。</li>
<li><strong>长尾关键词是入口。</strong>网站的首批首页排名都是长尾词（4+ 词查询）。头部词只在网站通过覆盖广度展示主题权威性后才开始排名。</li>
<li><strong>垂直内容的人工审核不可缺少。</strong>星座有特定的规范和敏感性。创始人对每篇文章的审核确保了准确性和真实性。自动化处理产量，人类专业知识处理质量。</li>
</ol>

<h2>自己尝试</h2>
<p>astrologywiki.com 的增长完全由 GenGrowth 的发现-执行流水线驱动。创始人每周花约 5 小时在内容审核和策略审批上。其他一切 -- 发现、内容生成、社交分发、链接外展和衡量 -- 都是自动化的。</p>
<p>开始你的增长之旅，探索 <a href="/features">GenGrowth 的功能</a>或阅读<a href="/zh/blog/what-is-growth-automation">增长自动化完整指南</a>。</p>`,
    category: "case_study",
    pillar_slug: "customer_stories",
    author: "GenGrowth 团队",
    reading_time: 8,
    status: "published",
    published_at: ts(2, 20),
    updated_at: ts(3, 5),
    created_at: ts(2, 18),
  },

  // --- Post 5: Programmatic SEO (ZH) ---
  {
    id: "b1000001-0005-4000-8000-000000000002",
    slug: "programmatic-seo-at-scale",
    locale: "zh",
    locale_exclusive: false,
    title: "程序化 SEO：如何从 10 页扩展到 10,000 页",
    excerpt:
      "程序化 SEO 使用模板和结构化数据生成大量搜索优化页面。本指南涵盖策略、技术实现和常见陷阱 -- 附带 GenGrowth 内容引擎的真实案例。",
    content: `<h2>程序化 SEO 是什么（以及不是什么）</h2>
<p>程序化 SEO 是使用模板、结构化数据和自动化来生成大量搜索优化页面的实践。不是手动编写每个页面，而是定义一次模板，然后用数据批量填充。</p>
<p>想想 Yelp 如何为每个城市的每家餐厅都有一个页面，或者 Zillow 如何为每个房产列表都有一个页面。这些不是手工制作的页面 -- 它们是用结构化数据填充的模板驱动页面。同样的方法适用于 SaaS 公司、内容站点和市场平台。</p>
<p>程序化 SEO 不等于垃圾内容。高质量程序化页面和低质门页面之间的区别是价值。每个页面都必须用有用、准确的信息回答真实的搜索查询。Google 的有用内容更新专门针对那些只为搜索引擎而非用户存在的页面。</p>

<h2>三种程序化 SEO 策略</h2>

<h3>策略 1：术语表和知识库</h3>
<p>最简单的入口。为你领域中的每个重要术语、概念或实体创建一个页面。每个页面遵循一致的模板：定义、详细解释、相关术语和指向产品的行动号召。</p>
<p>GenGrowth 的<a href="/glossary">增长术语表</a>使用了这种方法。每个术语都有标准化页面，覆盖定义、上下文、衡量方法和相关概念。模板确保一致性，内容对每个术语是唯一的。</p>
<p><strong>规模潜力：</strong>大多数 B2B 产品可产出 50-500 页，覆盖行业术语、方法论和概念。</p>

<h3>策略 2：对比和替代方案页面</h3>
<p>创建将你的产品与竞争对手比较的页面，或比较两个相关工具/方法。这些页面瞄准高意向搜索查询，如 "工具 A vs 工具 B" 或 "X 的最佳替代方案"。</p>
<p>模板包括：功能对比表、定价比较、使用场景推荐和优劣势的诚实评估。诚实建立信任 -- 如果竞争对手在某方面更好，就说出来。用户会信任你对你实际更好的方面的推荐。</p>
<p><strong>规模潜力：</strong>根据竞争对手数量，20-200 页。</p>

<h3>策略 3：地域或细分页面</h3>
<p>如果产品服务不同的市场、行业或地区，为每个创建专属页面。一个项目管理工具可以有 "建筑业项目管理"、"代理公司项目管理"、"创业公司项目管理" -- 每个都有细分特定内容。</p>
<p><strong>规模潜力：</strong>根据细分数量，50-5,000+ 页。</p>

<h2>技术实现</h2>
<p>规模化建设程序化 SEO 需要四个技术组件：</p>

<h3>1. 数据层</h3>
<p>你需要为每个要生成的页面准备结构化数据。可以是数据库表、电子表格或 API。数据应包括：</p>
<ul>
<li>主要实体（术语、竞争对手、地点或细分市场）</li>
<li>唯一内容字段（定义、描述、关键特性）</li>
<li>元数据（搜索量、竞争度、相关实体）</li>
<li>SEO 字段（标题标签、元描述、规范 URL）</li>
</ul>

<h3>2. 模板引擎</h3>
<p>设计将结构化数据渲染为完整 HTML 页面的模板。每个模板应包括：</p>
<ul>
<li>包含主要实体的唯一 H1</li>
<li>结构化内容部分（每部分有唯一文本，不仅是实体名称替换）</li>
<li>内部链接（既链接到程序化页面集内的其他页面，也链接到手动创建的内容）</li>
<li>Schema.org 结构化数据用于富摘要</li>
</ul>
<p>关键规则：每个页面必须有超越实体名称的实质性唯一内容。"增长自动化是一种用于增长的自动化"不是唯一内容。每个页面需要针对该实体的真实、有用的信息。</p>

<h3>3. 爬取和索引管理</h3>
<p>一次性发布数千页面时，需要管理搜索引擎如何发现和索引它们：</p>
<ul>
<li><strong>XML 站点地图：</strong>生成并提交包含所有程序化页面的站点地图。大型网站使用站点地图索引文件。</li>
<li><strong>内部链接：</strong>每个程序化页面应在 3 次点击内可从首页到达。使用分类页、标签页或中心页创建可导航路径。</li>
<li><strong>Robots.txt：</strong>确保程序化页面路径未被屏蔽。在 Google Search Console 检查爬取统计。</li>
</ul>

<h3>4. 质量保证流水线</h3>
<p>自动化内容需要自动化质量检查：</p>
<ul>
<li>最低字数要求（每页 300+ 词唯一内容）</li>
<li>重复内容检测（用相似度评分比较）</li>
<li>断链检查（确保所有内部链接可访问）</li>
<li>Schema 验证</li>
<li>移动端渲染验证</li>
</ul>

<h2>常见陷阱</h2>
<p><strong>规模化的薄内容。</strong>如果模板只产出 100 词唯一内容，Google 会标记为薄内容或重复。为每个实体投入内容质量。GenGrowth 通过为每个页面生成实质性的、实体特定的内容来解决这个问题。</p>
<p><strong>自我蚕食。</strong>当多个程序化页面瞄准相似关键词时，它们相互竞争。使用关键词映射确保每页瞄准不同的主要关键词。</p>
<p><strong>孤立页面。</strong>没有被网站上任何地方链接的页面对搜索引擎来说实际上是不可见的。确保每个程序化页面至少从一个分类或中心页获得链接。</p>

<h2>用 GenGrowth 扩展</h2>
<p>GenGrowth 的内容引擎端到端自动化程序化 SEO 流水线。发现引擎识别实体机会。策略模块按预估流量价值排序。执行流水线使用你批准的模板生成、审核和发布页面。</p>
<p>关于程序化 SEO 的实战案例，参见 <a href="/zh/blog/astrologywiki-case-study">astrologywiki.com 如何在 14 周内扩展到 67 页和 5,000 用户</a>。要理解追踪程序化 SEO 效果的衡量框架，阅读<a href="/zh/blog/marketing-attribution-models">营销归因模型指南</a>。</p>`,
    category: "methodology",
    pillar_slug: "seo_content",
    author: "GenGrowth 团队",
    reading_time: 8,
    status: "published",
    published_at: ts(3, 1),
    updated_at: ts(3, 10),
    created_at: ts(2, 28),
  },

  // --- Post 6: Social-First Week 1 Report (ZH) ---
  {
    id: "b1000001-0006-4000-8000-000000000002",
    slug: "social-first-week-1",
    locale: "zh",
    locale_exclusive: false,
    title: "第 1 周实验报告：社交优先的内容分发",
    excerpt:
      "我们假设社交渠道可以在投入长文 SEO 文章之前验证内容主题的市场共鸣。以下是我们在 Reddit、X 和 LinkedIn 上用相同内容角度测试 3 个主题的结果。",
    content: `<h2>实验概览</h2>
<p>这是我们公开建设系列的第一份周度实验报告。每周我们运行一个结构化的增长实验，衡量结果，公开分享发现 -- 包括失败。</p>
<p><strong>假设：</strong>社交渠道（Reddit、X、LinkedIn）可以在 7 天内验证内容主题的共鸣度，为长文 SEO 内容投入方向提供信号。在社交上获得高于基线参与的主题，在自然搜索中也会表现超出平均。</p>
<p><strong>实验持续时间：</strong>7 天（2026 年 3 月 3-9 日）</p>
<p><strong>主要指标：</strong>各平台参与率（评论 + 点击 / 曝光）</p>
<p><strong>次要指标：</strong>着陆页点击率、社交来源的页面停留时间、社交流量的邮件注册</p>

<h2>设置</h2>
<p>我们从 GenGrowth 的发现流水线中选择了 3 个内容主题，分别代表不同的内容支柱：</p>
<ol>
<li><strong>主题 A：</strong>"增长自动化的 80/20 法则"（支柱：growth_automation）</li>
<li><strong>主题 B：</strong>"为什么大多数 A/B 测试在统计上是无效的"（支柱：experiment_driven）</li>
<li><strong>主题 C：</strong>"归因已崩坏 -- 该怎么办"（支柱：attribution）</li>
</ol>
<p>每个主题根据三个平台的特点进行了适配：</p>
<ul>
<li><strong>Reddit：</strong>长文文字帖子，包含可操作的要点。发布在 r/SaaS、r/startups 和 r/GrowthHacking。</li>
<li><strong>X：</strong>推文串格式（8-10 条推文），包含钩子推文和最后一条的行动号召。</li>
<li><strong>LinkedIn：</strong>专业叙事帖子（1,200 字符），配文档轮播。</li>
</ul>
<p>每条帖子都包含唯一的 UTM 指纹用于归因追踪：<code>utm_campaign=social_first_w1&amp;utm_content=[topic]_[platform]</code></p>

<h2>各平台结果</h2>

<h3>Reddit</h3>
<table>
<tr><th>主题</th><th>子论坛</th><th>曝光</th><th>参与率</th><th>点击</th></tr>
<tr><td>A：增长自动化</td><td>r/SaaS</td><td>3,200</td><td>7.1%</td><td>85</td></tr>
<tr><td>B：A/B 测试</td><td>r/startups</td><td>2,100</td><td>4.3%</td><td>42</td></tr>
<tr><td>C：归因</td><td>r/GrowthHacking</td><td>1,800</td><td>3.1%</td><td>28</td></tr>
</table>
<p><strong>Reddit 基线：</strong>这些子论坛文字帖的 1.5% 参与率。</p>
<p><strong>分析：</strong>三个主题都超过了基线。主题 A 表现显著突出，可能因为 r/SaaS 有大量正在积极寻找增长解决方案的创始人。互动是真实的 -- 主题 A 收到 12 条有实质内容的评论，其中几条要求更详细的自动化工作流介绍。</p>

<h3>X (Twitter)</h3>
<table>
<tr><th>主题</th><th>曝光</th><th>参与率</th><th>链接点击</th></tr>
<tr><td>A：增长自动化</td><td>4,800</td><td>2.1%</td><td>34</td></tr>
<tr><td>B：A/B 测试</td><td>6,200</td><td>3.4%</td><td>62</td></tr>
<tr><td>C：归因</td><td>3,100</td><td>1.8%</td><td>18</td></tr>
</table>
<p><strong>X 基线：</strong>SaaS/增长领域推文串的 2.0% 参与率。</p>
<p><strong>分析：</strong>与 Reddit 出现有趣的分化。主题 B 在 X 上表现最强，而主题 A 在 Reddit 上称霸。主题 B 的推文串格式（"为什么大多数 A/B 测试在统计上是无效的"）之所以共鸣是因为它是反常识的和教育性的 -- 这两个属性正是 X 的算法所奖励的。主题 C 在两个平台上都表现不佳，说明归因作为话题对广泛的社交受众来说可能太利基了。</p>

<h3>LinkedIn</h3>
<table>
<tr><th>主题</th><th>曝光</th><th>参与率</th><th>链接点击</th></tr>
<tr><td>A：增长自动化</td><td>1,400</td><td>4.2%</td><td>22</td></tr>
<tr><td>B：A/B 测试</td><td>1,100</td><td>3.8%</td><td>16</td></tr>
<tr><td>C：归因</td><td>980</td><td>5.1%</td><td>24</td></tr>
</table>
<p><strong>LinkedIn 基线：</strong>营销/增长领域自然帖子的 3.0% 参与率。</p>
<p><strong>分析：</strong>令人惊讶的结果：主题 C（归因）在 LinkedIn 上表现最佳，尽管在 Reddit 和 X 上表现不佳。LinkedIn 的受众偏向每天处理归因挑战的营销专业人士。这表明归因内容应主要通过 LinkedIn 和 SEO 分发，而非 Reddit 或 X。</p>

<h2>跨平台归因</h2>
<p>使用 GenGrowth 的 UTM 指纹追踪，我们追踪了社交访客的站内行为：</p>
<ul>
<li><strong>Reddit 访客：</strong>平均页面停留 3:42，跳出率 38%，邮件注册率 2.8%</li>
<li><strong>X 访客：</strong>平均页面停留 1:54，跳出率 62%，邮件注册率 0.9%</li>
<li><strong>LinkedIn 访客：</strong>平均页面停留 4:15，跳出率 31%，邮件注册率 3.4%</li>
</ul>
<p>尽管原始流量最低，LinkedIn 按每个站内指标都提供了最高质量的访客。Reddit 第二。X 驱动了最多曝光但流量质量最低 -- 与该平台重滚动、低注意力的使用模式一致。</p>

<h2>决策</h2>
<p>基于第 1 周数据，我们为第 2 周做出以下策略决策：</p>
<ol>
<li><strong>在 Reddit 上加倍增长自动化内容。</strong>主题 A 的 7.1% 参与率是基线的 4.7 倍。我们将在相关的增长自动化子主题上再发布 3 帖。</li>
<li><strong>X 上只用反常识/教育性内容。</strong>主题 B 的强劲表现表明 X 奖励挑衅性的、打破迷思的内容。我们将把未来的 X 推文串围绕 "为什么 [常见观点] 是错的" 的角度。</li>
<li><strong>将归因内容转移到 LinkedIn。</strong>主题 C 在 LinkedIn 上找到了它的受众。我们将为归因相关内容投入 LinkedIn 文档轮播。</li>
<li><strong>降低主题 C 的 SEO 优先级。</strong>尽管 LinkedIn 成功，归因内容的跨平台总参与是混合的。我们会写长文 SEO 文章但排在主题 A 和 B 之后。</li>
<li><strong>首先为主题 A 投入长文内容。</strong>在 Reddit 和 LinkedIn 上都得到验证，增长自动化有最清晰的需求信号。支柱文章将在第 2 周发布。</li>
</ol>

<h2>下一步</h2>
<p>第 2 周实验将测试内容再利用：将主题 A 的支柱文章摘要分发到社交渠道，衡量长文优先还是社交优先产生更多总参与。</p>
<p>关注我们公开建设之旅的<a href="/zh/blog?category=weekly-review">周报归档</a>。关于实验设计方法论，参见<a href="/zh/blog/growth-experiment-playbook">增长实验操作手册</a>。</p>`,
    category: "weekly_review",
    pillar_slug: "experiment_driven",
    author: "GenGrowth 团队",
    reading_time: 7,
    status: "published",
    published_at: ts(3, 10),
    updated_at: ts(3, 10),
    created_at: ts(3, 9),
  },

  // --- Post 7: AstrologyWiki Zero to 5,000 Case Study (New) ---
  {
    id: "b1000001-0007-4000-8000-000000000002",
    slug: "astrologywiki-zero-to-5000-users",
    locale: "zh",
    locale_exclusive: false,
    title:
      "从零到 5,000 用户：GenGrowth 如何为 AstrologyWiki 实现自动化增长",
    excerpt:
      "AstrologyWiki 在 6 个月内从零自然流量增长到月活 5,000+ 用户。本案例研究详解 GenGrowth 的 Social-First 验证、多触点归因和自优化循环是如何实现这一切的 -- 包含真实指标和每个阶段的策略决策。",
    content: ASTROLOGYWIKI_CONTENT_ZH,
    category: "case_study",
    pillar_slug: "customer_stories",
    author: "GenGrowth 团队",
    reading_time: 12,
    status: "published",
    published_at: ts(3, 15),
    updated_at: ts(3, 15),
    created_at: ts(3, 14),
  },
];
