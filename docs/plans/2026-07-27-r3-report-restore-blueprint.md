# R3 恢复蓝图:Results 屏上的客户报告与导出(2026-07-27,v2 —— 经 codex 对抗评审修订)

Owner 裁决(任务 #12):stop gate §14.8 R3 按「恢复入口」处理。本蓝图是实现 agent 的唯一
权威。v2 吸收 codex 评审的 5 P1 + 5 P2(末尾「评审记录」)。锚点 symbol 优先,行号近似。

## 0. 背景(证据锚点,已核验)

- 服务端全活:`GET /report`、`POST /exports`(限流 10/15min,active key `export:{kind}`,
  409 `RUN_ALREADY_ACTIVE`)、`GET /exports/{exportId}`。投影/分页/导出服务测试全绿。
- 死客户端 `report/_report.tsx`(~1357 行)所有 import 都活;`report.module.css`
  (1440 行,print 块 ~:1292-1439)唯一消费者;`hooks-report.ts` 唯一消费者。
- **结构事实(v1 的「整体搬 ReportContent」不可执行)**:`ReportContent`(~:1112)调用
  的 section 组件几乎全在它上方;report query / URL locale state / 错误恢复在它下方的
  `ReportClient`(~:1244)—— 迁移必须按 D2 的三层接缝重组,不是搬一段行区间。
- **导出 409 的服务端现状**:`export-service.ts` 两处 `RUN_ALREADY_ACTIVE`(~:84 与
  ~:161-176)只给 `Location` header,body 无指针;客户端 fetch wrapper 丢弃非 2xx 的
  `Location`(`client.ts` ~:92)→ 跨 tab 409 后客户端没有任何可跟踪的 export identity。
  `ExportBundlesRepository.findByRun`(`packages/db/src/repositories/export-bundles.ts`
  ~:68)已存在,可查 active run 对应 exportId。
- 旧 `ExportSection.start()` 第一行 `setActive(null)`,按钮只在 POST pending 时禁用 →
  运行中再点会**卸载正在轮询的 ExportStatus 且丢失 exportId**(v1「原样迁移」已废,见 D5)。
- mock 三条路由已存在(`mock-api.ts` report ~:595 / exports ~:613 / export-bundle
  ~:630;export detail 首次 GET 即 completed —— D8 要扩)。
- 视觉基线实际是 **3 张 darwin + 3 张 linux** 的 `canonical-relayops-report-*`
  (wide/desktop/mobile),不是 6+6。`_results.tsx` 的 prior/currentObservedAt 直接渲染
  在 `<dd>`,现有 mask(`<time>` 与 `report-dynamic-value`)盖不住 → 必须加 mask 锚点。
- N-1:results/report/hooks/export-service 全在冻结面外;`globals.css` 的 shell print
  隐藏已修好(776b24c),**不动 globals**。
- `verifyReportAndExport()`(real spec ~:600-644)已从 `/results` 进入,主 helper 无需
  重瞄 —— 它是现成验收。

## 1. 变更边界(精确 allowlist;每个 commit 用 `git show --name-only --format= <sha>`
自查为子集;不用整个脏 worktree 的 diff 当证据)

```text
apps/web/src/app/p/[projectId]/results/**                                (含新文件)
apps/web/src/app/p/[projectId]/report/_report.tsx                        删除
apps/web/src/app/p/[projectId]/report/report.module.css                  git mv → results/
apps/web/src/app/p/[projectId]/_canonical-routes.test.ts                 D4/D2 点名适配
apps/web/src/lib/api/hooks-report.ts                                     (poll helper 抽出/加测试)
apps/web/src/lib/api/hooks-report.test.ts
apps/web/src/lib/services/export-service.ts                              仅 D5 的 409 current
apps/web/src/lib/services/__tests__/export-service.test.ts               同上
packages/i18n/src/messages/en.json
packages/i18n/src/messages/zh-CN.json
e2e/mock-api.ts                                                          D8 扩 export 序列
e2e/critical-flows.mock.spec.ts                                          复活 REMOVED 用例
e2e/frontend-error-states.mock.spec.ts                                   复活 REMOVED 用例
e2e/a11y.spec.ts                                                         D3/D9 点名适配
e2e/project-isolation.spec.ts                                            仅断言加强时
e2e/real-vertical-chains.spec.ts                                         screen 名 + mask
e2e/real-vertical-chains.spec.ts-snapshots/canonical-relayops-{report,results}-*.png
```

overview / growth-map / sources / globals.css / shell 组件一行不碰。`report/page.tsx`
保持 redirect 不动。

## 2. 设计裁决 D1-D10

**D1 组合形态与顺序**:Results = 屏级页头(h1)→ recheck 区块(本名)→ 客户报告区块。
`DeliveryHero` 丢弃。`data-report-page` / `data-report-document` /
`data-report-manifest-rail` 锚点原样保留在报告区块。

**D2 三层接缝(取代 v1 的「搬行区间」)**:

