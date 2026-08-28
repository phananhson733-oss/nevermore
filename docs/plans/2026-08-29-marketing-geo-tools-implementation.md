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
