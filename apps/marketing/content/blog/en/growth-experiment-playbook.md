---
title: How to Run Your First Growth Experiment: A Step-by-Step Playbook
excerpt: Most growth experiments fail because they skip the boring parts: hypothesis formation, sample sizing, and measurement criteria. This playbook covers the full process from idea to iteration, with templates you can use today.
author: GenGrowth Team
category: methodology
pillar: experiment_driven
status: published
publishedAt: 2026-02-01
updatedAt: 2026-02-20
heroImage: /images/blog/growth-experiment-playbook.jpg
heroImageAlt: An abstract editorial illustration for How to Run Your First Growth Experiment: A Step-by-Step Playbook
localeExclusive: false
---

<!-- Migrated losslessly from the legacy Supabase HTML body. New articles should use GFM Markdown. -->
<h2>Why Most Growth Experiments Fail</h2>
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
<li><strong>Primary metric:</strong> The one number that determines success or failure.</li>
<li><strong>Minimum detectable effect (MDE):</strong> The smallest change that would be practically meaningful.</li>
<li><strong>Guardrail metrics:</strong> Secondary metrics that must not degrade.</li>
</ol>

<h2>Step 3: Calculate Sample Size</h2>
<p>For A/B tests and conversion experiments, sample size determines how long you need to run the experiment. For a baseline conversion rate of 3% and an MDE of 20% relative improvement (to 3.6%), you need approximately 14,500 visitors per variation at 80% power and 95% significance.</p>
<p>For content and SEO experiments, you typically need 60-90 days of data to see organic traffic effects.</p>

<h2>Step 4: Design the Experiment</h2>
<p>Keep experiments as simple as possible. Test one variable at a time. Document the experiment design using this template:</p>
<ul>
<li><strong>Hypothesis:</strong> [from Step 1]</li>
<li><strong>Primary metric:</strong> [from Step 2]</li>
<li><strong>Guardrail metrics:</strong> [from Step 2]</li>
<li><strong>Duration:</strong> [from Step 3]</li>
<li><strong>Control:</strong> What the current experience looks like</li>
<li><strong>Treatment:</strong> What the new experience looks like</li>
<li><strong>Rollback plan:</strong> How to revert if something breaks</li>
</ul>

<h2>Step 5: Execute with Tracking</h2>
<p>Every experiment needs clean attribution. Use unique UTM parameters for each treatment. GenGrowth automates this through its <a href="/features">execution pipeline</a>.</p>

<h2>Step 6: Measure and Analyze</h2>
<p>When the experiment reaches its planned duration, analyze results using this checklist:</p>
<ol>
<li>Did the primary metric change in the predicted direction?</li>
<li>Is the change statistically significant (p &lt; 0.05)?</li>
<li>Is the change practically significant (exceeds your MDE)?</li>
<li>Did any guardrail metrics degrade?</li>
<li>Are there segment-level differences?</li>
</ol>

<h2>Step 7: Iterate</h2>
<ul>
<li><strong>Winner:</strong> Ship the treatment and design a follow-up experiment.</li>
<li><strong>Loser:</strong> Document why the hypothesis was wrong. Revise and test again.</li>
<li><strong>Inconclusive:</strong> Increase sample size or extend duration. If still inconclusive, move on.</li>
</ul>

<h2>Experiment Velocity Benchmarks</h2>
<p>The best growth teams run 8-12 experiments per month. Early-stage startups should focus on 3-4 per month. The key metric is experiment velocity, not win rate.</p>
<p>For more on measurement infrastructure, see our <a href="/blog/marketing-attribution-models">marketing attribution guide</a>. For a real-world example, read our <a href="/blog/social-first-week-1">Week 1 experiment report</a>.</p>
