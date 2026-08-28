# GEO 工具集 · 实施记录

设计与裁决见 `2026-08-29-marketing-geo-tools-design.md`。本文件按 PR 记录实际落地内容与验证证据。

## PR 1 · 页面可引用性检查（`/tools/page-citability-check`）

免登录，无 LLM 调用，三次有界抓取（页面 / robots.txt / llms.txt）。

**新增**

- `lib/geo-tools/stats.ts` — Wilson / pooled / Newcombe / BH，`describeProportion` 返回判别联合而非句子；`ZERO_CLAIM_UPPER_BOUND = 0.10`（D7），`minTrialsForZeroClaim()` 由该界反推页面上要印的 n，避免文案与判据漂移。计数非法（负数、非整数、successes > trials）直接抛 `RangeError`。
- `lib/geo-tools/citability-contract.ts` — 四态 `pass | fail | fetchError | notApplicable`、`counted | advisory` 权重、`RobotsFetch` / `LlmsTxtFetch` 三态、全部阈值常量。
- `lib/geo-tools/citability-text.ts` — HTML→文本投影（块级闭合标签变句号）、锚点位置留 `@@LINK@@` 标记、CJK/拉丁双轨分句与整词匹配、目标提问的内容词抽取。
- `lib/geo-tools/citability-rules.ts` — 14 行检查，11 行计入。
- `lib/geo-tools/citability-gate.ts` — 自有配额桶（匿名 20/IP/小时、登录 60、目标站 30），配额存储不可用时 fail-closed。
- `lib/geo-tools/citability-handler.ts`、`app/api/tools/page-citability-check/route.ts`（nodejs / 60s）。
- `components/tools/page-citability-check.tsx`、`app/[locale]/tools/page-citability-check/page.tsx`。
- i18n `tools.pageCitability`（en/zh 各 133 个叶子键）+ hub 的 GEO 分组文案。

**修正的共享代码**

`packages/sources/src/crawl/robots.ts`：RFC 9309 §2.2.2 的尾部 `$` 锚定原先在转义之后才被处理，等于把锚点变成字面美元符号——`Disallow: /*/private$` 于是只匹配真的以 `$` 结尾的路径。同时按 §2.2.1 合并同一 product token 的多个 record，并导出 `matchRobotsRule` 让检查器能报出命中的那一行。`docs/vendor/signalframe-manifest.json` 的 sha256 同步更新；同一次也补上了 `parse-page.ts` 早在 14adfb8c 就已漂移、但没人更新的哈希。

**与原方案的差异（都是评审结论）**

| 原方案 | 这里 | 理由 |
|---|---|---|
| 12 项，4 个 bot 全部计分 | 14 行，检索组 4 个计分、训练组 2 个仅展示 | GPTBot / Google-Extended 管训练语料，禁掉不影响被引用 |
| `robotsTxt: string \| null` | 三态 | 404 = RFC 全放行，5xx = 规则未知，两者结论相反 |
| 未触发渲染取即 `ssrRatio = 1` | 正文达标才 pass，不足则按脚本占比分成两种 fail | 旧写法让零正文的客户端渲染页判「通过」 |
| 「不适用」塞进 `fetchError` | 第四态 `notApplicable` | 没填提问不是抓取失败 |
| 引擎层直出中文句子 | `{key, values}` + i18n | `/en` 路由否则整页中文 |
| 无 FAQ 判 fail | 无 FAQ 判 notApplicable | 没有 FAQ 不是页面缺陷 |
| 年份出现即算「有来源」 | 同句内需链接或来源词，年份不算 | 旧写法让任何带年份的数字断言过关 |
| `T2_ANON_RATE_LIMIT` 20 与 crawl-gate 冲突 | 自有桶 20/60/30 | crawl-gate 是整站爬取闸门，且与审计工具共桶 |

