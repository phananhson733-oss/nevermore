# GEO Artifact 对齐：实现与验收映射

审计日期：2026-08-31。工作树：`geo-artifact-alignment-20260831`。Git 基线：`807e2cdce85ed7e6cdde3016e3cfd178a0b45556`，本轮实现仍为未提交的本地修改。

**38 项均已完成本地实现与验收；这不是生产上线结论。** 最后五项已依据新 Build ID `7hnzuOvV6Asb00JWNOzqo` 的强化浏览器4例通过、真实本地SQL持久化链，以及审计者对23个证据文件的读回完成闭合。没有把旧 build 的浏览器结果套用到新字节。

下表记录当前实现、消费者、具体测试和真实证据边界。`requirements.csv` 的状态保留最初审计基线；`audit.md`、保存的原型和本文件的历史记录均未覆盖。审计问题是以新代码和新验证关闭，不以“已通知”关闭。此次只交付本地代码与验证；没有提交、部署、执行 hosted migration 或新的付费 canary。

## 权威与判定口径

- 38 行要求：同目录 `requirements.csv`。
- 原型：`reference-geo-product-ui.jsx.txt`（666 行）与 `reference-ui-states.md`（九个状态）。实现应恢复字段、来源、版本和交接语义，不照抄 42/420 等演示数字。
- 用户批准的结构：`docs/plans/2026-08-31-geo-artifact-alignment-design.md`。Settings → Websites → GEO 为正式资产入口，旧 URL 只作同一资产的兼容入口；本次权限只涵盖本地实现和验证。
- 原型中明确存在重复 Q owner 和 `answers: []` 的辅助内链段（JSX 589）。验收要求所有必须回答的问题总体覆盖，不禁止辅助段；辅助段仍必须经过相同事实资格校验。
- 原型 T3 的说明提到 A/B/D，但实际动作表将 B 交给 T2。批准的设计采用 **A/D → Brief，B → T2，C → 第三方待办**，本表不把这一已明确的路由解释成遗漏。
- 英文题库属于明确能力边界：仅支持有效 BCP-47 且主语言为 `en` 的已实现题库；不支持的语言必须在冻结/付费前拒绝，不能静默改成英语。
- 无 GSC 时，人工/HTML 推断角色不获得 GSC 来源，也不启用依赖它的 problem/evaluation 层。来源不可用不是 0。
- 新 source-context freeze 要求存在 owned Website；旧 KB 草稿和历史冻结读取保留，不自动创建网站。导入运行文件始终是 `imported_untrusted`，不会因此获得服务端 run 权限。
- V2 运行历史只保留有界 excerpts/topics 与测量/来源元数据，不保存完整回答正文；历史为 private、append-only。**当前没有自动 TTL、30 天删除或用户自助删除流程**，不能在验收或产品说明中声称存在。

当前状态定义：

- **本地验收通过**：该行的实现、消费者、对应局部负例/正例，以及需要时的本地SQL、浏览器或真实renderer证据已完成。38行当前均为此状态。
- 历史的“实现/候选/待补”分层保留在审计记录中；最终状态没有把生产部署或真实登录/付费验证包含进来。

下表列出的测试均已阅读相关断言；**除“实际执行记录”列明的运行外，不能把“有测试文件”当成审计者本轮已经执行。** 测试名引用保留原文，便于精确检索。

## 共享与知识库（10 项）

