# SEO Agent 生产关闭验收 — 2026-09-07

## 首次发布与真实运行

- PR #317 已合并，SHA `8ccd74c532fd146a9a79eb0dff7dd982995a300d`。
- Marketing 部署 `dpl_CeNFX9E3S5RTKHurfUjHg9PhxjRB` READY，gengrowth.ai / www.gengrowth.ai 指向该版本。
- 全量合并后 unit：1,191 文件 / 19,193 测试通过；Marketing build/typecheck、Public Tools typecheck、SEO E2E 11/11 通过。
- 有一次与并行构建同时运行的旧 content-brief 耗时测试超预算；原断言未改，单独复跑与后续全量运行均通过。
- 生产中英文 SEO 页面 HTTP 200；www 跳转至主域；US / en-US 默认已填；未认证 POST 返回 401/no-store。

已登录生产域名真实 full-site 审计 HTTP 200，约 147 秒，使用 `seo_audit.sitewide.v19`，cache MISS：

- 214 页、3,876 链接、195 sitemap URL，跳过 16、disallowed 23、errored 0、stopReason null。
- 6.1 新记录有 214 条明确正入链观察，UI 为 214/214 已评估并通过。抓取仍有缺口，因此这些正值可用，不能据此推断未采集链接不存在。
- 8 个 noindex URL 都不在采集的 sitemap 内，均展示为“仅观测/核对意图”，不再算阻断。
- 生产候选说明字号实测 12px，无供应商名称正文。
- 性能 8.1–8.5 都返回 `the_performance_request_timed_out_this_run`；图片测量单独成功。此次实测明确证实原 20 秒请求截止过短，不再把原因混为来源异常。

## 真实超时后的补丁

- PageSpeed 请求上限从 20 秒改为 60 秒，仍然只请求一次，不自动重试。
- 从 handler 进入时计时，SEO 为图片最多七批各六秒及响应预留 45 秒；可给性能的剩余预算截止到第 255 秒。
- On-Page 另为两个顺序、各 30 秒的 SERP 请求预留 65 秒，其性能截止点为第 190 秒；没有新增 SERP 调用。
- 预算已耗尽时不启动性能/图片请求，明确标为“审计剩余时间不足，尚未发起采集”，不冒充来源超时或站点性能故障。
- 新测试先复现旧 20 秒下失败的 30 秒正常响应，再验证 60 秒成功、较短预算主动中断、SEO/On-Page 的剩余预算与不调用分支。
- 独立复查先发现 On-Page 只预留 35 秒的缺口，修为 65 秒并补先红后绿回归；最终限定范围无新增 P1/P2。

此文档创建时补丁尚待再次部署及真实来源复验，不把预算修复或变量存在写成来源恢复。

## 产品站边界

此次 merge 的 Product 构建 `dpl_65JmkEks1ZdbpiqmsZ92EpWKCAot` 被过滤为 CANCELED；未替换 app.gengrowth.ai。
实际 `/api/mvp/health/version` 仍返回旧 SHA `de82f380bf2d531907bfad825dc4b755deced053`。
独立 `/api/mvp/health/ready` 返回 503，原因是 worker 未就绪。该站点未被本次 SEO 发布改变；没有把它标为健康，也没有越界修改 worker。

最终生产 SHA、READY/alias 与性能来源再次运行结果记录在本任务最终交付及发布验收附件中。