**验证**：`pnpm test apps/marketing` 4530 通过 / 1 失败（`blog-content` 80 vs 83，`git stash` 对照确认为 main 既有红）；`pnpm typecheck` 全绿；`pnpm lint` 仅 `packages/public-tools` 两个既有错误；`pnpm --filter @sf/marketing build` 产出 `/en|/zh/tools/page-citability-check` 与 API 路由；`pnpm secrets:scan` 75 通过；`node scripts/verify-implementation.mjs` 的 vendor provenance 由红转绿。

## PR 1 · 评审后的修正

两轮对抗评审（5 个独立镜头 + 一次 codex）在合入前抓到的东西，按严重度记录。

**统计模块（合入前零消费者、零测试）**

- `MIN_TRIALS_FOR_TEST` 声明了从不执行。在这个工具真实的采样规模上，0/5 对 3/5 的 pooled z 检验给出 p = 0.038、在 q = 0.10 下被判显著，而同一张 2×2 表的 Fisher 精确检验是 0.167。一枚硬币两次落法不同，被同一个注释写着「存在就是为了防这件事」的模块报成了改善。门槛现在在 `twoProportionP` 内部执行。
- p 值与差值区间在小样本上互相矛盾：1/5 → 4/5 检验判显著，Newcombe 区间仍跨零。`changeVerdict` 把区间作为同一个判定里较硬的那一半。
- 42 题 × 5 次采样不是 210 次独立试验（同一题多半得到同一批答案），于是 7 道题就能凑够「n ≥ 35，可以印 0.0%」。`collapseGroupsToBernoulli` 把零观测判据的分母换成提问数。
- 观测到的成功在 n ≥ 2001 时会四舍五入成 0.0%。

**规则集（会对真实页面给出错误结论）**

- 截断的响应被当成完整文档：1.5MB 上限切在未闭合的 `<script>` 里，脚本源码变成「正文」，一个零正文的客户端渲染页报出 149 万字并判「首屏 HTML 含正文 · 通过」——正是这个工具立项要防的那个失败。`bodyComplete` 现在贯通到规则层，所有「不存在即失败」的判定在截断时降为读不到。
- 中文提问被整串当成一个词：「如何提高网站的转化率」要求页面逐字出现整句，差一个「的」就不命中，任何中文页面必然误报。改为重叠 bigram + 覆盖率门槛。
- `SOURCE_MARKERS` 用子串匹配：裸「据」命中数据/根据/证据，`cited` 是 `excited` 的子串，一个计分行近乎恒真。
- 嵌套列表让非贪婪正则在内层 `</ul>` 收口，纯列表的文档页判「没有可抽取结构」。改为按深度配对的扫描。
- 注释里的旧 canonical 抢在真 canonical 之前被采信；`<base href>` 被忽略；空 href 判「自指 · 通过」。markup 类规则现在读剥掉注释的投影。
- 日期剥离把 `$1999` 与 `2000 companies` 整个吃掉（页面明明有价格与客户数，却报「没有数字断言」）；限定条件被 ISO 日期、营业时间与电话号码满足。
- JSON-LD 用 `queue.push(...node)` 展开数组，124,158 个元素就栈溢出。

**HTTP 边界**

- robots 的 glob 编译成正则会灾难性回溯：一行 47 字符的 `Disallow` 实测单次 58 秒，×6 个 bot ≈ 350 秒，而 robots.txt 属于被检查的那个站点——对任何读别人站点的工具来说，它是攻击者可控输入。改为线性扫描（同一份用例现在 121ms 跑完 16 条）。
- 1.5MB 文档上的成对标签正则是 O(n²)，实测 114 秒，超过 `maxDuration = 60`；且同一份文本被投影了两次。
- 打错域名返回 502 并告诉用户「这个网址无法被安全抓取」。现在按语义分开：抓取被拒 422、超时 504、真正的传输失败才 502。
- 限流先扣 IP 再判目标：目标桶拒绝时用户自己的额度已经白扣，第三方流量可以把一个 IP 锁死一小时。改为先判目标。
- 每目标的桶记在提交的 host 上，而三次抓取实际落在重定向后的 host。落地后补扣一次。
- 单飞碰撞复用 `target_busy`，对一个从没被检查过的站点声称「已被检查 30 次」。
- 非 UTF-8 页面被硬解成 UTF-8，替换字符被算成「正文充足」判通过，同时中文词一个都匹配不上判失败——一次错误解码同时制造一个假通过和一个假失败。现在按声明的字符集拒绝。
- `fixes.leadAnswer` 需要 `{window}` 而代码不传，整行修复建议渲染成 `tools.pageCitability.fixes.leadAnswer` 这串键路径——而这是填了目标提问的用户最可能看到的一行。
- 限流文案对已登录用户印匿名档的数字并劝他登录；结果区相邻两行印出两个互相矛盾的「计入结论」数字；复制失败完全静默；`role="status"` 罩住整份报告导致每次按钮改字都重念 14 行。