| ID | 状态 | 当前实现与实际消费者 | 具体测试证据 | 验收范围与保留限制 |
|---|---|---|---|---|
| SH-01 | 本地验收通过 | KB/context/frozen、Visibility manifest、shared Brief geo_origin、Draft brief_ref 与 T2 handoff 的身份链已闭合；匿名 T2 仍不虚构账户/KB。 | 新 Build `7hnzuOvV6Asb00JWNOzqo` 的 E-A/E-D 实际浏览器记录：canonical Settings→freeze→双引擎→Brief→actual verifyOwnedGeoBrief accepted=true→Draft→手动 T2 POST1；两份 Brief/Draft/V2 JSON 严格重读、相关 Markdown 与同源函数逐字比较通过。 | 结合独立 unit、真实本地 SQL persisted-chain 与新 build 浏览器4例完成本地验收；不是生产或真实登录/付费 canary。 |
| KB-01 | 本地验收通过 | 新 `account/websites/[websiteId]/geo/page.tsx`、`WebsiteGeoEditor`、`account-websites/geo-route.ts`；认证和 owned Website 读取先于共享 KB load，以服务器 origin 复用既有 KB。`website_required` 阻止无正式网站资产的冻结。Tools hub 已移除 KB 普通 tool tile，保留三个正式 GEO 工具；旧 KB URL 保留同一编辑器、快捷入口说明与 Settings 链接，没有重定向或删数据。 | `geo-route.test.ts` → `authenticates before reading an owned website or loading a KB`、`derives the URL from the owned website and reuses the same KB without exposing Profile drafts`；`website-profile-editor.test.tsx` → `links the owned website to its canonical GEO extension`；`tools-hub-contract.test.ts` → `keeps formal tool entries in their established order, with GEO Knowledge Base owned by Settings`、`keeps the existing KB URL as a shared-editor shortcut to canonical Website GEO settings`。 | 旧页面关于“不读 GSC/一次性副本”的陈旧限制文案已修正；没有声称修改 Profile 会回写历史冻结版本或静默覆盖 GEO matching overrides。 |
| KB-02 | 本地验收通过 | `GeoKbInheritedProfile` 只读产品字段及 exact reference/hash；`pendingGeoFeatureFact` 显式生成空值/lowConfidence 候选，不推断事实。`visibilityPrepareStep` 从 exact frozen context 取 coreFeatures，经 prepared.priorityHints 交给 collector；只提高已发现 URL/anchor 的优先级，不编造工具 URL。 | `website-geo-editor.test.tsx` → `adds an inherited feature only as an unverified fact candidate without saving or losing other edits`；`geo-kb-feature-candidates.test.ts` → 不截断/不覆盖/24 条上限；`site-index.test.ts` → `prioritizes only discovered feature-tool URLs and real anchor labels from the exact frozen Profile hints`。 | 两个原型消费者均已有代码与测试。最终新 build 的 E-A/E-D 已补齐身份与交接组合证据。 |
| KB-03 | 本地验收通过 | `kb-import.ts` 的 `proposeGeoAliasCandidates` 用 confirmed Profile 初始化 GEO 匹配名/别名；现有 ChipsField/category 输入继续可编辑，matching override 与 inherited productName 分开。冻结保存真实 aliases/category，而非模型私改。 | `kb-contract.test.ts` → aliases 清理、上限和 matcher 长度断言；`kb-questions.test.ts` → `changes the digest when the knowledge base changes`、`uses the first category word, so the clearest one leads`；`geo-knowledge-base.test.tsx` → `links a shortcut load to the same canonical website and renders inherited facts read-only`。 | fresh Profile 初始化与人工 alias 修改由实际默认依赖/React回归核对，最终浏览器确认canonical入口；source override仍不是第二份Product Profile。 |
| KB-04 | 本地验收通过 | UI 显示实际 payload.market country/language；非 US/GB 的已保存国家会作为当前 option 原样展示，不替换值。语言 guard 与 server 共用，冻结/provider manifest 保留语境。 | `asset-context.test.ts` → `does not silently replace %s with English`；`website-geo-editor.test.tsx` → `shows the actual unsupported Profile language without suggesting English calibration`、`shows an inherited saved country outside the presets without silently replacing it`；`geo-knowledge-base.test.tsx` → `shows a loaded country outside the presets without writing a replacement`。 | CA 修正只是真实值显示，不声称新增 provider 市场支持。英文registry的Brief/Draft generation入口已随B-10最新语言保护回归；en-US/en-GB元数据保留。 |
| KB-05 | 本地验收通过 | `kb-enrichment.ts` 实际提取 JSON-LD / og:site_name / title 的名字与 aliases；有来源 URL/time/bodyHash/method，候选 `confirmed:false`；UI 显式应用，别名变更取消确认；submission 保留 optional aliases。 | `kb-enrichment.test.ts` → `extracts structured homepage names and aliases as unconfirmed crawl candidates`、`does not pretend a hostname or parse failure is an observed brand`；`geo-kb-enrichment-apply.test.ts` → `applies one competitor candidate without confirming it or overwriting unrelated dirty fields`；`geo-kb-editor-payload.test.ts` → legacy 字节/aliases 保留。 | 来源是公开 HTML 候选，不承诺 title 回退就是官方名称；人工确认仍是进入 SOV 的前置。 |
| KB-06 | 本地验收通过 | `kb-enrichment-handler/deps.ts` 核对 verified Google subject 与 sealed identity，再读私有 KB/GSC；服务器选择同站 granted property，更新 grant 后复核，90 个 finalized Pacific 日，最多 1000 条查询，确定性 query-interest clusters。 | `kb-enrichment-handler.test.ts` → `rejects Google-subject mismatch before private reads, quota, grant, or network`、`uses exactly 90 finalized Pacific days and persists the actual report before returning it`、`does not use a property removed by refreshed grant and always releases the GSC gate`；`kb-enrichment.test.ts` → `preserves total queryCount even when representative query samples are bounded`。 | 角色是 query-derived 待审候选，不把 HTML/人工或词聚类推断包装成已观测的人口画像；本地测试使用离线响应。 |
| KB-07 | 本地验收通过 | `buildGeoSnapshotContext` 只让 exact receipt-matched GSC roles 支持 problem/evaluation；无来源明确 skippedLayers。新 view/save context 预览驱动 UI gate；legacy absence 保留旧规则。 | `snapshot-context.test.ts` → `keeps manual source URLs as KB claims and skips unsupported role layers`、`downgrades edited facts and roles instead of borrowing their old provenance`；`geo-knowledge-base.test.tsx` → `allows a role-free freeze only when server source policy skips both role layers`、`keeps the legacy role gate when no server source policy was supplied`。 | React与最终新build浏览器已核对已保存草稿/冻结策略，未保存编辑不冒充服务器确认状态。 |
| KB-08 | 本地验收通过 | 人工 URL 只保持 KB claim；实际完整 HTML 检查生成 crawl receipt，拒绝数字子串/隐藏内容/身份变化；24 条事实均有结果。Root context 按 exact candidate 值匹配来源，编辑不借旧证据；空值有 reason。 | `kb-enrichment.test.ts` → `only backs a fact with an actual visible excerpt containing both its key and value`、`does not promote a numeric substring or hidden markup into fact evidence`；`kb-enrichment-handler.test.ts` → `reports every saved fact up to the KB cap rather than silently omitting the second half`；`snapshot-context.test.ts` → manual source / edited value 断言。 | receipt 证明网页包含内容，不证明该网站的商业陈述客观正确；正文 Draft 的更强事实约束见 B-10。 |
| KB-09 | 本地验收通过 | `asset-context-store.ts` exact owner/snapshot/hash 读取；`kb-freeze-context.ts` 与 SQL 原子写 snapshot+context；contextHash/Profile reference CAS，当前 Website pointer 行锁，历史 v1 不重写；UI 重新加载 actual frozen questions。 | `snapshot-context.integration.test.ts` → `stores a new source-conditioned snapshot without rewriting legacy payload identity`、`binds the exact owned confirmed Profile fields and refuses a changed current pointer`、`holds the Website pointer stable through the atomic freeze`；`geo-knowledge-base.test.tsx` → `pins the source context seen by the user in the freeze request`、`pins Profile identity on save and reloads changed sources without discarding the local draft`。 | SQL 最终执行结果由 root 运行记录提供；此审计者独立运行了 unit/纯函数回归，没有冒充重跑全部数据库场景。 |