```text
results/page.tsx  ─> ResultsClient(projectId, initialOutputLocale)
ResultsClient
  ├─ ScreenHeader                // 屏级 h1(新 key results.pageTitle)
  ├─ RecheckResultsSection       // 独占 useProjectResults;三态自理
  └─ ReportSection               // 独占 report/export/locale 状态
ReportSection(results/_report-section.tsx)
  ├─ useProjectReport + outputLocale URL/draft controller(自愈 replace 原样迁)
  ├─ report loading/error/retry(只影响本区块,不 early-return 整页)
  └─ ReportDocument + ExportRail
ReportDocument(results/_report-document.tsx 或 _report-sections/ 拆分,单文件 <800 行)
  └─ 纯渲染:header/coverage/findings/plan/artifacts/methodology
```

**独立 query boundary 是硬要求**:report 失败不吞 recheck,recheck 404 不吞 report。
验收四象限:results 200/report 200、404/200、200/503(+retry)、404/503 —— 每种断言
另一块不被吞。`report/` 目录最终只剩 redirect `page.tsx`;`_canonical-routes.test.ts`
对 `ReportClient` 的残留 mock 清理 + D4 适配(点名授权)。

**D3 heading tree(固定,按 role/name 断言,不只数 h1)**:

```text
h1 results.pageTitle(新 key:"Results"/「结果」)
  h2 results.title(Recheck results,既有 key,现有 h2 保持)
  h2 报告 projectName(ReportHeader h1 降级)
    h3 报告各编号 section(现 h2 全部降一级)
      h4 action/finding 卡片标题(现 h3)
  h2 report.export(ExportSection 保持 h2 —— 它是 document 的 sibling,不降)
    h3 manifest 标题(现状核实后定,保持相对层级)
```

a11y 断言:`main` 内唯一 h1 名为 `results.pageTitle`;`[data-report-document]` 内
projectName 是 h2;全页恰好一个 h1。`a11y.spec.ts` 的 `[data-report-page] h1` 断言
重瞄为上述 role/name 断言(点名授权,commit message 说明)。

**D4 outputLocale 深链**:`results/page.tsx` 加 `searchParams`,沿用旧 page 的
`firstQueryValue` 语义(array 取第一项),malformed 交给 client normalize(自愈
replace 原样迁移)。`_canonical-routes.test.ts` 适配(点名授权):queryless →
undefined;`outputLocale=fr-FR` → "fr-FR";array 取第一项;`/report?…` redirect 保持
query 且首载不闪回 default。**语义红线:outputLocale 只选 methodology 文案与导出
locale,不翻译 findings/actions/artifacts;UI 不得暗示整报告翻译**(`outputLocaleHelp`
文案已把话说死,保持)。

**D5 导出闭合状态机(取代「原样迁移」)+ 服务端 409 指针(采纳完整方案,放宽 v1 的
零服务端红线)**:

服务端(独立 commit,与 R1 D6 同型،零契约税):`export-service.ts` 两处
`RUN_ALREADY_ACTIVE` 用 `ExportBundlesRepository.findByRun` 查 active run 的 bundle,
body 补 `current: { runId, exportId, kind }`(`Problem.current` 是
additionalProperties)。各配测试断言指针,变异各杀一条。

客户端状态机(抽 view-model 配单测):

```text
idle
  └─ create(kind)(single-flight fence)─> creating
       ├─ 202 + valid resourceRef.id ─> tracking(exportId, kind)
       ├─ 202 + missing/invalid resourceRef ─> protocolError(不许静默空白)
       ├─ 409 + valid current(zod safeParse:runId/exportId UUID)
       │        ─> tracking(current.exportId)(接管既有导出)
       ├─ 409 + missing/invalid current ─> conflictUnknown:显示「已有导出进行中,
       │        稍后重试创建」+ 显式重试;不假装在跟踪
       └─ 其他错误 ─> createError + 显式重试(exportErrorMessageKey 映射保持)
tracking(queued/running)
  ├─ 两个 create 按钮均禁用;正在 tracking 的 active 不得被新点击清空
  ├─ poll error ─> pollError:保留 exportId + Retry(refetch)恢复轮询
  ├─ completed/partial + downloadUrl ─> ready:manifest + download + 过期时间;
  │        重新启用 create
  └─ failed/cancelled/null downloadUrl ─> terminalFailure:exportFailed 文案;
           重新启用 create
```

`useProjectExport` 的 poll interval 逻辑抽成纯 helper 配单测(照 diagnosis poll test
形状:pending/四终态/query error 停、refetch 恢复、exportId 切换重置 backoff)。

**D6 print 边界**:Results 屏级页头 + recheck 区块 + export rail 包
`results.module.css` 的 `.screenOnly`;`@media print { .screenOnly { display: none
!important } }`(模块内规则,不动 globals)。报告自身 print 块随 `report.module.css`
迁移免费生效。print e2e 断言集:sidebar/topbar 隐藏、Results h1 隐藏、recheck
heading 与 observed values 隐藏、export rail 与所有 button/input 隐藏、
`[data-report-document]` 可见、报告标题/findings/actions/methodology 可见。v1 的
「a11y print 测试不用改」条款废除。

