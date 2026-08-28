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