## 可见性（11 项）

| ID | 状态 | 当前实现与实际消费者 | 具体测试证据 | 验收范围与保留限制 |
|---|---|---|---|---|
| V-01 | 本地验收通过 | 默认 list 接到 `listFrozenGeoKbVersions`，读取历史与 current snapshots，owner/hash 校验、分页、200 行预算溢出明确 unavailable；不再在 snapshot 失败时继续并伪造空列表。 | `kb-history.test.ts` → `lists historical and current snapshots of the same KB without mixing identities`、`reads multiple bounded pages rather than losing versions at the provider page limit`、`does not turn an unreadable declared snapshot into an empty selector`、`can distinguish genuinely empty history from a transport failure`；shared Brief UI 同 KB 多 snapshot selector 测试。 | 已按新代码/测试关闭最初 current-only 与 silent-skip 缺口；最终浏览器链已确认具体snapshot选择。 |
| V-02 | 本地验收通过 | `visibility-engines.ts` 固定 ChatGPT/Perplexity config；真实 DataForSEO adapter、engine/question/sample slot、workflow 和 byEngine 状态/UI 已接线；Perplexity wording 明示 unmeasured。 | `visibility-v2.test.ts` → `freezes every engine/question/sample slot once and rejects duplicate engines/questions`、`withholds an individually insufficient engine even when the mixed run is usable`、`runs the real judging pipeline with engine identity and provider evidence, once per call`；`ai-visibility-check.test.tsx` → `selects engines before spending and sends them in the real start request`。 | 这是离线适配器/运行管线证明；不把未做的付费 canary 当作本轮完成证据。 |
| V-03 | 本地验收通过 | 页面 estimate 以实际 frozen questionCount × 3/5/10 × selected engines 计算调用量；服务端冻结 plan 并做 wire-budget 预检；成本实报与估算分开。 | `visibility-contract.test.ts` → `is one call per sample of per question`、`scales with the number of calls`；`kb-questions.test.ts` → `multiplies the set's own size, not a number from a design document`；`ai-visibility-check.test.tsx` → `prints the question and retrieval counts the estimate is built from`、`prints the estimate with a currency unit`。 | 多引擎估价中的校准/代理价格说明要保留；无已知报价不能伪装成精确账单。 |
| V-04 | 本地验收通过 | `visibilitySovClusters` 按“own 或 confirmed rival 至少一个出现”的回答子集计 SOV，每个回答只计一次；PromptCoverage 改为有回答的问题数/全部冻结问题。`computeVisibilitySov` 的区间按 question clusters，不把重复采样当独立题。 | `visibility-v2.test.ts` → `uses the Artifact's conditional answer SOV, not a sum of brand mentions`、`reports prompt coverage as valid-answer questions over all frozen questions, even if the brand never appeared`；`visibility-sov.test.ts` → `uses the specified two-mean Hoeffding ratio bound, not a Bernoulli bound around the answer point`、重复采样精度不增、端点/无分母/失败题负例。 | 已关闭原公式缺口。区间显式假设独立 question clusters，少于10题/无分母不给区间；它不是对实验随机性的额外保证。 |
| V-05 | 本地验收通过 | byEngine requested/observed model 与状态保留；V2 byLayer 增加 plannedSamples、answeredSamples、实际 listPosition 的 mean/count，LayerTable 渲染对应列；没有明确列表则位置为 null。 | `visibility-v2.test.ts` → `keeps actual planned/answered sample counts and genuine rank evidence per layer`、`recognizes real numbered product entries, not incidental prose numbers`；`ai-visibility-check.test.tsx` → actual engine identity/export 与按层新输出断言。 | 已关闭按层字段遗漏；不使用样本中的普通 prose 数字猜排名。 |
| V-06 | 本地验收通过 | citedDomains 按回答计数；site-index 独立读取实际页面证据，URL级 pageType/ownPresence/snippet/time 与域名统计并存；不将失败/截断读作缺席。 | `site-index.test.ts` 的实际HTML collector/未完整读取/同站重定向负例；新 build E-C 通过真实 UI 导出带来源和 hash 的第三方待办，E-D 导出保留非空 site_index 页面并进入 Brief internal_links；V2 JSON strict readback 通过。 | 本地 source transport 使用明确离线 fixtures，证明完整管线和边界；不声称远端网站全域缺席或真实第三方抓取结果。 |
| V-07 | 本地验收通过 | 真实 builders、site inventory/reference/T2 证据与 classifier 接到 durable output，A/B/C/D/未归因均有证据前置；训练-only advisory 不触发 B。 | `gap-classify.test.ts`、`site-index-validate.test.ts`、workflow order；最终 E-A/E-D 实际进入 Brief/Draft，E-B 只预填 T2 且零自动POST，E-C 只导出待办且零组装；真实SQL persisted-chain 保存后才允许 owned gap。 | 四种浏览器动作及持久化前后可信差别都有本地证据，缺证据仍保留 unattributed，不推断业务结果归因。 |
| V-08 | 本地验收通过 | `VisibilityGapEvidence` + fixed-key `writeGeoGapHandoff` 携带 ID-only A/D selector 或 B URL/question；C 只导出 third-party Markdown；notStored 禁止可信 handoff。 | `ai-visibility-gaps.test.tsx` → `writes exact A/D selectors and B URL/question handoff while C has no Brief link`；`gap-handoff.test.ts` → `carries selectors without metrics or identity in URL and consumes exactly once`、`refuses extra authority fields, stale envelopes and another destination`。 | 最终E-A/E-D已通过actual owner verifier闭合正向链；E-B/E-C独立证明不同动作边界。 |
| V-09 | 本地验收通过 | 同版本服务器 baseline 与两文件比较均加入 `shareOfVoice`；`compareVisibilitySov` 只配对同 question ID 的实际回答，四个同时界定均值构造保守差异区间，UI 输出 SOV 前后值/CI/pairs。mention/citation 原配对问题统计保留。 | `visibility-sov.test.ts` → `uses four simultaneous means for the paired difference interval`、`cannot call one observed pair significant, regardless of replica count`、`keeps identical all-one runs uncertain instead of a bootstrap [0,0]`；`visibility-export.test.ts` → 不同配置/实际模型拒绝、配对统计重算与篡改拒绝。 | SOV 比较点是配对子集的比值差，不冒充两次完整 headline 的直接差；区间假设和不可判断理由保留。 |
| V-10 | 本地验收通过 | strict wire JSON export/import、两个 file inputs、本地比较和 imported_untrusted 保留；全局按钮已接 `visibilityReportMarkdown`，包含整份 Manifest/指标/样本/站点证据以及全部 A/B/C/D supported tasks，C 仍明确不是内容草稿。 | `visibility-export.test.ts` → `round-trips the complete report only as imported_untrusted, never a server run`；`ai-visibility-check.test.tsx` → `compares two selected files locally without launching or trusting a server run`；`visibility-markdown.test.ts` → `contains every supported A/B/C/D task, exact origin and evidence rather than observations alone`。 | 已关闭全局仅导出 observations 的缺口。最终chain的真实download bytes已重读，并与同源Markdown projection精确比较。 |
| V-11 | 本地验收通过 | 只持久化有界 answerExcerpt/topics/品牌片段及测量元数据；private append-only run history 经 exact owner/snapshot resolver 读取。当前无自动TTL/30天删除。 | `geo-persisted-chain.integration.test.ts` 实际SQL wire roundtrip→owned gap/shared resolver→正确owner verify=true、错误owner/篡改=false；E-A/E-D metadata 记录实际 verifyOwnedGeoBrief accepted=true，2份V2/2份Brief/2份Draft JSON 重读均保留同一promptset hash，导入V2仍 imported_untrusted。 | 已闭合存储与浏览器组合证据。source大小/遗漏明确；没有把导入文件或public fingerprint当作权限，也没有宣称尚不存在的删除策略。 |

