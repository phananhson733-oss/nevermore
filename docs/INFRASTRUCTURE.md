# 基础设施对应关系

> 本文件只记**标识与归属**，不含任何密钥。
> 最后核实：2026-08-07（Supabase 跨账号迁移当天，所有条目均已实测）。

## 先解决命名混淆

同一个东西在不同平台叫不同名字，这是排错时最常见的误判来源：

| 说的是 | 实际指 |
|---|---|
| `nevermore` | **代码仓库名**，也是 Vercel 上产品站的项目名，也是新 Supabase 项目名 |
| `signalframe` | 同一套代码的旧内部代号，Railway 项目名、包名前缀 `@sf/*` 沿用至今 |
| GenGrowth | **产品/品牌名**，对外域名 `gengrowth.ai` |
| `gengrowth-agents` | **Vercel 上营销站的项目名**，不是 Supabase 项目 |
| `astrologywiki` | 数据库里 `app.client_projects` 的一条**业务数据**（被诊断的客户站），不是我们的项目 |

一句话：**仓库 `nevermore` = 产品 GenGrowth**，部署成两个站，共用一个 Supabase 和一个 worker。

## 全景

```
GitHub  phananhson733-oss/nevermore
   │
   ├── Vercel  team wzbs-projects-39a68c1d
   │     ├── nevermore          → app.gengrowth.ai   （产品站 apps/web，basePath /app）
   │     └── gengrowth-agents   → gengrowth.ai       （营销站 apps/marketing）
   │
   ├── Railway  project signalframe / service worker （apps/worker，常驻）
   │
   └── Supabase  pxgzmoypkyyutpcmqexa                （三者共用同一个库）
```

## GitHub

| 账号 | 状态 |
|---|---|
| `phananhson733-oss` | **当前使用**，仓库 `https://github.com/phananhson733-oss/nevermore.git` |
| `xdawayer` | **2026-08-07 被封**。申诉入口 support.github.com/contact/account-recovery |

**CI**：2026-08-07 起**不用 GitHub Actions**，workflow 改为仅手动触发。
验证靠本地命令 + Vercel 构建。注意 Vercel **不跑**单测 / spec 锁 / 密钥扫描。

## Vercel

Team：`wzbs-projects-39a68c1d`（orgId `team_DiJchcMOf6mt4u2ulO7Bq5XK`）

| 项目 | projectId | 域名 | 源码 |
|---|---|---|---|
| `nevermore` | `prj_US92arhXEoBqryGZrMeLvJVg8jnd` | `app.gengrowth.ai` | `apps/web` |
| `gengrowth-agents` | `prj_HzRnuXaewqxu27P013fUwh6D2fWV` | `gengrowth.ai` | `apps/marketing` |

**产品站有 basePath `/app`**：健康检查是 `https://app.gengrowth.ai/api/mvp/health/ready`
（**不带** `/app` 前缀，带了会 307）；页面路由才带，例如 `/app/login`。

**营销站变量分 Production / Preview 两套独立值**，`vercel env ls` 能看到同名两行、
不同 target。**只改一套是历史上翻车最多的一次**（preview 上爬虫工具曾永久 503）。

**旧版 Vercel CLI（54.x）加 preview 变量必须带 `--value`**，stdin 无效；
不想让密钥进进程参数就走 REST API：
`POST https://api.vercel.com/v10/projects/{id}/env?teamId={team}&upsert=true`
（token 在 `~/Library/Application Support/com.vercel.cli/auth.json`）。

## Supabase

| 项目 | ref | org | 状态 |
|---|---|---|---|
| **`nevermore`** | **`pxgzmoypkyyutpcmqexa`** | `phananhson733-oss's Org` | ✅ **当前生产**，region `us-west-2` |
| `nevermore-production` | `ebjytnmtrwzyqxmxrtho` | `gengrowth` | ⛔ 已弃，控制台永久失联 |
| `Agents` | `qeeocwurjslqppjxlsbk` | `gengrowth` | ⛔ 已暂停 + 失联，见下 |

**2026-08-07 迁移**：`ebjytnmtrwzyqxmxrtho` → `pxgzmoypkyyutpcmqexa`。
原账号只绑 GitHub，随封号永久失去控制台（官方明确回复不支持密码重置）。

**注意 region 变了**：旧 `us-east-1` → 新 `us-west-2`，而 Vercel/Railway 在美东，
存在跨区往返开销。Supabase 不能改已建项目 region，要换只能新建重迁。

### 数据库结构

| schema | 内容 | 谁在用 |
|---|---|---|
| `app` | 78 张表 + 1 视图，产品全部业务数据 | 产品站 + worker |
| `public` | 2 张表（`public_tool_crawl_cache` / `public_tool_rate_limits`）+ 5 个函数 | **营销站公开工具限流/缓存** |
| `pgboss` | 作业队列，pg-boss 启动时自建 | worker |
| `storage` | 桶 `raw-imports` / `exports` | worker |

`app` schema **没有跨 schema 外键**，自成闭环。
`app.operator_profiles.user_id` 指向 `auth.users`，但**没有外键约束** ——
只迁 `--schema=app` 会悄悄丢掉身份映射。