## PR 2 · GEO 知识库（`/tools/geo-knowledge-base`）

需登录。品牌名与别名、品类词、买家角色、竞品的品牌名映射、已核实事实；冻结成不可变版本，并由它确定性地推导出问题集。

**新增**

- `supabase/migrations/0006_geo_knowledge_base.sql` — 三张表（站点 / 草稿 / append-only 快照）+ 三个 `SECURITY DEFINER` RPC。照 0005：RLS 开、零 policy，真正的边界是 `revoke ... from anon, authenticated, service_role` + 只经 RPC 写入；快照的不可变性由行级（update/delete）与语句级（truncate）两个触发器守住；冻结按内容幂等，双击不会分叉出第二个版本。
- `lib/geo-tools/kb-contract.ts` — 载荷类型与校验。规范 JSON 与 `marketing_canonical_jsonb_text` 逐字节一致；载荷里不允许出现数字，因为数字格式化正是 `JSON.stringify` 与 `jsonb::text` 唯一会合法分歧的地方。事实的两半规则在这里执行：有值必须有来源，无值必须有原因。
- `lib/geo-tools/kb-digest.ts` — sha256。单独一个文件，因为编辑器要 import 上面的上限常量，而 `node:crypto` 不能进浏览器包。
- `lib/geo-tools/kb-questions.ts` — 从冻结载荷推导问题集。检索层只从已标定模板渲染，渲染不出来就跳过而不是把值裁短塞进去；两条品牌词问题在这里拼装并标记为未测量，因为没有一条已标定模板会在不点名竞品的情况下说出客户自己的名字。
- `lib/geo-tools/kb-store.ts` — 唯一的服务端读写模块（由并行 agent 实现）。读回的载荷重新解析并重算摘要与行里的 `content_hash` 比对；冻结前先证明「这份提问集确实是从这份草稿推导出来的」，因为数据库只能证明哈希描述了这个提问集。
- `lib/geo-tools/kb-import.ts` — 从已确认的网站档案一次性预填。是复制不是联动；事实一条都不导入，因为档案没有来源 URL 与日期。
- `lib/geo-tools/kb-handler.ts` + `kb-handler-deps.ts` + 四个路由；`components/tools/geo-knowledge-base.tsx`；`app/[locale]/tools/geo-knowledge-base/page.tsx`；i18n `tools.geoKnowledgeBase`（en/zh 各 126 键）。
- `supabase/migrations/README-geo-tools-rollout.md` — Owner 手工执行 0006 的手册，每段冒烟 SQL 都实跑过。

**集成测试抓到的迁移缺陷**：freeze RPC 的 `returning revision` 与同名 OUT 参数冲突，Postgres 报 `column reference "revision" is ambiguous`——冻结会永远失败。已限定表名。

**已知偏离**：`kb-store.ts` 1106 行，超过「文件 < 800 行」的房规。拆法已经想好（Supabase 适配器与行映射各自成文件），但它带着 51 条测试且刚跑通，改在下一个 PR 做。

**验证**：`pnpm test apps/marketing` 4647 通过 / 1 失败（`blog-content`，main 既有红，stash 对照确认）；`pnpm --filter @sf/marketing lint` 4 个错误全部在未触碰的文件里（同样 stash 对照确认）；typecheck 与 build 干净；`node scripts/verify-implementation.mjs` 绿。SQL 集成测试需要 `MARKETING_TEST_DATABASE_URL`，本机实跑 20/20。