## 页面可引用性（5 项）

| ID | 状态 | 当前实现与实际消费者 | 具体测试证据 | 验收范围与保留限制 |
|---|---|---|---|---|
| C-01 | 本地验收通过 | `citability-handler.ts` 仍为匿名 URL + optional question，纯确定性规则、无 LLM；共享 Draft/B-gap handoff 只填入输入，不自动执行。 | `citability-handler.test.ts` → 非 JSON/unknown field/question bound；`page-citability-check.test.tsx` → `prefills exactly the B-gap URL/question on the explicit marker without auto-run`、`does not fall back to an older draft when the selected gap is %s`。 | 问题上限已为共享交接调整到 512，须保留前后端一致的长度保护。匿名路径不要求或虚构 KB/Profile 身份。 |
| C-02 | 本地验收通过 | `buildCitabilityReport` / page UI 展示 readable/extractable、14 条实际规则；最新 inventory 是 **10 counted + 4 advisory**。ClaudeBot/GPTBot/Google-Extended 与 llms.txt 在 advisory；unknown/notApplicable/fetch failure 区分，每个失败有 fix。 | `citability-rules.test.ts` → `returns fourteen rows: ten counted and four advisory`、`gives every failed check a fix and no passing check one`；`page-citability-check.test.tsx` → `copies the same localized failure reason shown in the rule row`。 | 不为迁就原型“12”删规则，也不把训练用途 advisory 算作可引用性失败或 B 缺口依据。 |
| C-03 | 本地验收通过 | 实际 Chromium JS-off/JS-on 可见正文测量，隔离 world/static capture；受限 public transport、真实 cgroup 验证、Compose 资源/权限限制；Next adapter 回验 capture/ratio。 | `citability-renderer.test.ts` → `actually executes JS fetched through the guarded transport`、`runs the actual tsx service without transpiler helpers in browser code`、`roundtrips a real Chromium capture through the same HTTP adapter used by Next`、`terminates a hostile infinite script at the deadline`；`citability-render.test.ts` → `rejects forged ratios and does not follow service redirects with credentials`。 | 本行有实际 host/容器证据，见下节；整条本地浏览器链已由新build四例补齐，原始证据见最终浏览器章节。不能把限制性 renderer 描述为任意浏览器等价环境。 |
| C-04 | 本地验收通过 | `groupCitabilityCauses` 确定性合并同源依赖，区分明确共同来源与可能 rendering dependency；UI 保留全部逐项检查与修法。 | `citability-causes.test.ts` → `groups crawler rules sharing the same robots source without losing evidence or fixes`、`links dependent raw-document failures as possible rather than proven rendering causes`、`does not turn unavailable, advisory or not-applicable rows into failed root causes`；page UI → `shows both actual captures and shared-root rule links without dropping any check`。 | 不采用原型示例那样无条件断言“根因只有一个”。 |
| C-05 | 本地验收通过 | ClaudeBot 和 GPTBot 作为训练抓取控制；Google-Extended 的 Gemini training/grounding 与 Google Search/AI Overviews/AI Mode 分开。当前 counted retrieval bots 仅 OAI-SearchBot、ChatGPT-User、PerplexityBot；本14行版本没有测量 Claude-SearchBot/Claude-User，不冒称它们已通过。 | `citability-rules.test.ts` → `counts the retrieval crawlers and only shows the training ones`、`keeps a ClaudeBot-only training block out of the summary and retrieval root cause`；`gap-classify.test.ts` → `yields B only for an independently read relevant page's counted failure`（包含训练-only 不触发 B 的负例）。 | 最新 C05 修正 owner12文件144项通过；本审计者重新运行相关 rules/gap 与 Draft 晚期保护合计8文件127项通过。crawler/control 观测仍不保证引用/收录。 |