**D7 视觉基线**:visual screen `"report"` 改名 `"results"`;ready 条件 =
`[data-report-document]` 可见 **且 recheck 区块到达 terminal UI 且网络静默**。
`ObservedWindow` 的两个时间戳 `<dd>` 换成
`<time data-testid="results-dynamic-value" dateTime=…>`,mask 列表加
`[data-testid="results-dynamic-value"]`。基线:删 3 darwin + 3 linux 旧 `report` 基线;
生成并提交 3 darwin(本机)+ 3 linux(playwright 官方 docker image;先探测 docker)。
**docker 不可用 → 标 BLOCKED 停下报告,不许以「CI 待采」交付。**

**D8 mock 守卫复活与扩展**:
- `critical-flows.mock.spec.ts` 两条 REMOVED 用例原样复活(深链首载/刷新存活/驱动
  导出;清除 locale 恢复默认)。
- `frontend-error-states.mock.spec.ts` 两条 REMOVED 用例复活(区分已存在导出与服务
  暂不可用;bundle 读依赖错误 + retry —— retry 后必须走到 manifest/download 出现,
  不只数请求)。
- `mock-api.ts` export detail 扩成可编程序列:queued → running → 503 → (Retry) →
  running → completed+downloadUrl;409 开关(含/不含 current 各一);202 缺
  resourceRef 开关。
- 新增轻断言:`/results` 上 `[data-report-page]` 存在;双击 export 恰好 1 条 POST;
  tracking 中再点不卸载旧 poll(断言旧 exportId 的 GET 继续发生)。
- axe:在 report ready(`[data-report-document]` 可见且网络静默)之后跑;补 ready 态
  键盘路径:locale input → Print → Service bundle → Client bundle。
- 变异验证每条至少一杀,写 commit message;存活时先问「断言时目标分支挂载了吗」,
  连跑两遍。

**D9 既有测试适配(点名授权,各自单独说明)**:`_canonical-routes.test.ts`(D2/D4)、
`a11y.spec.ts`(D3 heading 重瞄 + D6 print 断言集 + D8 axe 时机)、
`project-isolation.spec.ts`(仅断言加强)。其余既有测试变红 = 停下报告。

**D10 契约**:除 D5 服务端 `current`(零契约税)外零变更;OpenAPI 不动、零迁移、计数
不变(49/9/44/11)。需要更多即停下报告。

## 3. 实现清单(TDD;测试与被守护功能同 commit)

1. `refactor(results)`:D2 迁移重组(ReportSection/ReportDocument 新文件、css git mv、
   死文件删除、canonical test 残留清理)。build/typecheck 绿;/results 尚未挂载新块。
2. `feat(results)`:组装(页头 h1 + recheck 样式化 + 报告区块 + D3 heading + D4 深链 +
   D6 print 边界)+ 相应 mock 断言。
3. `fix(exports)`:D5 服务端 current(含测试与变异)+ 客户端状态机 + poll helper 单测 +
   single-flight。
4. `test(results)`:D8 全场景复活与扩展 + 四象限 + 变异记录。
5. `test(results) 视觉`:D7 改名、mask、基线重采(darwin + linux docker)。

## 4. 门(最后一次改动之后跑;`pnpm -s` 只看退出码)

`pnpm verify:spec` / `verify:spec:test` / `implementation:check` / `contracts:check` /
`openapi:lint` / `secrets:scan` / `lint` / `typecheck`(+ `tsconfig.e2e.json` 单独)/
`build` / `pnpm test` / `pnpm test:integration`(disposable DB;export-service 改动的
targeted 测试必在其中)/ 完整 `pnpm test:e2e:mock`(基线 81/0 + 新增全绿)。real:
`verifyReportAndExport` 段在 R1+R3 都落地后由收尾轮跑完整 real 套件;本轮 targeted
跑通 mock 侧全部新场景即可,但视觉基线(D7)必须本轮闭环。Prettier hook 注意 diff
噪声。

## 5. 红线

- 变更文件必须是 §1 allowlist 子集(per-commit 自查)。
- overview/growth-map/sources/globals.css/shell 一行不碰。
- 既有测试变红:停下报告(D9 点名的除外)。
- 不得暗示报告内容会被 outputLocale 翻译。
- commit message 不写没做过的验证。

## 评审记录

v1 → v2:codex 第二意见确认并已采纳 —— 导出「原样迁移」会恢复未闭合跟踪状态机
(D5 状态机 + 服务端 current 指针 + single-flight + poll helper 单测);print 会把
recheck/页头印进客户报告(D6 .screenOnly 边界 + print 断言集);「搬 ReportContent
行区间」不可执行(D2 三层接缝 + 四象限);heading 会重复 results.title 且「全部降级」
过粗(D3 固定树 + role/name 断言);Linux 基线「待 CI」会让 CI 必红且基线数量实为
3+3、observed 时间戳未 mask(D7);canonical-routes test 适配未授权(D9 点名);
a11y 可能扫在 spinner 上(D8 axe 时机);export poll 无单元测试且 mock 首 GET 即
completed(D5/D8);门集缺 verify 族与 integration(§4);allowlist 精确化 +
per-commit 检查(§1)。
