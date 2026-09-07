# SEO Agent 实地验收与本地修复 — 2026-09-07

> 下文记录首轮验收时点。用户随后批准关闭剩余问题并上线；最新实现、验证与发布状态见本文件末尾的“第二轮关闭记录”。

## 结论与范围

状态：DONE_WITH_CONCERNS。本次已修复逐页 AI 任务错误归属与截图中的呈现问题；不代表全部检测能力通过验收。

- 用户范围：SEO 检测、结果与 AI 复制逻辑、字号、无供应商提示、严重级别区分、未判定原因。
- 基线：`origin/main` / `4e2412f7018266783f68dcc251a4a190e94e0caa`。
- 分支：`fix/seo-agent-acceptance-presentation-20260907`。
- 本次遵循用户指定 review 的 fix-first 流程；未 commit、push、开 PR 或部署。
- 未扩展积分策略、未启用新的付费搜索结果采集、未改网站索引策略。

## 线上实地证据

在已登录的 `https://gengrowth.ai/zh/agents/seo`，沿现有已确认画像执行一次“接受上下文并运行”。目标为 gengrowth.ai，市场 US、语言 en-US、查询 seo website audit、全站档。

HTTP 200；抓取缓存 HIT，不是重新抓取整个网站。源抓取完成时间 `2026-09-07T03:32:16.709Z`，缓存时间 `2026-09-07T03:33:18.134Z`。本次运行仍进行了独立来源补充；没有把缓存当作新抓取证据。

- schema：`seo_audit.sitewide.v18`。
- 214 页、3,876 条链接、195 个 sitemap URL；跳过 16、禁止抓取 23、blocked 0、errored 0、stopReason null。
- 214 个页面级候选；66/84 项检查有判定，5 项待调查，13 项未判定。
- 页面问题行：8 阻断、49 警告、547 建议。这里是逐页问题行，不是 84 项检查的数量。
- “读取 20 页后停止”属于独立的画像采集额度，与 214 页 SEO 抓取不冲突。
- 未保存登录 Cookie、授权头、完整 GSC 数据或私密响应到本报告。

## 已修复

### P1：非首页问题的 AI 任务错误指向首页

线上复现：展开 `/account/credits` 的 1.3 noindex 问题。原始记录明确包含该 URL 与 `robots_directive=noindex`，但任务预览写成 `本次目标: gengrowth.ai/`，并称没有具体目标/证据；静态预览也使用首页。

原因：先按提交页过滤推荐证据，再按命中页拆问题，丢失其他页面的证据。只命中一个非目标页面时也没有显式页面身份。

修复：每个页面问题从完整 ledger 重新投影本页证据；单个非目标命中同样保留页面身份；复制目标、影响 URL、证据与预览使用同一问题 URL。

### P1：非首页问题可能借用首页正文生成草稿

修复：只有问题 URL 与完整正文 extract 的 URL 匹配时才提供草稿生成。其他页面保留自己的证据预览和“检查这一页”入口，不借用首页正文。

### P2：复制文本中缺少页面内容信任边界

修复：中英文任务文本将抓取值作为引用数据序列化，明确其不是指令、角色声明或授权。测试覆盖换行和嵌入式页面指令。此项只验证导出的文本边界，不声称外部 AI 一定遵守。

线上复制按钮显示成功；浏览器剪贴板读回为空，因此线上证据以同源任务预览为准，不宣称已逐字读回剪贴板。未为验收额外执行付费 AI 草稿生成。

### P2：字号、严重级别与来源呈现

- 线上实测候选说明段落为 17.44px，父容器的小字号被全局 `p` 样式覆盖。现在说明与画像停止原因直接使用 12px；中文保留全局 1.75 倍行高。
- 阻断使用红色、警告黄色、建议蓝色；保留文字与数量，选中状态有边框强调，不单靠颜色表达。
- 移除 SEO Agent 画像搜索证据中英文用户可见供应商名称；保留“搜索观察不等于已确认竞品关系”的真实性边界。后台来源标识未伪造或删除。
- “已排除的检查”改为“本次未判定的检查”，明确不是通过或失败；按实际原因解释，已确认的来源失败使用警告色。

## 13 项未判定：并非同一种情况

| 检查 | 项数 | 本次实际原因 | 性质 |
| --- | ---: | --- | --- |
| B4、B5 | 2 | 没有实现对应抓取历史/服务器日志检测器 | 当前能力边界，不是本次抓取失败 |
| 4.1 | 1 | 未执行前十名竞品正文对比；4.6 才是本站正文量观察 | 当前能力边界 |
| 5.4 | 1 | 静态 HTML 没有满足声明尺寸条件的首图可供检测；tested=0 | 不足以判断首屏，不代表页面无图片 |
| 6.1 | 1 | 站点级记录测试了 194 页，但不能恢复逐页适用成员关系，页面级仍为未判定 | 实现/契约缺口，见下一节 |
| 8.1–8.5 | 5 | 原始 limitation 为 `the_field_data_provider_did_not_answer_this_run` | 本次来源失败，不是网站性能失败 |
| 9.1、9.3、9.4 | 3 | SEO 默认依赖没有 SERP layout reader；单页检查器才接入 | 有意未启用，不是来源调用失败 |

性能检查仅向提交目标请求数据，不能把 0/214 解读为尝试了 214 次性能请求。没有来源数据也不能变成性能 0 分或通过。

## 仍未通过/需要后续处理

### P2：6.1 的通用“入站内链数”承诺与检测器不一致

`packages/public-tools/src/agent-audit/catalog.ts:101` 声称至少一条入站内链，且权重 2 倍；第 276 行实际绑定 `sitemap_page_without_observed_inlink`。后者只覆盖 sitemap 内符合条件的页面，并不是通用入链计数。站点级 clean 记录又没有可恢复的逐页适用列表。