## GEO Brief 与共用 Draft（12 项）

| ID | 状态 | 当前实现与实际消费者 | 具体测试证据 | 验收范围与保留限制 |
|---|---|---|---|---|
| B-01 | 本地验收通过 | `parseSharedBriefSelection` / `runSharedBrief`、`resolveOwnedVisibilityGap`、UI ID-only handoff；A/D 读取 owned run，不重新采样；manual 不带 run；C 不进内容链。 | `brief-shared-handler.test.ts` → `uses owned A/D run evidence without performing another visibility sample`、`uses the same route but never samples a no-run question`、`refuses gap evidence before debit`；`ai-visibility-gaps.test.tsx` 的 A/D/B/C 路由。 | B 的去向按批准设计为 T2，不直接进入 Brief。 |
| B-02 | 本地验收通过 | `sharedGeoBriefBasis` geo_origin 保存 question/role/layer/gap、KB revision/hash、prompt-set schema/registry/hash、Profile ref、run fingerprint、sample refs；`SharedGeoBriefResults` origin 首区和 excerpts。 | `geo-brief-shared-tool.test.tsx` → `consumes an owned-gap selector once, loads the exact archived version, and sends only its IDs`；`brief-shared-deps.test.ts` → `preserves the actual answer excerpt even when the target brand was not mentioned`；`parse-geo-brief.test.ts` → `fingerprint rejects changed origin bytes`。 | Draft Markdown字段已在B-11修正并由最终下载/复制字节回验，不再遗留投影遗漏。 |
| B-03 | 本地验收通过 | `GeoContentBrief` 显式 v1.1 分支；`parseSharedContentBrief`/shared handoff；既有 Draft route、UI、assembler、parser 采用 source union，并保留 SEO v1。 | `parse-geo-brief.test.ts` → `accepts a complete GEO branch without manufacturing SEO evidence`；`geo-draft.test.ts` → `parses both shared branches and keeps the fixed handoff TTL exact`；`content-draft-tool.test.tsx` → `loads a GEO handoff once and sends the same v1.1 brief through the existing Draft endpoint`。 | 不是只修改 schema 名。最终 SEO 回归属于 root 全门禁。 |
| B-04 | 本地验收通过 | 冻结 question.text / requiredEntities → KB lead/Q1；冻结 decisionCriteria →额外 immutable requirements；typed manual 明示 user_input。Draft Q1 带 requiredEntities 并进入 coverage。 | `brief-shared.test.ts` → `produces a valid frozen/manual Brief with KB Q1 and no invented sample evidence`；`parse-geo-brief.test.ts` → `rejects missing_q1 even after rehashing`、`rejects q1_rewritten even after rehashing`；`geo-draft.test.ts` → `evaluates a Q from a successful owner even if another owning section was skipped`。 | 不把模型改写当成 frozen KB 评分锚点。 |
| B-05 | 本地验收通过 | `deriveGeoMustAnswer` 做 NFC/case/whitespace 确定性 topic clustering，保留原始成员；分母仅 answered；omitted topics 导致下游拒绝，而非造覆盖数。 | `parse-geo-brief.test.ts` → `clusters case/whitespace-equivalent topics without erasing the original member heading`、`does not omit a successful member to understate observed topic coverage`、`excludes failures from coverage denominators while preserving planned samples`。 | 是有界确定性聚类，不声称语义模型聚类或实测示例 4/5。 |
| B-06 | 本地验收通过 | candidates/shown/hidden 从完整 observed topic 集合派生；parser 重算；模型只可给 outline，不能新增/删改必须回答的问题。 | `parse-geo-brief.test.ts` → `does not hide eligible topics when the eight-item display cap has not been reached`；`brief-shared-llm.test.ts` → `accepts repeated cross-section coverage and supplemental sections, without changing requirements`。 | 独立子审计纯函数核对：10 topics + Q1 → 11 candidates / 8 shown / 3 hidden。 |
| B-07 | 本地验收通过 | K/C/P fact receipts 与 value/null/reason 表由 exact frozen/context 派生；crawl 要 receipt；conflicting→null；inferred/missing Profile 不进可引用事实。原 Profile observedAt 和来源 URL 现在保留，只有允许的声明/计算来源才使用冻结 capture 时间回退。 | `brief-shared.test.ts` → `carries only provenance-backed Profile values into factual receipts`，新增 actual old observedAt/URL 保留断言；`brief-reference.test.ts` → public fingerprint 重算后仍拒 forged facts；shared results UI/MD 时间与源字段断言。 | 已关闭 P 观测时间重盖问题。正文对事实的资格/支持约束仍见 B-10，不把事实表通过当成生成正文通过。 |
| B-08 | 本地验收通过 | shared outline parser 固定 method=model，核对 aggregate 全 Q coverage / known Q；允许重复 owner 和辅助空 answers，符合 JSX 589。 | `brief-shared-llm.test.ts` → `accepts repeated cross-section coverage and supplemental sections, without changing requirements`；`parse-geo-brief.test.ts` → `allows extra immutable KB requirements and repeated question ownership`、`rejects uncovered even after rehashing`。 | 辅助段仍受相同事实校验；不以“每段必须非空 answers”收缩原型。 |
| B-09 | 本地验收通过 | verdict 保持 undecidable/geo_not_serp、length unavailable；Brief只消费实际 read 且匹配问题的site-index page_ref。 | 最终 E-D 的严格重读 Brief 含1条 internal_links，page_ref 指向同一 evidence.site_index 的 `https://geo-chain.test/`、标题Public guide、实际fixture读取时间；E-A匹配页为空则链接为空，不编造。真实SQL persisted-chain同时证明stored run→真实resolver→Brief。 | 新build正向浏览器/JSON/Markdown与本地数据库组合证明完成；URL及内容是离线fixture，不是生产建议或客户站抓取结果。 |
| B-10 | 本地验收通过 | 共用 Draft 与 owned verifier/coverage/T2 分流完整；`checkGeoFactSupport` 保守要求 bound 句子由所引完整事实文本支持，拒绝任意有效引用洗白新数字。null label/reason 经 missingFacts 进入提示和校验；Price/Pricing/Cost/Fees 有有限别名保护；English-primary generation guard 覆盖 Brief/Draft，保留 en-US/en-GB 元数据；h2/h3 与正文使用同一事实资格边界。exact absence 模板先检查所有冲突维度再排除索引数字误判。 | `geo-fact-support.test.ts` → pricing aliases、known out-of-language numerals、English once/Spanish once、coreFeatures[0] absence/conflict；`geo-draft-boundaries.test.ts` → 正确引用但错误事实/标题/缺失维度负例；`brief-shared-llm.test.ts` 与 handler tests → 非英语付费前拒绝及 en-US/en-GB保留；本轮审计者8文件127项通过，独立复核33文件656项、author39文件805项通过。 | 晚期已知 P1/P2 已关闭。该保护是明确的保守 lexical/support 合同，不是普适语义蕴含证明；已与新build的最终4例结果绑定。 |
| B-11 | 本地验收通过 | Brief UI 与 Markdown 已显示 keyword.market/language；Draft Markdown 加回 question.id/role；JSON/MD/Copy/handoff 均保留原对象的来源与身份。fixed key/TTL/single-use 不变。 | `geo-brief-shared-tool.test.tsx` → 输出/导出/同 Brief handoff 测试增加 market/language 断言；`content-draft-geo-results.test.tsx` → exact JSON/MD 测试增加 question_id/role/observed_at 断言；`geo-draft.test.ts` → shared branches/TTL。 | 原投影字段遗漏已在当前代码和测试中关闭；最终下载字节已严格重读并与同源Markdown逐字比较；整体交接由E-A/E-D actual owner verifier闭合。 |
| B-12 | 本地验收通过 | `deriveGeoFormat`：D→comparison/ai_sample heuristic，A 等按 KB intent 推断；producer/model outline 输入、完整 Draft handoff 保留 format。 | `brief-shared-handler.test.ts` → owned D comparison 断言；`parse-geo-brief.test.ts` → `rejects wrong_format even after rehashing`。 | Draft section prompt 当前主要消费按 format 形成的大纲，而非独立 format 参数；这是证据范围，不作为额外未经批准的功能要求。 |

