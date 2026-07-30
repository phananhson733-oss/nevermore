// @input  -- BlogPost type, case study content from blog-content-case-study-en.ts
// @output -- English mock blog posts (7 articles) for dev mode
// @pos    -- mock data for blog data layer, EN half of blog-data.ts aggregate
// once this file is updated, update header comments and _DIR.md in this folder

import type { BlogPost } from "@/types";
import { ASTROLOGYWIKI_CONTENT_EN } from "./blog-content-case-study-en";

const ts = (month: number, day: number) =>
  `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T08:00:00Z`;

export const MOCK_BLOG_POSTS_EN: BlogPost[] = [
  // --- Post 1: Growth Automation Guide ---
  {
    id: "b1000001-0001-4000-8000-000000000001",
    slug: "what-is-growth-automation",
    locale: "en",
    locale_exclusive: false,
    title: "What is Growth Automation? A Complete Guide for Product Teams",
    excerpt:
      "Growth automation replaces manual, repetitive marketing tasks with systematic workflows that discover opportunities, generate content, and measure results without constant human oversight. This guide covers what it is, why teams need it, and how to get started.",
    content: `<h2>The Problem with Manual Growth</h2>
<p>Most product teams run growth the same way they did five years ago. A marketing manager opens a spreadsheet, checks keyword rankings, drafts a blog post, publishes it, shares it on social media, and then waits. Two weeks later, they repeat the cycle. Meanwhile, competitors with larger teams are publishing ten times the content and running experiments across dozens of channels simultaneously.</p>
<p>Manual growth does not scale. A single operator can manage roughly 5-10 SEO pages per month, run 2-3 social experiments, and track results across maybe 4 channels before context-switching costs eat their productivity. The math is simple: if your competitor has five people doing this work and you have one, you lose.</p>

<h2>What Growth Automation Actually Means</h2>
<p>Growth automation is the practice of using software systems to execute repeatable marketing tasks -- content generation, distribution, measurement, and iteration -- with minimal manual intervention. It is not about replacing human judgment. It is about removing the bottleneck between a strategic decision and its execution.</p>
<p>A growth automation system typically handles four stages:</p>
<ul>
<li><strong>Discovery:</strong> Scanning search data, competitor content, and social signals to find opportunities worth pursuing.</li>
<li><strong>Strategy:</strong> Scoring and prioritizing those opportunities based on estimated ROI, difficulty, and alignment with business goals.</li>
<li><strong>Execution:</strong> Generating content, publishing to channels, and building distribution assets like backlinks or social threads.</li>
<li><strong>Measurement:</strong> Tracking attribution from first touch to conversion, closing the loop so the system learns what works.</li>
</ul>

<h2>Why Product Teams Need It Now</h2>
<p>Three market shifts make growth automation urgent rather than optional:</p>
<h3>1. The Content Volume Arms Race</h3>
<p>Google processes over 8.5 billion searches per day. To capture meaningful organic traffic, you need topical authority -- which requires covering a subject comprehensively. A single pillar page is no longer enough. Teams that publish 30-50 interconnected pages on a topic consistently outrank those with 5 standalone articles.</p>
<h3>2. Channel Fragmentation</h3>
<p>Your audience is not in one place. They read Reddit threads, scroll LinkedIn feeds, search Google, browse Hacker News, and follow X accounts. Effective growth means distributing across all relevant channels -- and each channel has its own format, tone, and engagement patterns. Doing this manually across even 4 channels is a full-time job.</p>
<h3>3. Attribution Complexity</h3>
<p>With privacy changes, cookie deprecation, and multi-device journeys, understanding which efforts drive conversions has never been harder. Manual attribution -- checking UTM parameters in Google Analytics -- misses the bigger picture. Automated attribution systems can track the full journey from first social impression to final signup.</p>

<h2>How GenGrowth Approaches Growth Automation</h2>
<p>GenGrowth implements growth automation through a four-stage pipeline that mirrors how the best growth teams operate, but removes the manual bottlenecks.</p>
<p>The <a href="/features">Discovery Engine</a> runs continuous audits of your search landscape, identifying keyword gaps, content opportunities, and competitive weaknesses. Instead of a quarterly SEO audit, you get daily opportunity feeds scored by potential impact.</p>
<p>The Strategy module translates raw opportunities into ranked action plans. Each strategy gets a composite score based on estimated traffic value, implementation difficulty, and alignment with your conversion goals. You approve the strategy; the system handles execution.</p>
<p>Execution agents handle the actual work: generating SEO-optimized content, crafting social posts tailored to each platform, and building backlink outreach campaigns. Every piece of content carries a UTM fingerprint so attribution is automatic.</p>
<p>Finally, the Measurement layer tracks results across all channels, feeding performance data back into the Discovery Engine. Strategies that perform well get amplified. Those that underperform get deprioritized or adjusted.</p>

<h2>Growth Automation vs. Manual Methods: A Comparison</h2>
<p>The difference between automated and manual growth becomes stark at scale:</p>
<ul>
<li><strong>Content velocity:</strong> Manual teams produce 5-10 pages/month. Automated systems can generate and publish 50-100 pages/month while maintaining quality through human review gates.</li>
<li><strong>Experiment throughput:</strong> Running 2-3 experiments per quarter manually versus 10-15 experiments per month with automation.</li>
<li><strong>Attribution accuracy:</strong> Manual UTM tracking captures maybe 60% of the journey. Automated fingerprinting with cross-channel stitching reaches 85-90% accuracy.</li>
<li><strong>Time to insight:</strong> Manual reporting takes 3-5 days per cycle. Automated dashboards update in real time.</li>
</ul>

<h2>Getting Started: Three Steps for Product Teams</h2>
<p>You do not need to automate everything on day one. Start with these three steps:</p>
<ol>
<li><strong>Audit your current workflow.</strong> Map every growth task your team performs weekly. Identify which tasks are repetitive, data-driven, and rule-based -- these are automation candidates.</li>
<li><strong>Pick one channel to automate first.</strong> SEO content generation is usually the best starting point because it has clear inputs (keywords, search intent) and measurable outputs (rankings, traffic). Start with a <a href="/templates">content template</a> and scale from there.</li>
<li><strong>Measure everything with UTMs.</strong> Before you can automate measurement, you need consistent tracking. Implement a UTM naming convention across all channels so attribution data is clean from day one.</li>
</ol>

<h2>Common Objections (and Why They Are Wrong)</h2>
<p><strong>"Automated content is low quality."</strong> This was true in 2022. Modern AI-assisted content generation, combined with human editorial review, produces content that matches or exceeds the quality of rushed manual drafts. The key is the review gate -- automation handles the first 80% of the work, and a human handles the final 20%.</p>
<p><strong>"We are too small to need automation."</strong> Small teams benefit the most. A two-person growth team with automation can match the output of a ten-person team without it. Automation is a force multiplier, not a luxury for large organizations.</p>
<p><strong>"We will lose the personal touch."</strong> Growth automation handles distribution and measurement. Your brand voice, strategic direction, and customer relationships remain human. The system executes; you decide what to execute.</p>

<h2>What to Read Next</h2>
<p>If you are ready to run your first automated growth experiment, read our <a href="/en/blog/growth-experiment-playbook">step-by-step playbook</a>. For teams focused on SEO specifically, our guide on <a href="/en/blog/programmatic-seo-at-scale">programmatic SEO</a> covers how to scale from 10 to 10,000 pages. And to see growth automation in action, check out our <a href="/en/blog/astrologywiki-case-study">case study on how astrologywiki.com grew from 0 to 5,000 users</a>.</p>`,
    category: "methodology",
    pillar_slug: "growth_automation",
    author: "GenGrowth Team",
    reading_time: 8,
    status: "published",
    published_at: ts(1, 15),
    updated_at: ts(2, 10),
    created_at: ts(1, 14),
  },

  // --- Post 2: Growth Experiment Playbook ---
  {
    id: "b1000001-0002-4000-8000-000000000001",
    slug: "growth-experiment-playbook",
    locale: "en",
    locale_exclusive: false,
    title:
      "How to Run Your First Growth Experiment: A Step-by-Step Playbook",
    excerpt:
      "Most growth experiments fail because they skip the boring parts: hypothesis formation, sample sizing, and measurement criteria. This playbook covers the full process from idea to iteration, with templates you can use today.",
    content: `<h2>Why Most Growth Experiments Fail</h2>
<p>According to data from Reforge and GrowthHackers, roughly 70-80% of growth experiments fail to produce statistically significant results. That number sounds discouraging, but it is actually expected -- the goal is not to win every experiment, but to run enough experiments that the winners compound. The problem is that most teams do not run enough experiments, and the experiments they do run are poorly designed.</p>
<p>The three most common failure modes are:</p>
<ul>
<li><strong>No clear hypothesis.</strong> "Let us try posting on Reddit" is not a hypothesis. "Posting value-first content on r/SaaS will drive 50 qualified visitors per post within 7 days" is a hypothesis.</li>
<li><strong>No success criteria defined upfront.</strong> If you do not decide what "success" looks like before you start, you will rationalize any result as a win or dismiss any result as inconclusive.</li>
<li><strong>Insufficient sample size.</strong> Running an A/B test with 200 visitors and declaring a winner is statistically meaningless. You need to calculate minimum sample sizes before launching.</li>
</ul>

<h2>Step 1: Form a Testable Hypothesis</h2>
<p>Every experiment starts with a hypothesis that follows this structure:</p>
<p><strong>"If we [take this action], then [this metric] will [change in this direction] by [this amount], because [this reasoning]."</strong></p>
<p>Examples:</p>
<ul>
<li>"If we add a product comparison table to our pricing page, then our pricing-to-signup conversion rate will increase by 15%, because visitors currently leave to compare us with competitors on third-party sites."</li>
<li>"If we publish 10 glossary pages targeting long-tail keywords, then organic traffic from informational queries will increase by 2,000 monthly visits within 60 days, because we currently have zero coverage for these terms and competition is low."</li>
</ul>
<p>Notice that each hypothesis includes a specific metric, a directional prediction, a magnitude estimate, and a causal reasoning. This specificity forces you to think clearly about what you are testing and why.</p>

<h2>Step 2: Define Success and Failure Criteria</h2>
<p>Before running any experiment, write down three things:</p>
<ol>
<li><strong>Primary metric:</strong> The one number that determines success or failure. For SEO experiments, this is usually organic traffic or keyword rankings. For social experiments, it is click-through rate or qualified visits. For conversion experiments, it is the conversion rate itself.</li>
<li><strong>Minimum detectable effect (MDE):</strong> The smallest change that would be practically meaningful. A 0.1% increase in conversion rate might be statistically significant but practically worthless if it does not move revenue. Define the threshold that makes the experiment worth the effort.</li>
<li><strong>Guardrail metrics:</strong> Secondary metrics that must not degrade. If you are testing a more aggressive CTA, your primary metric might be click-through rate, but your guardrail should be bounce rate. If CTR goes up but bounce rate also spikes, the experiment is not a real win.</li>
</ol>

<h2>Step 3: Calculate Sample Size</h2>
<p>For A/B tests and conversion experiments, sample size determines how long you need to run the experiment. The formula depends on three inputs:</p>
<ul>
<li>Baseline conversion rate (your current rate)</li>
<li>Minimum detectable effect (from Step 2)</li>
<li>Statistical power (typically 80%) and significance level (typically 95%)</li>
</ul>
<p>For a baseline conversion rate of 3% and an MDE of 20% relative improvement (to 3.6%), you need approximately 14,500 visitors per variation at 80% power and 95% significance. If your page gets 1,000 visitors per day, that is about 29 days for a two-variation test.</p>
<p>For content and SEO experiments, sample size works differently. You typically need 60-90 days of data to see organic traffic effects, because Google takes time to crawl, index, and rank new content. Plan your measurement window accordingly.</p>

<h2>Step 4: Design the Experiment</h2>
<p>Keep experiments as simple as possible. Test one variable at a time. Multi-variate tests sound sophisticated but require exponentially more traffic and introduce confounding variables.</p>
<p>Document the experiment design using this template:</p>
<ul>
<li><strong>Hypothesis:</strong> [from Step 1]</li>
<li><strong>Primary metric:</strong> [from Step 2]</li>
<li><strong>Guardrail metrics:</strong> [from Step 2]</li>
<li><strong>Duration:</strong> [from Step 3]</li>
<li><strong>Control:</strong> What the current experience looks like</li>
<li><strong>Treatment:</strong> What the new experience looks like</li>
<li><strong>Targeting:</strong> Which users see the experiment (all, new only, segment-specific)</li>
<li><strong>Rollback plan:</strong> How to revert if something breaks</li>
</ul>

<h2>Step 5: Execute with Tracking</h2>
<p>Every experiment needs clean attribution. At minimum:</p>
<ul>
<li>Use unique UTM parameters for each treatment: <code>utm_campaign=exp_001&amp;utm_content=treatment_a</code></li>
<li>Log experiment assignment in your analytics system (Google Analytics 4, Mixpanel, or Amplitude)</li>
<li>Set up a real-time dashboard so you can monitor for anomalies (crashes, tracking failures, extreme outliers)</li>
</ul>
<p>GenGrowth automates this through its <a href="/features">execution pipeline</a>, which assigns UTM fingerprints to every piece of content and tracks performance automatically.</p>

<h2>Step 6: Measure and Analyze</h2>
<p>When the experiment reaches its planned duration or sample size, analyze results using this checklist:</p>
<ol>
<li>Did the primary metric change in the predicted direction?</li>
<li>Is the change statistically significant (p &lt; 0.05)?</li>
<li>Is the change practically significant (exceeds your MDE)?</li>
<li>Did any guardrail metrics degrade?</li>
<li>Are there segment-level differences (e.g., works for new users but not returning users)?</li>
</ol>
<p>If the answers are yes, yes, yes, no, and consistent across segments, you have a winner. Ship it.</p>

<h2>Step 7: Iterate</h2>
<p>Every experiment generates learnings, regardless of outcome:</p>
<ul>
<li><strong>Winner:</strong> Ship the treatment and design a follow-up experiment to push the metric further.</li>
<li><strong>Loser:</strong> Document why the hypothesis was wrong. Was the reasoning flawed, or was the execution imperfect? Revise the hypothesis and test again.</li>
<li><strong>Inconclusive:</strong> Increase sample size or extend duration. If still inconclusive, the effect is likely too small to matter -- move on to higher-impact experiments.</li>
</ul>

<h2>Experiment Velocity Benchmarks</h2>
<p>The best growth teams run 8-12 experiments per month across all channels. Early-stage startups with limited traffic should focus on 3-4 experiments per month, prioritizing high-impact channels. The key metric is not win rate -- it is experiment velocity. Teams that run more experiments learn faster and compound their advantages.</p>
<p>For more on how to set up the measurement infrastructure that makes rapid experimentation possible, see our guide on <a href="/en/blog/marketing-attribution-models">marketing attribution models</a>. And for a real-world example of experimentation in action, read our <a href="/en/blog/social-first-week-1">Week 1 experiment report on social-first content distribution</a>.</p>`,
    category: "methodology",
    pillar_slug: "experiment_driven",
    author: "GenGrowth Team",
    reading_time: 9,
    status: "published",
    published_at: ts(2, 1),
    updated_at: ts(2, 20),
    created_at: ts(1, 30),
  },

  // --- Post 3: Marketing Attribution Models ---
  {
    id: "b1000001-0003-4000-8000-000000000001",
    slug: "marketing-attribution-models",
    locale: "en",
    locale_exclusive: false,
    title:
      "Marketing Attribution Explained: Which Model Fits Your Product?",
    excerpt:
      "Attribution determines how you allocate credit across marketing touchpoints. Choosing the wrong model leads to misallocated budgets and false confidence in underperforming channels. Here is how to pick the right one.",
    content: `<h2>What Attribution Really Means</h2>
<p>Marketing attribution is the process of assigning credit for a conversion to the marketing touchpoints that influenced it. When a user signs up for your product, which of the 7 interactions they had with your brand over the past 30 days actually mattered? The answer depends on which attribution model you use -- and different models give very different answers.</p>
<p>Attribution matters because it determines where you spend money. If your last-click model says paid search drives 80% of conversions, you will invest heavily in paid search. But if those users first discovered you through a blog post (organic), then saw a social proof thread (social), then clicked a retargeting ad (paid) -- the real driver was organic content, not paid search. Last-click just gets the credit because it happened to be the final touchpoint.</p>

<h2>The Six Major Attribution Models</h2>

<h3>1. Last-Click Attribution</h3>
<p>The simplest and most common model. 100% of credit goes to the last touchpoint before conversion.</p>
<p><strong>Pros:</strong> Easy to implement. Every analytics tool supports it by default. Clear and unambiguous.</p>
<p><strong>Cons:</strong> Massively overvalues bottom-funnel channels (branded search, retargeting, direct) and undervalues top-funnel channels (content, social, awareness). It tells you what closed the deal, but not what created the opportunity.</p>
<p><strong>Best for:</strong> Simple funnels with 1-2 touchpoints, or as a baseline to compare against other models.</p>

<h3>2. First-Click Attribution</h3>
<p>100% of credit goes to the first touchpoint that introduced the user to your brand.</p>
<p><strong>Pros:</strong> Properly values awareness and discovery channels. Useful for understanding where new users come from.</p>
<p><strong>Cons:</strong> Ignores everything that happens after discovery. A user might discover you via a blog post but not convert until six touchpoints later -- first-click would credit only the blog post.</p>
<p><strong>Best for:</strong> Teams focused on top-of-funnel growth and user acquisition.</p>

<h3>3. Linear Attribution</h3>
<p>Equal credit distributed across all touchpoints. If there were 5 touchpoints, each gets 20%.</p>
<p><strong>Pros:</strong> Acknowledges that every touchpoint plays a role. No channel is completely ignored.</p>
<p><strong>Cons:</strong> Treats all touchpoints as equally important, which is rarely true. A casual blog visit and a demo request are not equal signals of intent.</p>
<p><strong>Best for:</strong> Teams with limited data who want a balanced view without the biases of single-touch models.</p>

<h3>4. Time-Decay Attribution</h3>
<p>More credit goes to touchpoints closer to the conversion event. Earlier touchpoints get exponentially less credit.</p>
<p><strong>Pros:</strong> Reflects the intuition that recent interactions matter more than distant ones. Balances between single-touch and equal-weight models.</p>
<p><strong>Cons:</strong> Undervalues awareness channels, though less severely than last-click. The decay rate is somewhat arbitrary.</p>
<p><strong>Best for:</strong> B2B products with long sales cycles (30-90 days) where nurturing touchpoints matter but recency correlates with intent.</p>

<h3>5. Position-Based (U-Shaped) Attribution</h3>
<p>40% credit to the first touchpoint, 40% to the last touchpoint, and the remaining 20% distributed equally among middle touchpoints.</p>
<p><strong>Pros:</strong> Values both discovery and conversion while acknowledging the middle funnel. Widely considered the best default model for most products.</p>
<p><strong>Cons:</strong> The 40/40/20 split is arbitrary. Some funnels have critical mid-funnel touchpoints (like a product demo or case study view) that deserve more than their proportional share.</p>
<p><strong>Best for:</strong> Most B2B SaaS products and any product with a multi-touch funnel.</p>

<h3>6. Data-Driven Attribution</h3>
<p>Uses machine learning to calculate the actual contribution of each touchpoint based on your conversion data. Google Analytics 4 offers this natively for accounts with sufficient data volume.</p>
<p><strong>Pros:</strong> Most accurate. Adapts to your specific funnel and user behavior. No arbitrary assumptions.</p>
<p><strong>Cons:</strong> Requires significant data volume (typically 600+ conversions per month). Black-box -- hard to explain why the model assigns credit the way it does.</p>
<p><strong>Best for:</strong> Products with high traffic and conversion volume that need precise channel optimization.</p>

<h2>Channel Isolation: The Missing Piece</h2>
<p>Attribution models tell you which touchpoints get credit, but they do not tell you what would have happened without a specific channel. This is where channel isolation experiments come in.</p>
<p>A channel isolation test works like this: temporarily pause spend or activity on one channel and measure the impact on conversions. If you pause paid search and conversions drop by 5%, paid search is driving at most 5% of incremental conversions -- regardless of what your attribution model says.</p>
<p>GenGrowth uses <a href="/features">UTM fingerprinting</a> to enable lightweight channel isolation. Every piece of content gets a unique fingerprint, allowing you to trace the exact contribution of each channel without black-box models.</p>

<h2>UTM Parameters: The Foundation</h2>
<p>No attribution model works without clean tracking data. UTM parameters are the foundation:</p>
<ul>
<li><strong>utm_source:</strong> Where the traffic comes from (google, reddit, newsletter)</li>
<li><strong>utm_medium:</strong> The marketing medium (organic, social, email, paid)</li>
<li><strong>utm_campaign:</strong> The specific campaign or experiment</li>
<li><strong>utm_content:</strong> Differentiates variations within a campaign</li>
<li><strong>utm_term:</strong> The keyword for paid search campaigns</li>
</ul>
<p>Consistency is critical. If one team member uses "utm_source=Reddit" and another uses "utm_source=reddit", your attribution data fractures. Establish a naming convention document and enforce it across all channels.</p>

<h2>Choosing the Right Model for Your Stage</h2>
<p>Your attribution model should match your growth stage:</p>
<ul>
<li><strong>Pre-product-market-fit (0-1,000 users):</strong> Use first-click attribution. You need to understand which channels drive awareness. Conversion optimization is premature.</li>
<li><strong>Early growth (1,000-10,000 users):</strong> Switch to position-based (U-shaped). You now have enough touchpoints to see the full funnel. Track both acquisition and conversion channels.</li>
<li><strong>Scale (10,000+ users):</strong> Move to data-driven attribution if you have the volume. Supplement with channel isolation tests quarterly to validate model accuracy.</li>
</ul>

<h2>What to Read Next</h2>
<p>For a practical example of attribution in action, see our <a href="/en/blog/social-first-week-1">Week 1 social experiment report</a> where we tracked attribution across Reddit, X, and LinkedIn. To understand how programmatic SEO generates the content that feeds your attribution funnel, read our <a href="/en/blog/programmatic-seo-at-scale">guide on scaling SEO pages</a>.</p>`,
    category: "methodology",
    pillar_slug: "attribution",
    author: "GenGrowth Team",
    reading_time: 10,
    status: "published",
    published_at: ts(2, 10),
    updated_at: ts(3, 1),
    created_at: ts(2, 8),
  },

  // --- Post 4: AstrologyWiki Case Study ---
  {
    id: "b1000001-0004-4000-8000-000000000001",
    slug: "astrologywiki-case-study",
    locale: "en",
    locale_exclusive: false,
    title:
      "From 0 to 5,000 Users: How astrologywiki.com Grew with GenGrowth",
    excerpt:
      "A detailed case study of how astrologywiki.com went from a blank domain to 5,000 monthly active users in 14 weeks using GenGrowth's discovery-to-execution pipeline. Real numbers, real strategy, real results.",
    content: `<h2>The Starting Point</h2>
<p>In January 2026, astrologywiki.com was a blank canvas. The domain had been registered for two years but had zero indexed pages, zero backlinks, and zero organic traffic. The founder, a former astrology app product manager, had deep domain expertise but no growth team, no content pipeline, and no marketing budget beyond the GenGrowth subscription.</p>
<p>The goal was clear: reach 5,000 monthly active users within 90 days, entirely through organic channels. No paid ads, no influencer deals, no PR agency. Just content, search, and social.</p>

<h2>Phase 1: Discovery (Weeks 1-2)</h2>
<p>GenGrowth's Discovery Engine ran a comprehensive audit of the astrology content landscape. The findings shaped the entire strategy:</p>
<ul>
<li><strong>Keyword universe:</strong> 4,200 astrology-related keywords with a combined monthly search volume of 12.8 million. Competition ranged from low (long-tail terms like "mercury retrograde effects on taurus") to extremely high (head terms like "horoscope").</li>
<li><strong>Content gap analysis:</strong> The top 5 competitors had an average of 340 indexed pages each. astrologywiki.com had zero. The gap was massive but also presented opportunity -- many long-tail topics were underserved.</li>
<li><strong>Social signal scan:</strong> Reddit's r/astrology had 1.2 million members. Astrology-related discussions on X averaged 45,000 posts per day. The audience was active, engaged, and looking for authoritative content.</li>
</ul>
<p>The Discovery Engine scored 186 opportunity items and surfaced the top 30 by composite priority score (combining search volume, competition difficulty, and conversion potential).</p>

<h2>Phase 2: Strategy (Week 3)</h2>
<p>Based on the discovery data, GenGrowth generated a three-pronged strategy:</p>
<h3>Content Cluster Strategy</h3>
<p>Build topical authority through interconnected content clusters. The strategy identified three pillar topics:</p>
<ol>
<li><strong>Birth Chart Interpretation</strong> (1 pillar page + 12 supporting articles covering each zodiac sign)</li>
<li><strong>Planetary Transits</strong> (1 pillar page + 8 supporting articles covering major planets)</li>
<li><strong>Zodiac Compatibility</strong> (1 pillar page + 24 supporting articles covering all sign pairings)</li>
</ol>
<p>Total planned content: 49 pages across three clusters, designed to build topical authority with Google and capture long-tail traffic.</p>

<h3>Social Seeding Strategy</h3>
<p>Post value-first content on Reddit (r/astrology, r/AskAstrologers) and X to drive initial traffic while SEO ramped up. Each social post would link to a relevant wiki page, creating a virtuous cycle of traffic and engagement signals.</p>

<h3>Internal Linking Architecture</h3>
<p>Every supporting article would link to its pillar page and to 2-3 related supporting articles. Pillar pages would link to all supporting articles. This hub-and-spoke structure signals topical depth to search engines.</p>

<h2>Phase 3: Execution (Weeks 4-12)</h2>
<p>With the strategy approved, GenGrowth's execution agents went to work:</p>

<h3>Content Production</h3>
<ul>
<li>Weeks 4-6: Published all 3 pillar pages and 15 supporting articles (averaging 5 per week)</li>
<li>Weeks 7-9: Published remaining 29 supporting articles and added 12 glossary entries</li>
<li>Weeks 10-12: Published 8 additional articles based on trending search queries identified during the campaign</li>
</ul>
<p>Total published content: 67 pages. Average word count: 1,800 words. Every article was reviewed by the founder for accuracy before publication.</p>

<h3>Social Distribution</h3>
<ul>
<li>Reddit: 34 posts across 3 subreddits. Average engagement rate: 6.2% (vs. subreddit baseline of 1.5%)</li>
<li>X: 48 threads on astrology topics. Average impressions: 2,800 per thread</li>
<li>Total social-driven visits: 8,400 in the first 8 weeks</li>
</ul>

<h3>Link Building</h3>
<p>GenGrowth's link outreach agent identified 45 potential link partners (astrology blogs, new-age websites, educational resources). Of those, 12 resulted in earned backlinks (27% conversion rate). The site's Domain Rating went from 0 to 18 over the 12-week period.</p>

<h2>Results: 14 Weeks Later</h2>
<p>By week 14, astrologywiki.com had achieved:</p>
<ul>
<li><strong>5,247 monthly active users</strong> (target: 5,000)</li>
<li><strong>67 indexed pages</strong> in Google (all ranking)</li>
<li><strong>847 ranking keywords</strong> in Google, including 23 in top-10 positions</li>
<li><strong>12,400 monthly organic sessions</strong> (from zero)</li>
<li><strong>Domain Rating 18</strong> (from zero)</li>
<li><strong>Average time on page: 4 minutes 12 seconds</strong> (indicating high content quality)</li>
</ul>
<p>The breakdown by traffic source:</p>
<ul>
<li>Organic search: 62% (7,688 sessions)</li>
<li>Social (Reddit + X): 24% (2,976 sessions)</li>
<li>Direct: 11% (1,364 sessions)</li>
<li>Referral (backlinks): 3% (372 sessions)</li>
</ul>

<h2>Key Learnings</h2>
<p>Several insights from this case study apply to any product starting from zero:</p>
<ol>
<li><strong>Content clusters beat isolated pages.</strong> The three cluster pillar pages ranked significantly faster than standalone articles. Google's topical authority signals are real and measurable.</li>
<li><strong>Social and SEO are complementary, not competing.</strong> Social drove early traffic (weeks 1-6) while SEO ramped up. By week 10, organic surpassed social -- but the social engagement signals likely accelerated ranking velocity.</li>
<li><strong>Long-tail keywords are the entry point.</strong> The site's first page-1 rankings were all long-tail (4+ word queries). Head terms started ranking only after the site demonstrated topical authority through breadth of coverage.</li>
<li><strong>Human review is non-negotiable for niche content.</strong> Astrology has specific conventions and sensitivities. The founder's review of every article ensured accuracy and authenticity. Automation handled volume; human expertise handled quality.</li>
</ol>

<h2>Try It Yourself</h2>
<p>astrologywiki.com's growth was driven entirely by GenGrowth's discovery-to-execution pipeline. The founder spent approximately 5 hours per week on content review and strategy approval. Everything else -- discovery, content generation, social distribution, link outreach, and measurement -- was automated.</p>
<p>To start your own growth journey, explore <a href="/features">GenGrowth's features</a> or read our <a href="/en/blog/what-is-growth-automation">complete guide to growth automation</a>.</p>`,
    category: "case_study",
    pillar_slug: "customer_stories",
    author: "GenGrowth Team",
    reading_time: 10,
    status: "published",
    published_at: ts(2, 20),
    updated_at: ts(3, 5),
    created_at: ts(2, 18),
  },

  // --- Post 5: Programmatic SEO ---
  {
    id: "b1000001-0005-4000-8000-000000000001",
    slug: "programmatic-seo-at-scale",
    locale: "en",
    locale_exclusive: false,
    title: "Programmatic SEO: How to Scale from 10 to 10,000 Pages",
    excerpt:
      "Programmatic SEO uses templates and structured data to generate thousands of search-optimized pages. This guide covers the strategy, technical implementation, and common pitfalls -- with real examples from GenGrowth's content engine.",
    content: `<h2>What Programmatic SEO Is (and Is Not)</h2>
<p>Programmatic SEO is the practice of generating large volumes of search-optimized pages using templates, structured data, and automation. Instead of manually writing each page, you define a template once and populate it with data at scale.</p>
<p>Think about how Yelp has a page for every restaurant in every city, or how Zillow has a page for every property listing. These are not hand-crafted pages -- they are template-driven pages populated with structured data. The same approach works for SaaS companies, content sites, and marketplaces.</p>
<p>What programmatic SEO is not: spam. The difference between a high-quality programmatic page and a thin doorway page is value. Each page must answer a genuine search query with useful, accurate information. Google's helpful content update specifically targets pages that exist only for search engines, not users. Your programmatic pages need to serve real user needs.</p>

<h2>Three Strategies for Programmatic SEO</h2>

<h3>Strategy 1: Glossary and Knowledge Base</h3>
<p>The simplest entry point. Create a page for every important term, concept, or entity in your domain. Each page follows a consistent template: definition, detailed explanation, related terms, and a call-to-action linking to your product.</p>
<p>GenGrowth's <a href="/glossary">growth glossary</a> uses this approach. Each term has a standardized page covering definition, context, measurement, and related concepts. The template ensures consistency while the content is unique to each term.</p>
<p><strong>Scale potential:</strong> 50-500 pages for most B2B products, covering industry jargon, methodologies, and concepts.</p>

<h3>Strategy 2: Comparison and Alternative Pages</h3>
<p>Create pages comparing your product with competitors, or comparing two related tools/approaches. These target high-intent search queries like "tool A vs tool B" or "best alternatives to X."</p>
<p>The template includes: a feature comparison table, pricing comparison, use case recommendations, and an honest assessment of strengths and weaknesses. Honesty builds trust -- if your competitor is better at something, say so. Users will trust your recommendation on the things you are actually better at.</p>
<p><strong>Scale potential:</strong> 20-200 pages depending on the number of competitors and adjacent tools in your market.</p>

<h3>Strategy 3: Location or Segment Pages</h3>
<p>If your product serves different markets, industries, or regions, create dedicated pages for each. A project management tool could have pages for "project management for construction," "project management for agencies," "project management for startups" -- each with segment-specific content, testimonials, and feature highlights.</p>
<p><strong>Scale potential:</strong> 50-5,000+ pages depending on the number of segments.</p>

<h2>Technical Implementation</h2>
<p>Building programmatic SEO at scale requires four technical components:</p>

<h3>1. Data Layer</h3>
<p>You need structured data for every page you want to generate. This could be a database table, a spreadsheet, or an API. The data should include:</p>
<ul>
<li>Primary entity (the term, competitor, location, or segment)</li>
<li>Unique content fields (definition, description, key features)</li>
<li>Metadata (search volume, competition, related entities)</li>
<li>SEO fields (title tag, meta description, canonical URL)</li>
</ul>

<h3>2. Template Engine</h3>
<p>Design page templates that render structured data into full HTML pages. Each template should include:</p>
<ul>
<li>Unique H1 incorporating the primary entity</li>
<li>Structured content sections (each with unique text, not just entity-name substitution)</li>
<li>Internal links to related pages (both within the programmatic set and to manually created content)</li>
<li>Schema.org structured data for rich snippets</li>
</ul>
<p>The critical rule: every page must have substantive unique content beyond just the entity name. "Growth automation is a type of automation used for growth" is not unique content. Each page needs genuine, useful information specific to that entity.</p>

<h3>3. Crawl and Index Management</h3>
<p>When you publish thousands of pages at once, you need to manage how search engines discover and index them:</p>
<ul>
<li><strong>XML sitemaps:</strong> Generate and submit sitemaps that include all programmatic pages. For large sites, use sitemap index files that reference multiple sitemaps (max 50,000 URLs per sitemap).</li>
<li><strong>Internal linking:</strong> Every programmatic page should be reachable within 3 clicks from the homepage. Use category pages, tag pages, or hub pages to create navigable paths.</li>
<li><strong>Pagination:</strong> For listing pages, implement proper pagination with rel="prev" and rel="next" (or load-more patterns for modern crawlers).</li>
<li><strong>Robots.txt:</strong> Ensure programmatic page paths are not blocked. Check crawl stats in Google Search Console to verify pages are being discovered.</li>
</ul>

<h3>4. Quality Assurance Pipeline</h3>
<p>Automated content needs automated quality checks:</p>
<ul>
<li>Word count minimums (300+ words of unique content per page)</li>
<li>Duplicate content detection (compare each page against existing pages using similarity scoring)</li>
<li>Broken link checks (ensure all internal links resolve)</li>
<li>Schema validation (test structured data with Google's Rich Results Test)</li>
<li>Mobile rendering verification</li>
</ul>

<h2>Common Pitfalls (and How to Avoid Them)</h2>
<p><strong>Thin content at scale.</strong> If your template produces pages with only 100 words of unique content, Google will flag them as thin or duplicate. Invest in content quality for each entity. GenGrowth solves this by generating substantive, entity-specific content for each page rather than simple template substitution.</p>
<p><strong>Cannibalization.</strong> When multiple programmatic pages target similar keywords, they compete with each other. Use keyword mapping to ensure each page targets a distinct primary keyword. Monitor Search Console for pages that rank for the same queries and consolidate where needed.</p>
<p><strong>Orphan pages.</strong> Pages that are not linked from anywhere on your site are effectively invisible to search engines. Ensure every programmatic page is linked from at least one category or hub page.</p>
<p><strong>Ignoring user intent.</strong> A page that matches a keyword but does not answer the user's question will have high bounce rates, which signals to Google that the page is not useful. Map each page to a specific user intent and ensure the content addresses that intent directly.</p>

<h2>Scaling with GenGrowth</h2>
<p>GenGrowth's content engine automates the programmatic SEO pipeline end-to-end. The Discovery Engine identifies entity opportunities (keywords, terms, segments). The Strategy module prioritizes them by estimated traffic value. And the Execution pipeline generates, reviews, and publishes pages using templates you approve.</p>
<p>For a real-world example of programmatic SEO in action, see how <a href="/en/blog/astrologywiki-case-study">astrologywiki.com scaled to 67 pages and 5,000 users in 14 weeks</a>. To understand the measurement framework that tracks programmatic SEO performance, read our <a href="/en/blog/marketing-attribution-models">guide on marketing attribution models</a>.</p>`,
    category: "methodology",
    pillar_slug: "seo_content",
    author: "GenGrowth Team",
    reading_time: 9,
    status: "published",
    published_at: ts(3, 1),
    updated_at: ts(3, 10),
    created_at: ts(2, 28),
  },

  // --- Post 6: Social-First Week 1 Report ---
  {
    id: "b1000001-0006-4000-8000-000000000001",
    slug: "social-first-week-1",
    locale: "en",
    locale_exclusive: false,
    title: "Week 1 Experiment Report: Social-First Content Distribution",
    excerpt:
      "We hypothesized that social channels could validate content topics before investing in long-form SEO articles. Here is what happened when we tested Reddit, X, and LinkedIn with identical content angles across 3 topics.",
    content: `<h2>Experiment Overview</h2>
<p>This is the first weekly experiment report in our build-in-public series. Each week, we run a structured growth experiment, measure results, and share findings openly -- including failures.</p>
<p><strong>Hypothesis:</strong> Social channels (Reddit, X, LinkedIn) can validate content topic resonance within 7 days, providing signal for which topics to invest in for long-form SEO content. Topics that achieve above-baseline engagement on social will also perform above-average in organic search.</p>
<p><strong>Experiment duration:</strong> 7 days (March 3-9, 2026)</p>
<p><strong>Primary metric:</strong> Engagement rate per platform (comments + clicks / impressions)</p>
<p><strong>Secondary metrics:</strong> Click-through rate to landing page, time on page from social referral, email signups from social traffic</p>

<h2>Setup</h2>
<p>We selected 3 content topics from GenGrowth's discovery pipeline, each representing a different content pillar:</p>
<ol>
<li><strong>Topic A:</strong> "The 80/20 of Growth Automation" (pillar: growth_automation)</li>
<li><strong>Topic B:</strong> "Why Most A/B Tests Are Statistically Invalid" (pillar: experiment_driven)</li>
<li><strong>Topic C:</strong> "Attribution Is Broken -- Here Is What to Do Instead" (pillar: attribution)</li>
</ol>
<p>Each topic was adapted for three platforms with platform-specific formatting:</p>
<ul>
<li><strong>Reddit:</strong> Long-form text post with actionable takeaways. Posted in r/SaaS, r/startups, and r/GrowthHacking.</li>
<li><strong>X:</strong> Thread format (8-10 tweets) with a hook tweet and a CTA in the final tweet.</li>
<li><strong>LinkedIn:</strong> Professional narrative post (1,200 characters) with a document carousel.</li>
</ul>
<p>Every post included a unique UTM fingerprint for attribution tracking: <code>utm_campaign=social_first_w1&amp;utm_content=[topic]_[platform]</code></p>

<h2>Results by Platform</h2>

<h3>Reddit</h3>
<table>
<tr><th>Topic</th><th>Subreddit</th><th>Impressions</th><th>Engagement Rate</th><th>Clicks</th></tr>
<tr><td>A: Growth Automation</td><td>r/SaaS</td><td>3,200</td><td>7.1%</td><td>85</td></tr>
<tr><td>B: A/B Testing</td><td>r/startups</td><td>2,100</td><td>4.3%</td><td>42</td></tr>
<tr><td>C: Attribution</td><td>r/GrowthHacking</td><td>1,800</td><td>3.1%</td><td>28</td></tr>
</table>
<p><strong>Reddit baseline:</strong> 1.5% engagement rate for text posts in these subreddits.</p>
<p><strong>Analysis:</strong> All three topics exceeded the baseline. Topic A significantly outperformed, likely because r/SaaS has a high concentration of founders actively looking for growth solutions. The engagement was genuine -- 12 substantive comments on Topic A, with several asking for more detail on automation workflows.</p>

<h3>X (Twitter)</h3>
<table>
<tr><th>Topic</th><th>Impressions</th><th>Engagement Rate</th><th>Link Clicks</th></tr>
<tr><td>A: Growth Automation</td><td>4,800</td><td>2.1%</td><td>34</td></tr>
<tr><td>B: A/B Testing</td><td>6,200</td><td>3.4%</td><td>62</td></tr>
<tr><td>C: Attribution</td><td>3,100</td><td>1.8%</td><td>18</td></tr>
</table>
<p><strong>X baseline:</strong> 2.0% engagement rate for thread posts in the SaaS/growth niche.</p>
<p><strong>Analysis:</strong> Interesting divergence from Reddit. Topic B performed strongest on X, while Topic A dominated Reddit. The thread format for Topic B ("Why Most A/B Tests Are Statistically Invalid") resonated because it was contrarian and educational -- two attributes that X's algorithm rewards. Topic C underperformed on both platforms, suggesting attribution as a topic may be too niche for broad social audiences.</p>

<h3>LinkedIn</h3>
<table>
<tr><th>Topic</th><th>Impressions</th><th>Engagement Rate</th><th>Link Clicks</th></tr>
<tr><td>A: Growth Automation</td><td>1,400</td><td>4.2%</td><td>22</td></tr>
<tr><td>B: A/B Testing</td><td>1,100</td><td>3.8%</td><td>16</td></tr>
<tr><td>C: Attribution</td><td>980</td><td>5.1%</td><td>24</td></tr>
</table>
<p><strong>LinkedIn baseline:</strong> 3.0% engagement rate for organic posts in the marketing/growth niche.</p>
<p><strong>Analysis:</strong> Surprising result: Topic C (Attribution) performed best on LinkedIn, despite underperforming on Reddit and X. LinkedIn's audience skews toward marketing professionals who deal with attribution challenges daily. This suggests that attribution content should be distributed primarily through LinkedIn and SEO, not Reddit or X.</p>

<h2>Cross-Platform Attribution</h2>
<p>Using GenGrowth's UTM fingerprint tracking, we traced social visitors through to on-site behavior:</p>
<ul>
<li><strong>Reddit visitors:</strong> Average time on page 3:42, bounce rate 38%, email signup rate 2.8%</li>
<li><strong>X visitors:</strong> Average time on page 1:54, bounce rate 62%, email signup rate 0.9%</li>
<li><strong>LinkedIn visitors:</strong> Average time on page 4:15, bounce rate 31%, email signup rate 3.4%</li>
</ul>
<p>Despite having the lowest raw traffic volume, LinkedIn delivered the highest quality visitors by every on-site metric. Reddit was second. X drove the most impressions but the lowest quality traffic -- consistent with the platform's scroll-heavy, low-attention usage pattern.</p>

<h2>Decisions</h2>
<p>Based on Week 1 data, we are making the following strategic decisions for Week 2:</p>
<ol>
<li><strong>Double down on Reddit for growth automation content.</strong> Topic A's 7.1% engagement rate is 4.7x baseline. We will publish 3 more posts on related growth automation subtopics.</li>
<li><strong>Use X for contrarian/educational content only.</strong> Topic B's strong performance suggests X rewards provocative, myth-busting content. We will format future X threads around "Why [common belief] is wrong" angles.</li>
<li><strong>Shift attribution content to LinkedIn.</strong> Topic C found its audience on LinkedIn. We will invest in LinkedIn document carousels for attribution-related content.</li>
<li><strong>Deprioritize Topic C for SEO.</strong> Despite LinkedIn success, the overall cross-platform engagement for attribution content was mixed. We will write the long-form SEO article but defer it behind Topics A and B in the content calendar.</li>
<li><strong>Invest in long-form content for Topic A first.</strong> Validated across Reddit and LinkedIn, growth automation has the clearest demand signal. The pillar article will be published in Week 2.</li>
</ol>

<h2>Next Steps</h2>
<p>Week 2 experiment will test content repurposing: taking the Topic A pillar article and distributing excerpts across social channels to measure whether long-form-first or social-first generates more total engagement.</p>
<p>Follow our build-in-public journey in the <a href="/en/blog?category=weekly-review">weekly review archive</a>. For the methodology behind our experiment design, see our <a href="/en/blog/growth-experiment-playbook">growth experiment playbook</a>.</p>`,
    category: "weekly_review",
    pillar_slug: "experiment_driven",
    author: "GenGrowth Team",
    reading_time: 8,
    status: "published",
    published_at: ts(3, 10),
    updated_at: ts(3, 10),
    created_at: ts(3, 9),
  },

  // --- Post 7: AstrologyWiki Zero to 5,000 Case Study (New) ---
  {
    id: "b1000001-0007-4000-8000-000000000001",
    slug: "astrologywiki-zero-to-5000-users",
    locale: "en",
    locale_exclusive: false,
    title:
      "From Zero to 5,000 Users: How GenGrowth Automated Growth for AstrologyWiki",
    excerpt:
      "AstrologyWiki went from zero organic traffic to 5,000+ monthly users in 6 months. This case study breaks down how GenGrowth's Social-First validation, multi-touch attribution, and self-optimization loop made it happen -- with real metrics and the strategic decisions behind each phase.",
    content: ASTROLOGYWIKI_CONTENT_EN,
    category: "case_study",
    pillar_slug: "customer_stories",
    author: "GenGrowth Team",
    reading_time: 12,
    status: "published",
    published_at: ts(3, 15),
    updated_at: ts(3, 15),
    created_at: ts(3, 14),
  },
];