**营销站还引用 8 张表**（`blog_posts` / `glossary_terms` / `legal_documents` /
`legal_document_versions` / `link_redirects` / `consent_events` /
`technical_url_inventory` / `change_logs`）——它们只存在于已暂停的 `Agents` 项目里，
**从未存在于生产库**。所以 `/blog`、`/glossary`、`/privacy` 等页面是空态 /
"coming soon"，这是**账号失联的既有后果，不是回归**。
`BLOG_LEGACY_SUPABASE_ENABLED=false` 就是为此。

### 验证锚点

```bash
DATABASE_URL=<新库> pnpm db:migrate:check
#   → 78 app tables, 18 authority hash columns, 105 indexes, 151 triggers, 70 routines
DATABASE_URL=<新库> pnpm db:smoke
#   → Schema smoke test passed (fixtures rolled back)
```

必须在**基于 `origin/main` 的工作区**跑：陈旧 worktree 的 `LATEST_APP_MIGRATION`
对不上，会误报 `database migration version is missing or stale`。

## Railway

Workspace `xdawayer's Projects` · Project `signalframe`
（`94ea4303-be73-4228-a778-dfd2aa7ecd87`）· Service `worker`

```bash
railway variables --json | jq -r .DATABASE_URL   # 生产连接串的权威来源
railway logs | tail -30
railway redeploy                                  # 复用现有镜像，只换环境变量
```

- **`railway up` 会上传本机源码**——工作区在旧分支就会把陈旧代码推上生产。
  换环境变量用 `railway redeploy`，不要用 `railway up`。
- 排错先比 worker 日志里的 `buildSha` 与 `git rev-parse origin/main`，
  不一致说明部署漂移。`APP_BUILD_SHA` 变量要与之同步。
- 拿 `DATABASE_URL` 去跑 `psql` / `pg_dump` **必须去掉 query string**
  （`?uselibpqcompat=true&sslmode=require`），但应用侧要保留。

## GCP / Google OAuth

项目 `lynne-may`，编号 `289814295834`。
控制台：https://console.cloud.google.com/apis/credentials?project=lynne-may

> 定位技巧：OAuth client id 的**数字前缀就是 GCP 项目编号**，不用翻控制台。

| 用途 | client | 在哪 |
|---|---|---|
| 产品站登录 + GSC 数据授权 + Supabase Google provider | `289814295834-k0eu165...` | Vercel `nevermore` + Railway + Supabase Auth |
| 营销站自建 OAuth（redirect 含 `gengrowth.ai/api/auth/google/callback`） | 另一个 client | Vercel `gengrowth-agents` |

**Supabase Auth 需要的回调**（缺了 Google 登录必失败）：
`https://pxgzmoypkyyutpcmqexa.supabase.co/auth/v1/callback`

Supabase 侧 Site URL = `https://app.gengrowth.ai`；
Redirect URLs 含 `https://app.gengrowth.ai/app/auth/callback`
和 `https://gengrowth.ai/api/auth/google/callback`。

## 环境变量落点

| 变量 | Vercel `nevermore` | Vercel `gengrowth-agents` | Railway |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | ✅ |
| `SUPABASE_URL` | ✅ | ✅ (Prod+Preview) | ✅ |
| `NEXT_PUBLIC_SUPABASE_URL` | — | ✅ (Prod+Preview) | — |
| `SUPABASE_ANON_KEY` | ✅ | — | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — | ✅ (Prod+Preview) | — |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | — | ✅ |
| `SUPABASE_SECRET_KEY`（service_role 的别名） | — | ✅ (Prod+Preview) | — |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET` | ✅ | — | ✅ |
| `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | — | ✅ | — |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID`（One Tap 用） | — | ✅ | — |
| `APP_ORIGIN` = `https://app.gengrowth.ai` | ✅ | — | ✅ |
| `APP_BUILD_SHA` | ✅ | — | ✅ |

`APP_BUILD_SHA` 在产品站和 worker 上**各有一份，必须同步**——不一致会导致
两边行为对不上（画像生成失败的经典症状）。`railway up` 之后尤其要检查。

`DATABASE_URL` 必须是 **Supabase session 模式（端口 5432）**。
`packages/contracts/src/runtime-url.ts` 的 `postgresUrlIssue()` 会**拒绝事务池
6543 端口**，配错了服务起不来。

## 故障速查

| 现象 | 先查什么 |
|---|---|
| `TypeError: fetch failed`（Supabase） | URL 是不是 HTTP 端点——曾经错填成 pooler DSN；再查项目是否暂停 |
| `401` | 连上了，密钥不对 |
| `404` | 连上了，表 / 函数不存在 |
| `Invalid API key` | URL 对了，密钥是别的项目的 |
| 公开工具 `quota_unavailable` / 503 | 先看日志 `branch=` 字段，多半是 preview 那套变量；再查 `public` schema 的 3 个 RPC 是否存在且授权正确 |
| 登录成功但看不到任何数据 | 查 `app.operator_profiles.user_id` 是否指向当前登录用户，不是数据丢了 |
| Growth Map / 竞品 / 诊断为空 | 先查画像是否已确认，别先查采集 |
| worker 行为与代码不符 | 比 `buildSha` 与 `origin/main` |