## 实际执行记录与证据分层

本审计者在本次协作中实际执行的相关检查（仅覆盖当时的文件字节）：

| 范围 | 实际结果 | 层级 |
|---|---|---|
| root context/store/freezer/handler/deps/KB store 6 个 unit 文件 | 91/91 通过；先前版本为 88/88 | 离线 unit；不等同生产数据库 |
| UUID 大小写 exact identity 纯函数复现 | 修复前 lower=ok、upper=unavailable；修复后两者均 ok | 实际函数执行，无网络 |
| source receipt/extraction/adapters/应用 UI 等 8 个 focused 文件 | 56/56 通过 | 离线 source responses + React/handler |
| source-policy/冻结重读/guard 相关 UI | 36/36、38/38；website_required 两文件29/29 | 每轮具体新增行为回归，不累加当成唯一测试总数 |
| coreFeature pending candidate / canonical UI / shared KB 3 文件 | 34/34 通过 | 真实 React + pure helper，无自动保存/provider |
| Tools hub IA / canonical GEO page 2 文件 | 6/6 通过；保留旧 URL、移除独立 KB tile | 本地 source contract，owned ESLint/diff check 通过 |
| 非预设国家实际显示 / canonical 与旧 KB editor 2 文件 | 33/33 通过；RED 曾实测 CA 被显示为 US，修正后 CA 原样显示 | 没有自动保存、provider 调用或扩大市场能力 |
| 刷新后的 history/SOV/V2/export/tasks/site-index/Visibility UI/Brief 来源时间与输出 11 文件 | 135/135 通过 | 当前源代码局部行为验证；不替代最终 browser build 字节检查 |
| B-10 晚期保护 + C-05 最新规则/训练-only 不归 B 的8个文件 | 127/127 通过，2026-08-31 14:32 本审计者实际运行 | 无代码修改、离线 unit |
| 上述 owned-file ESLint / diff check | 通过 | 本地静态检查 |
| shared Brief/Draft 子审计 13 focused 文件 | 子审计执行120/120，通过中仍发现缺失断言 | 独立子代理本地验证，不等同 root 全链 |