## PR 3 · AI 可见性体检（`/tools/ai-visibility-check`）

需登录。用一个冻结版本的问题集，在一个 AI 面上每题重复采样，报告提及、引用与被引用域名。

**形态**：Vercel Workflow，**每个采样一个 step**，8 并发分波。一个问题一步会把五次付费调用塞进同一个重试边界，第四次死掉就要重跑前三次；这个粒度下重跑只赔一次调用，而编排本身没有墙钟上限——一轮要一刻钟，没有任何单个函数能被撑那么久。

**新增**

- `visibility-contract.ts` — 采样/判定/指标/报告的形状与全部阈值；`visibilityCallCount` / `visibilityCostEstimateUsd` / `visibilityMinutesEstimate` 三个推导函数，页面上印的三个数由它们算，不写死。
- `visibility-sampling.ts` — 一次调用一次判定：提及走 `findGeoAliasMatch`（NFC + 整词 + ≥3 字符），引用走 `isGeoTargetCitation`，竞品只匹配 confirmed 的 brandName（未确认的名字是猜测，猜测进了报告就成了事实）。超时不重试，只有「请求没发出去」那一类才重试一次。
- `visibility-metrics.ts` — 聚合与对比。分母口径是这个工具最容易说谎的地方，所以写死在一处：unprompted 提及只数非 branded 层；引用只数 retrieval 模式且 `webSearchPerformed === true` 且回答了的样本；问题级比例用 `collapseGroupsToBernoulli`。对比只对可检验项做 BH，且「p 值判显著」与「区间不跨零」必须同时成立。
- `visibility-store.ts` + `0007_geo_visibility_runs.sql` — 每轮落一行摘要（裁决 D5），append-only，只有数字与问题文本，不存回答原文。0007 显式绕开了 0006 踩过的坑：OUT 参数与列同名会让 `returning` 变成 `column reference is ambiguous`，这里既改了参数名也限定了表名。
- `visibility-workflow.ts` / `-steps.ts` / `-handler.ts` / `-handler-deps.ts` + 三个路由；`components/tools/ai-visibility-check.tsx`；页面；i18n `tools.aiVisibility`（en/zh 各 152 键）。
- 两个新的密封用途 `gg_geo_visibility_input` / `gg_geo_visibility_run`：purpose 同时是 HKDF info 与 GCM 附加数据，共用一个会让运行指针可以被当作运行输入递进来。

**与 D8 的偏离（有意）**：这一版**不做 A/B/C/D 四类缺口归因**。把「为什么没被提到」判成四类需要先把本站页面索引起来，那是另一条抓取预算与另一套失败模式；没有它，诚实的产出是「观测 + 引用来源分布 + 逐题证据」，再把「这一页读不读得到」交给页面可引用性检查。报告的限制清单里第一条就写着它只观测、不解释。归因留给后续 PR。

**安全阀不是预算**：Owner 放开了预算，所以每账号每天 5 轮走 `consumePublicToolQuota`，只为挡住跑飞的循环；表单上印的是真实调用数、真实预估费用与真实预估耗时，全部由这套问题集自己的条数推导。

**验证**：marketing 4686 通过 / 1 失败（`blog-content` 既有红）；typecheck / build / verify-implementation 干净；lint 5 个错误全在未触碰的文件里。构建产出 `/[locale]/tools/ai-visibility-check` 与三个 API 路由。

**未做**：`visibility-sampling` 与 `visibility-store` 的单测（并行 agent 在写到一半时撞上会话额度中断，模块本身完整且 typecheck/lint 干净，`visibility-metrics.test.ts` 与 `visibility-handler.test.ts` 已覆盖聚合口径与 HTTP 边界）；0007 的 rollout 一节与集成测试同因缺失。这两项连同 `kb-store.ts` 的拆分记在下一个 PR。

### PR 3 · 评审后的修正