本次仅如实解释未判定，没有造出逐页通过结果。后续必须二选一明确产品契约：将名称/范围收窄到 sitemap 孤立页，或者实现真正的逐页入链统计与适用证据；两者不应继续混称。

### P2：noindex 阻断不等于必须修复

本次 8 个 blocker 全部是 noindex：`/account/credits`、`/account/websites`、`/contact`、`/waitlist` 及对应中文路径。账户路径有源代码明确设置 noindex。检测到“阻断索引”是事实，但系统没有逐页“是否希望被索引”的意图，所以不能推出这 8 页都应删除 noindex。

现有修复说明已有“如果是有意 noindex 则停止”的提醒；仍建议把“阻断索引”与“需修复的意外阻断”分开。本次没有自动白名单，也没有移除任何页面的 noindex。

官方依据：[Google noindex 文档](https://developers.google.com/search/docs/crawling-indexing/block-indexing) 将其定义为主动控制索引的指令；存在该指令并不自动等于站点配置错误。

### 来源可用性尚未恢复验证

本次确认性能来源失败，但没有改动生产凭据、额度或重试策略，未查明具体上游故障原因。来源恢复之前不能验收 LCP/INP/CLS/TTFB/页面体积的实际结果。

[PageSpeed Insights 官方说明](https://developers.google.com/speed/docs/insights/v5/about) 也区分真实用户样本不足与工具数据；本次记录是来源未响应，不能改口称样本不足。

## 验证记录

- 新逐页绑定回归先复现失败，再修复通过；未判定原因的 8 条新增用例同样先红后绿。
- 9 个单元测试文件、200 测试通过：issue model / prompt / detail / accordion、key-page aggregate、audit model、result helpers、profile panel、wire fixture。
- 独立只读复查：4 个重点文件测试套件、100 测试通过；未发现本次修复新增的阻断问题。
- Marketing typecheck 通过；本次相关文件 ESLint 通过。
- 最终 Marketing 生产构建通过：编译 8.6 秒，TypeScript 13.9 秒，311 个静态页面生成完成。
- 中英文 E2E 11/11 通过：12px 实际 CSS、中文行高、390/1280 宽度无横向溢出、深浅色严重级别区分、无供应商正文、未判定原因、原有登录/运行/档位流程。
- 最终构建后再次执行同一 E2E：11/11 通过（7.2 秒）；E2E TypeScript、相关文件 ESLint、git diff --check 均通过。截图保存在 Marketing test-results 的 SEO acceptance typography 用例目录。
- 本地浏览器测试使用无生产凭据的隔离 server 与响应 fixture，不能冒充线上已部署修复。

本次不宣称全量仓库所有历史测试、SEO 全部 84 项检测、外部 AI 接收端或生产新版本验收通过。

## 第二轮关闭记录

用户批准“完成剩余部分的验收和修复，然后提交上线”。基线已快进合并到 `047b9d5754f556ad6d6cd1adb1a62834c9197d2b`，保留远端其他任务改动。

已关闭：

- 6.1 改为独立 `page_inbound_link_count`，按其他来源页面去重，排除自链接，覆盖首页及非 sitemap 页面。完整性需无停止原因、无出链截断、四类缺口计数明确为 0。否则只发布已观察正值，不发布未知零值。逐页缺少显式 count 时，即使 targetTested=true 也不得通过。
- noindex 仅在实际采集的 sitemap 声明中存在该页时成为冲突 blocker；没有冲突声明的页进入“仅观测”，保留 URL 与核对意图说明，不计分，也不会被同项另一页的 pass/blocker 隐藏。未抓取 sitemap 不使用缓存页标记推断意图。
- 图片抓取异常不再覆盖性能原因；field 与 lab 的缺失原因独立；本工具主动超时单列。性能来源并未更换，也没有用实验室指标代替真实用户值。
- schema 升至 `seo_audit.sitewide.v19`，完整中立 ledger 为 56 条；旧 v18 缓存按 miss 重新抓取，缺省 tier 的老客户端继续 key-pages。

验证：

- 全量 unit：1,180 文件 / 18,897 测试通过，76 秒；证据由 gstack-evidence 绑定当前工作树。
- Marketing 生产构建通过；Marketing/Public Tools typecheck 通过；中英文 SEO E2E 11/11 通过。
- `verify:docs`、`verify:authority`、`verify:spec`、`deploy:check`、`git diff --check` 通过。
- 独立复查最终无新增 P1/P2；行为路径覆盖估计 97%（不是仪表化行覆盖）。外部 AI 接收方的真实服从度 eval 未运行，确定性引用与目标绑定测试已通过。
- 整仓 secret scan 仍命中未修改的 `agent-issue-prompt.test.ts:495` 人工 JWT 测试夹具；该文件与 origin/main 完全一致。Public Tools lint 的 `model.ts:237` 未使用函数也是原有问题；本轮未更改该函数。发布 diff 另做凭据扫描，不把全仓历史红项声称为通过。
- 仓库没有 VERSION/CHANGELOG；产品 `0.3.0` 受 active authority 锁约束，本轮不创建另一套产品版本体系。发布绑定 Git SHA，抓取契约独立升 v19。

生产性能验证边界：Vercel 确认 PAGESPEED_API_KEY 是 Production/Preview 的 Sensitive 变量，无法导出；本地 env run 得不到值不等于生产未配置。真实运行时来源状态必须在部署后验证，不能以本地源码修复替代。

当前此提交准备时，生产发布和真实来源验证尚未完成；最终 SHA/READY/alias/运行结果另记发布证据。