Root 最终门禁记录（由 root 执行，此文档不冒充审计者亲自执行）：本地 SQL 6 文件90项通过；全 unit 15746项通过，保留1个未改动的既有 blog 计数失败（80 vs84）；全 workspace TypeScript 曾通过，最终 Next build 的 TypeScript 为0错误；最终已完成强化浏览器验收的 Build ID 为 `7hnzuOvV6Asb00JWNOzqo`。Shared 晚期修正由 author 执行39文件805项、独立复核33文件656项及精确 probes，均通过。最终不可变运行记录由 root 的 local-verification 报告承载。

新增真实数据库正向链已阅读：`geo-persisted-chain.integration.test.ts` 的 `requires an actual SQL-owned run and verifies the positive chain through the real resolvers` 在专用 loopback database 中实际保存 draft/freeze/run、检查归一化 SQL wire、经真正 owner-scoped read/owned-gap/shared resolver 生成 Brief，再调用 `verifyOwnedGeoBrief`。保存前 run/gap 为 missing，保存后正确 owner 为 true、错误 owner 和重新算过 public fingerprint 的 forged fact 为 false。该测试中的 provider/crawl 返回仍为确定性离线 fixture，不能被描述为真实第三方 canary。

C03 实际 runtime 证据由 renderer owner 提供；本审计者另外计算源码配置 SHA，确认它们与该次记录一致：

- Host `pnpm exec tsx apps/marketing/scripts/citability-renderer-fixture.ts`：raw=`raw`，rendered=`raw external JS real JS`，ratio=`0.15789473684210525`。
- Docker 镜像 `sha256:8d500b6ffa5d1f2529356c0da9a0201d4c07ab4737ea1d51b33b5b42a27a7563`；真实 cgroup：memory `805306368` bytes、1 CPU、128 pids，uid1000/read-only/drop ALL/no-new-privileges。
- Host→受限 Linux service 的 HTTP inline-JS fixture：HTTP200、measured、ratio=`0.1875`；无限 JS：约12052ms 后 unavailable/timeout/null ratio；后续 fixture恢复 measured。
- Compose SHA256：`d8395abe715d1525edb6d357b7ea166b2e66dd16068fd0bca43832a5ef1192b8`；seccomp SHA256：`bb0134ec4d0bf7e0eb733fbd255bf68258ab5ff5e8be6bea668a138630743aa5`。
- Owner 已执行 compose down；没有把后台仍在运行的服务当成完成，也没有由本审计者重开容器或重跑 provider。

## 最终新 Build 浏览器证据（审计者已重读）