四路对抗性评审（codex 两路 + Claude 两路）在合并前查出 **35 条**，其中 4 条足以让这个工具在生产上完全不可用或系统性说谎。这里记的是修了什么以及为什么，不是修改清单。

#### 会让工具根本跑不起来的

- **组件读 `data.versions`，后端发 `data.choices`。** 任何登录用户打开这一页只会看到一条错误文案，永远进不到表单。而那条 `errors.unknown` 文案两个语种都不存在，next-intl 缺 key 会静默把 key 路径渲染出来——所以页面上实际印的是 `tools.aiVisibility.errors.unknown`。单测全绿：13 条 handler 测试断言的是 `data.choices`，组件没有测试。补了一个组件测试，它用 handler 真实产出的 payload 形状喂进去，接线错了就红。
- **客户端读不出 `queued`。** workflow 的 pending 被映射成 `queued`，组件只认 `completed` 和 `running`，其余算失败，5 次判死——约 10 秒。此时配额已扣、几百次付费调用正在跑，而它印的是「没有产生新的花费」。
- **`runToken` 只活在闭包里。** 后端专门给它设了 24 小时 TTL 并在注释里写明「一轮要一刻钟，指针得熬过一次刷新和一杯咖啡」，页面也向用户承诺可以离开再回来。token 从没写进任何存储。现在持久化到 sessionStorage 并在挂载时恢复。
- **所有 www 站点的引用率永远是 0%。** 编排层用 `new URL(payload.targetUrl).host`（保留 `www.`、保留端口），引用侧用 `normalizeGeoHost`（去掉 `www.`、拒绝端口）。两个不同拼写做等值比较。同一份报告里，逐题证据说「没引用你」，旁边的域名表把 acme.com 标成「你自己的站」。**这是本仓库第三次踩这个坑**，所以修法是让 target 侧也走 `normalizeGeoHost`，不留第二种拼写。

#### 会让报告说假话的

