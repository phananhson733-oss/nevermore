# SEO Quick Wins 上线清单（Owner 操作）

日期：2026-08-03
代码状态：**已全部合入 main** — `8738c73` (#37 工具本体) + `5a100b0` (#41 Title/Meta 草稿)
当前状态：**代码就绪，对外不可用**。以下每一步都只能在 Google Cloud Console 或部署平台里做，没有 CLI 接口。

---

## 为什么代码合了还用不了

工具读访客自己的 Search Console 数据，走 Google OAuth。`webmasters.readonly` 是 Google 的**敏感范围（sensitive scope）**，同意屏没通过验证时，只有测试名单里的账号能授权，其他人会被 Google 硬拦。

代码已经如实处理了三种状态（`apps/marketing/src/lib/tools/traffic-drop-session.ts` 的 `GoogleConsentNotice`）：

| 状态 | 页面表现 |
|---|---|
| `invite_only` | 同意屏在 Testing，只有测试名单能授权。页面先说明原因，授权链接降为次要 |
| `none` | 默认。流程无感，按钮保持主要 |

> `unverified` 档已于 2026-08-10 移除：Google 只对**未批准的敏感/受限范围**弹「此应用未经验证」插页，而本项目请求的 `openid email profile webmasters.readonly` 全部属非敏感档，没有访客会遇到那一屏。默认值同时从 `invite_only` 改为 `none` —— 同意屏是已发布的正式版，`invite_only` 要在真的切回 Testing 时显式设置。

所以**开门之前页面不会假装能用**，但也确实没人能授权。

---

## 第 1 步：打开 feature flag

环境变量：`MARKETING_GSC_CONNECT_ENABLED`

| | |
|---|---|
| 值 | `true` |
| 位置 | Vercel → `nevermore` 项目 → Settings → Environment Variables |
| 环境 | Production（预览环境按需） |
| 读取处 | `apps/marketing/src/lib/tools/traffic-drop-session.ts` 的 `isGoogleConnectEnabled()` |

注意它**只有服务端变体**，没有 `NEXT_PUBLIC_` 版本，这是故意的：连接开关不该出现在客户端 bundle 里。

改完需要重新部署才生效。

**验证**：访问 `/en/tools/seo-quick-wins`。开之前页面显示「The Google connection is not open in this environment yet.」；开之后这句话消失，出现 Connect Search Console 按钮。

---

## 第 2 步：确认 Google 同意屏验证状态

| | |
|---|---|
| 位置 | Google Cloud Console → APIs & Services → OAuth consent screen |
| GCP project number | `335450701160` |
| 要看的 | Publishing status（Testing / In production）和 Verification status |
| 涉及的 scope | `https://www.googleapis.com/auth/webmasters.readonly` |

三种情况对应的动作：

- **Testing** → 只有 Test users 列表里的账号能授权。要么把人加进列表（适合内测），要么提交验证
- **In production（当前状态）** → 所有人能授权。请求的范围全部非敏感，所以不经过任何插页；验证未提交也不影响这一点

**验证**：用一个**不在**测试名单里的 Google 账号走一遍授权。能走到底并看到自己的 property 列表，就是通了。

---

## 第 3 步（可选）：打开 Title/Meta 草稿

不配这两个变量，工具照常工作，只是不出草稿区。**这是受支持的状态，不是降级**——代码里有测试断言未配置时连 `page` 和 `query,page` 两个 Search Console 维度都不会去请求，一分钱不多花。

| 变量 | 必填 | 说明 |
|---|---|---|
| `QUICK_WINS_DRAFT_API_KEY` | ✅ | 模型 API key |
| `QUICK_WINS_DRAFT_MODEL` | ✅ | 模型名。Azure 填**部署名** |
| `QUICK_WINS_DRAFT_URL` | | 默认 OpenAI chat completions 端点 |
| `QUICK_WINS_DRAFT_AUTH_SCHEME` | | `bearer`（默认）或 `api-key`。**Azure 必须是 `api-key`** |
| `QUICK_WINS_DRAFT_TEMPERATURE` | | 默认 0.4。取值超出 [0,2] 或无法解析时回落到默认值 |

读取处：`apps/marketing/src/lib/tools/quick-wins-draft-config.ts` 的 `draftModelFromEnv()`。

### 接 Azure OpenAI

Azure 不是「换个 URL」就能接的，协议有两处不同，两处都会让整个请求失败而不是降级：

- 认证头是 `api-key`，不是 `Authorization: Bearer` → 必须设 `QUICK_WINS_DRAFT_AUTH_SCHEME=api-key`
- 推理类部署往往只接受一个 temperature 值 → 按你的部署设 `QUICK_WINS_DRAFT_TEMPERATURE`

URL 要写完整的部署路径，含 `api-version` query：

```
QUICK_WINS_DRAFT_URL=https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=<version>
QUICK_WINS_DRAFT_MODEL=<deployment>
QUICK_WINS_DRAFT_AUTH_SCHEME=api-key
QUICK_WINS_DRAFT_TEMPERATURE=1
```

同样的四个值在 Railway 的 worker 上是 `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_DEPLOYMENT` / `OPENAI_API_VERSION` / `OPENAI_TEMPERATURE`，URL 的拼法见 `apps/worker/src/env.ts` 的 `resolveLlmClientConfig`。

**密钥不要和 worker 共用同一把。** Azure OpenAI 资源有 key1/key2 两把，给这个公开工具用第二把，出事时可以单独轮换而不影响产品。

**成本边界**：单次运行最多为 5 行生成草稿（`MAX_DRAFT_ROWS`），爬取范围硬性锁在授权的 property 内，每页 6 秒超时、512KB 上限，模型调用 20 秒超时、`max_completion_tokens` 400。推理 token 算进这 400 里。

---

## 上线后怎么确认它真的在工作

1. 用一个有真实数据的 property 跑一次
2. 看这几件事是否成立：
   - 表格上方写着测量区间（太平洋时间的 28 天）
   - 每行的「你站同位置」基准**不等于**行业通用值（28%/11%/2% 那套）
   - 限制清单里**每次都有** `serp_cause_unobserved`——这条是无条件发出的
   - 匿名缺口那一段给出的是百分比或「无法计算」，不是 0%

第 2 条是这个工具的核心主张。如果基准看起来像通用表，说明有东西回退了，去看 `packages/public-tools/src/site-baseline/ctr-curve.ts`。

---

## 已知会看到但不是故障的情况

| 现象 | 原因 |
|---|---|
| 证据表只有个位数行 | 正常。实测 ICP 小站 `impr≥100` 的查询只有 54 条，`≥1000` 只有 2 条 |
| 「接近首页」相关的行为空 | 正常。实测该类候选数为 0 |
| 匿名缺口显示 40%+ | 正常。Search Console 出于隐私隐去低频查询，实测该站 46% 曝光 / 64% 点击不在查询表里 |
| 大部分行没有草稿 | 正常。草稿需要同站、同位置段、点击率明显更高且曝光足够的对照页，多数查询没有 |
| 某个位置段整体低于 1% | 会触发 `site_level_low_ctr_band`。段本身就是发现，不是段内每条查询各自的问题 |

---

## 排查

| 症状 | 先看 |
|---|---|
| 页面说连接未开放 | `MARKETING_GSC_CONNECT_ENABLED` 是否为 `true` 且已重新部署 |
| 授权后 property 列表为空 | 该 Google 账号是否拥有已验证的 property |
| 报 `rate_limited` | per-IP 每小时 10 次上限（`GSC_IP_MAX`）。配额按 GCP project 计，这是保护其他访客 |
| 报 `quota_unavailable` | 配额存储不可用，闸门 fail-closed。检查 Supabase 连接与 `consume_public_tool_quota` 迁移是否已应用 |
| 报 `scan_in_progress` | 同一 IP 已有一次 Search Console 读取在跑，与 traffic-drop 共用这个闸 |
| 草稿区一条都没有 | 先确认 `QUICK_WINS_DRAFT_API_KEY` 和 `_MODEL` 都已配；再看每行给出的跳过原因 |
| 每行都是 `model_unavailable` | 模型调用被拒。Azure 的话先查 `_AUTH_SCHEME` 是不是 `api-key`、temperature 对不对。Vercel AI Gateway 的话在其 Logs 里看真实状态码 |

---

## 相关

- 设计权威：`docs/plans/2026-07-31-public-tools-v3-solution.md`（§二 = P0-1，§2.5 = 草稿）
- 实测证据：`docs/plans/2026-07-31-p0-1-p0-3-evaluation-results.md` §一
- 落地页文案：`docs/plans/2026-08-03-p0-1-landing-copy-v2.md`（顶部标注了哪些段落描述的能力尚未实现）