目录：`apps/marketing/test-results/geo-chain-owned-final`。执行作者报告强化后的4/4例通过，耗时15.9秒；审计者另读 `.last-run.json`，确认 `status=passed`、`failedTests=[]`，并读取四份独立 `offline-chain-evidence.json`。四份证据及本地 `.next/BUILD_ID` 均为 `7hnzuOvV6Asb00JWNOzqo`；测试还断言 Build ID 前后不变。

下表的相对目录均位于上述目录中：

| 证据 | 场景目录 | 真实读回结果 |
|---|---|---|
| E-A | `geo-chain-isolated-GEO-ass-030d5-Brief-the-same-Draft-and-T2-chromium` | 英文A：90 planned/offline slots；组装1次；实际 `verifyOwnedGeoBrief` 对指定owner/snapshot返回accepted=true；Draft调用1次；由用户动作触发T2 POST1次。 |
| E-D | `geo-chain-isolated-GEO-ass-0ca61-Brief-the-same-Draft-and-T2-chromium` | 中文界面D、英文冻结问题：90 planned/offline slots；组装1次；同样执行实际owner verifier并accepted=true；Draft及手动T2各1次。Brief内非空internal link精确指向site_index记录。 |
| E-B | `geo-chain-isolated-GEO-ass-509f6-thout-any-automatic-request-chromium` | B只进入T2输入并预填；组装0、Draft0、T2 POST0，证明没有自动执行；UI仍由显式动作才能开始T2。 |
| E-C | `geo-chain-isolated-GEO-ass-4cb26-o-content-generation-action-chromium` | C只导出有来源的第三方待办；组装0、Draft0、T2 POST0，不暴露内容生成路径。 |

四份证据共同记录：`immutableSnapshot=11111111-1111-4111-8111-111111111114`，`immutableQuestionSet=af7c49ba78dd4f17b53a061fb4e072c218cdcd6a69bda671eeb33439fab21427`，`unexpected=[]`、`externalRequestsAborted=[]`。这没有改变其明确范围：local isolated UI，加注入的认证/provider/store fixtures；不是实际Google登录或第三方网络canary。

导出附件独立读回：

- 2份Brief JSON 经 `parseGeoContentBrief` 通过；2份Draft JSON 经 `parseDraftResult(draft, brief)` 通过；2份V2 JSON 经 `parseVisibilityImport` 通过并保持 `imported_untrusted`。
- 7份Markdown下载/附件全部保留相同question-set hash；A/D的Brief Markdown、V2 Markdown、Draft Copy Markdown分别与当前同源formatter精确逐字相等，不只是包含某个标题。
- E-D的Brief内部链接为1条，page_ref指向对应 `site_index` 的 `https://geo-chain.test/`，并保留标题与读取时间；E-A没有匹配页，因此链接为空，没有凭空补链接。
- 四份顶层证据与对应attachment副本逐字一致。23个非隐藏文件均已读取；目录内容摘要为 `bc2fcf50d266ed5107e968c572f73c8f6f8451dd7a2ef30aabc101cf81ee1062`。算法：按相对路径排序，对每个文件计算SHA256，再对每行 `relativePath + NUL + fileSHA256`（以换行连接）计算SHA256。

## 已闭合的本地整体验收与保留边界

1. canonical Website/Profile → source-context freeze → 双引擎 → owned A/D gap → shared Brief → actual owner verifier/resolvers → Draft → 手动T2 已在最终新build上完成；B/C路由与零自动调用另有实际浏览器记录。
2. Profile/source CAS、保留本地草稿、无GSC跳层、无Website要求Settings关联，分别由真实handler/React/本地SQL正负例覆盖；浏览器链补齐它们共同的正式入口和交接，不冒充真实身份provider验证。
3. KB/问题/角色/market/language/Profile/run/sample/source/time的已解决投影问题均已回归，并通过最终JSON/Markdown字节读回。没有剩余的旧B-11字段遗漏。
4. 公式修正、事实/标题资格、缺失维度、语言保护与training-only不计分，都在最终source/build和相应测试范围内核对；保守统计假设、lexical事实检查与有限renderer能力仍如上明确披露。
5. 本地SQL6文件90项及真实persisted chain与浏览器fixture相互补充；完整门禁明细由root归档到local-verification报告。既有未改动blog计数失败（80 vs84）仍如实保留，没有通过削弱断言制造全绿。
6. 没有生产部署、hosted migration、真实登录或新的付费provider调用；它们需要新的明确授权，不能由本地验收推出。

## 历史审计与收口记录（保留）

- 最初记录发现独立KB资产入口、GSC/竞品来源、冻结题表重读、SOV/PromptCoverage、按层统计、共享Brief/Draft和导出字段等缺口；原始 `audit.md` 与38行 `requirements.csv` 保持不变。
- 13:40一轮针对history/SOV/输出/核心功能优先级的代码与11文件135项验证，关闭对应实现缺口；没有仅凭owner意图改变状态。
- 14:32针对Draft晚期保护与ClaudeBot训练用途再次核对，8文件127项通过；真实SQL persisted链随后补齐。此时五行仍保留候选，等待新build浏览器结果。
- 最终只在读回新build四例证据、6份严格JSON、7份Markdown及匹配Build ID后关闭最后五行。旧build4例结果没有转移，当前结论仅为38项本地完成。