- **别名匹配器对中日泰文品牌系统性漏报。** 整词规则要求匹配两侧是空格或字符串边界；中文不写空格，所以「我们推荐小米手机」里的「小米」两侧是「荐」和「手」，不匹配。更早一步：最小长度 3 个字符是按字符数算的，「小米」两个字直接被跳过。实测「小米」「サイボウズ」「ไลน์แมน」全部漏报。边界规则改成**逐边判定**——只要一侧属于不写空格的文字就不要求分隔符；最小长度按文字密度分档（拉丁 3，汉字/假名/泰文等 2），且按码点数不按 UTF-16 单元。这个匹配器是和已上线的 GEO Agent 共用的，所以它同时是那边的修复；agents 全套 967 条测试仍全绿。
- **同一个匹配器把普通名词读成品牌。** 大小写无条件折叠，于是 "This is a useful notion." 里的 notion 被判成品牌 Notion，"Who should use it?" 里的 Who 被判成竞品 WHO。SaaS 品牌里 Notion / Monday / Square / Stripe 这类普通词占比很高，这不是边角。改成按**用户确认的写法**约束大小写形态：全大写的缩写要求出现处也全大写；含大写的名字要求出现处至少有一个大写；用户自己写成全小写的则不约束。代价写在代码注释里：模型把品牌全小写写出来时会漏掉一次——接受这个方向，因为虚高的提及率会让客户以为不用做事，而且没有任何下游能发现它。
- **提示性问题被算进「无提示提及率」。** 判据是 `layer !== "branded"`。这不是假想：标定库里的 `geo.natural.brand_comparison` 渲染成 "How does {productName} compare to other {categoryPlural}?"，`productName` 就是 `officialName`，而它的 slot 映射到 `comparison` 层。模板自己的注释写着「这里的提及永远不构成被发现的证据，因为问题里就有品牌名」——然后聚合层把它算进了无提示提及率。改成按**问题文本里是否出现品牌名**判定：层说的是这道题属于搜索的哪个阶段，品牌在不在问题里是词的属性，两件事。
- **引用列表解析失败会连提及观测一起抹掉。** 一条读回来了、明确提到品牌的回答，只要它的引用列表里有一个 URL 规范化失败，整条样本被改写成 `status: "error"`——真实的 1/5 提及率被发布成 0/4。根因是记录里没有「引用未知」这个状态，只有 `cited: boolean`。加了第三态 `cited: null` 和 `citationUnknown` 计数：提及照算，引用不算，读不出来的条数单独报。
- **「0.0%」的门槛把同题重复采样当成独立样本。** 7 个问题各问 5 次全部未提及，池化是 0/35，Wilson 上界 9.9%，通过 ≤10% 的零声明门槛，报告印「0.0%」。真实独立单位只有 7 个，0/7 的上界是 35.4%——只能说「本次未观测到」。头条改用问题级的 `questionsMentioned` / 新增的 `questionsCited`，样本级的降为副行。
- **两轮对比用未配对的两比例 z 检验。** 同样的膨胀：6 个问题里 5 个同向变化，池化 5/30 对 25/30 得 p≈2×10⁻⁷、过 BH、判「变了」；按配对的问题单位是 5 个不一致对，精确 McNemar 给 0.125，不足以支持任何结论。两轮跑的是同一个冻结问题集，本来就是配对数据。改成**问题级的精确 McNemar**，并加了「至少 10 个可比问题」的下限；区间改成「移动了的问题里有多少比例变好」，中心是 0.5 而不是 0。BH 仍然只对可检验的假设做。
- **`questionsMentioned` 的分母名不副实。** 合同写「over questions asked」，实现跳过了零试验的问题，所以真实分母是「至少拿到一个回答的问题」。10 题里 9 题有回答且都提到了，会印成 100%。分母口径写清楚，另外把 `questionsAsked` / `questionsAnswered` 两个裸数字一起发出去，让差额可见而不是被除掉。
- **不校验槽位唯一性。** 只比总数：6 个全标着 Q1 的样本对上「2 题 × 3 次」的计划，`matched === planned`、成功率 1、状态 `ok`——而 Q2 一次都没问。改成逐题核槽位，并对重复的 `(questionId, sampleIndex)` 去重后按不可信处理。
- **`manifest.model` 里放的是接口名。** 页面标着「模型」印出 `dataforseo_chat_gpt_llm_responses_api`，真实模型没被记录在任何地方。拆成 `model` 和 `surface`。
- **存档失败无人知晓。** `recordVisibilityRun` 的返回值被丢弃。写失败会让之后每一轮都失去基线，而报告看起来和存好了一模一样。现在读返回值，失败时给报告追加一条 `notStored` 限制。
- **不足的轮次会成为下一轮的基线。** 页面印着「低于 70% 不下结论、不作基线」，前半句前端没兑现（照样渲染对比区块），后半句 store 没兑现（读基线时不看 status）。两边都补上了；基线过滤放在查询里而不是读回来再丢，这样最新一轮不足时会取到再上一轮，访客不为供应商的一个坏夜晚买单。

#### 会多花钱的

- **模糊的网络失败会重试，于是同一个计划样本付两次费。** 原来的理由是「`network_error` 表示请求没发出去，重发不会是第二次收费」。这个前提是假的：`fetch` reject 只说明客户端没拿到完整响应。请求已送达、已计费、响应途中断线，走的是同一个分支。而且第一次的价格通常也拿不到——响应根本没回来。`VISIBILITY_MAX_UNSENT_RETRIES` 改成 **0**。付费 POST 只有在供应商支持幂等键、或者有能证明调用没发生的 fence 时才可以重试，这两样都没有。少报一个回答是看得见的，重复计费不是。
- **匹配不到的品牌名可以被冻结。** 匹配器有最小长度，知识库没有对应的拒绝。填一个两字母的品牌名可以冻结、可以开跑，跑完每条提到品牌的回答都被报成「没提到」——账单照付，页面上没有一句话解释。冻结前加 `alias_too_short` 阻断，判据直接从匹配器导出，不在表单旁边抄一份。

#### 死代码与不可达特性

`runVisibilityWave`（共享游标调度器，注释里论证了固定波次的坏处）从来没被引用过。删掉，并在编排器里写明**固定波次在这里是对的**：编排是可重放的，运行时按调用顺序把结果配回调用，而「谁先跑完谁拿下一个」会让调用顺序取决于供应商延迟，重放时就会把结果配到别的调用上。队头阻塞的代价（大约两倍墙钟）是可恢复运行的价格。

`citationUrls` 和 `engineFailures` 两个参数声明了、测试了、编排层从没传过——所以域名表的示例链接永远是空的，而 UI 一直在渲染它。接通了。

## PR 4 · GEO Brief 生成器（`/tools/geo-brief`）

需登录。拿一个冻结版本 + 一道题，产出一份可以直接交给写手的 Brief。

**没有迁移。** D9 裁决它独立上线、出口是页面 + `.json` + `.md` + 复制，没有历史、没有基线、不需要落库。少一张表就少一套安全形态要维护。

**两次外部调用，职责分开：**

1. **采样一次**（DFS ChatGPT，约 $0.046）：把这道题原样问一次，拿回答文本和引用。
2. **组装一次**（LLM）：把知识库事实 + 观测到的子话题 + 提问，组装成开头段要求、必答清单、大纲。

**子话题是确定性抽出来的，不是问模型。** 从回答的 markdown 标题、列表项前半段、加粗引导词里读。理由有两条：问模型要多花第三次调用；更重要的是，那样一来「这条来自一次真实回答」就从观测变成了主张——一个模型对另一个模型文本的总结。标题和列表是回答自己选择分开的东西，那正是要问的。回答是没有结构的散文时返回空列表，Brief 把它记成一条运行限制——把一段话切成「子话题」，就是这个工具在伪造它声称观测到的证据。

**列表项只留冒号前那半截。** 一条 bullet 常是「Pricing: starts at $29 per seat」——子话题是 Pricing，后面是别人家的具体主张。留着它就等于把竞品的数字写进了 Brief，而这恰恰是一次采样永远不被允许贡献的东西。

**事实表没有模型兜底。** 值只能来自知识库里已确认的事实，或一次带 `sourceUrl` + `fetchedAt` 的抓取。抽不到就是 `value: null` 加必填的 `reason`。知识库 payload 里「未核实」是空字符串（那个 payload 禁用 null，因为两侧要生成逐字节一致的摘要），在进入 Brief 的边界上一次性转成真正的 null——留着空串往下走，就是「没核实过」被渲染成一个读起来像值的空格子。

**模型不能供给必须点名的实体。** 开头段要求的措辞可以是模型写的，要求点名哪些实体只能来自冻结的知识库。一条内容由模型编出来的「义务」不是义务，是贴错标签的建议。

**两半必须都配好才让跑。** 只配了采样凭据、没配组装模型的部署仍会返回一份 Brief——事实表和观测到的子话题都在——它看起来就像一道不需要大纲的题。提前拒绝，是「工具关着」和「工具悄悄比看起来差」的区别。

**降级各自独立且被点名。** 采样失败 → `sampleUnavailable`；模型失败 → `modelUnavailable`；手填的问题 → `manualQuestion`。三者互不填补。一份悄悄比平时少给了内容的 Brief，是这个工具最输不起的失败，因为下游没有任何东西能发现。

**导出文本里带着出处。** 页面上的来源标签粘贴不过去。写手把它贴进文档，标签没了，一个「别人家回答里出现过」的子话题就读成了品牌核实过的东西。所以 Markdown 里每一项后面都跟着来源词，而不是在底部放一个会被裁掉的图例。

**自己复查抓到的：** 我在 handler 里第一次写 `targetHost` 时又写成了 `new URL(payload.targetUrl).host` ——和可见性工具刚修掉的是同一个 www 缺陷，本仓库第三次。已改成 `normalizeGeoHost`，并加了断言 `https://www.acme.test/` 必须以 `acme.test` 到达采样层的测试。

**测试**：`brief-contract` / `brief-assemble` / `brief-subtopics` / `brief-llm` / `brief-export` / `brief-handler` 共 73 条。
