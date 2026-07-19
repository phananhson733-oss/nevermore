# 手把手部署到 gengrowth.ai/app（中文版）

这是把 SignalFrame 上线到 **gengrowth.ai/app** 的一步步教程。跟着做，做完你就能在
`https://gengrowth.ai/app/login` 用真实账号登录。

> **你现在的位置**：代码已经写完、冻结成一个可部署的版本 `eabaab3`，本地所有门禁绿。
> 剩下的全是"在各家控制台点几下 + 验证"，不需要再改代码。
> 每步标了谁来做：**〔你〕** 需要你的账号/权限；**〔我〕** 可以让我帮你验证。

---

## 0. 先搞清三个东西是干嘛的（30 秒）

| 部件 | 跑什么 | 放哪 |
|---|---|---|
| **web** | 网站本体（登录页、界面、`/api/mvp` 接口） | **Vercel** |
| **worker** | 常驻后台（抓取、诊断、生成、导出的执行者） | **Railway**（一个 Docker 容器） |
| **数据** | 数据库 + 登录 + 文件存储 | **Supabase**（你已经在用的那个） |

关键规矩：**web 和 worker 必须用同一个版本 `eabaab3`、同一套数据库和密钥**。

**针对你的情况（已帮你查过，省不少事）：**
- ✅ 目标 Supabase **已经迁移好了**（28 张表 + pgboss schema 都在），第 2 步基本免。
- ⚠️ Storage 里只有 gengrowth 自己的 `blog-assets`，**还缺 `raw-imports` 和 `exports` 两个私有桶**，第 2 步要建。
- ✅ Google OAuth 客户端已经有了（localhost 回调已注册），第 3 步只需**加**一条生产回调。

---

## 1. 准备（5 分钟）〔你〕

1. 本地能跑命令：在项目目录 `/Users/wzb/Code/nevermore/signalframe-mvp-app` 打开终端。
2. 确认代码在正确版本、干净：
   ```bash
   git rev-parse HEAD        # 应以 eabaab3 开头
   git status --porcelain    # 应该没有输出（干净）
   ```
   > 如果不是 `eabaab3` 开头，先 `git log --oneline -5` 看一下，别在旧版本上部署。
3. 生成一把"凭证加密钥匙"（如果你还没有一把要长期用的）：
   ```bash
   openssl rand -base64 32
   ```
   把输出**记在密码管理器里**。这就是 `CREDENTIAL_ENCRYPTION_KEY`，web 和 worker 要**填一模一样的值**。
   > ⚠️ 这把钥匙一旦换掉，之前所有连过的 Google 账号都要重新连。**定下来就别改。**
4. 登录三家控制台，确认你有权限：[Vercel](https://vercel.com)、[Railway](https://railway.app)、[Supabase](https://supabase.com/dashboard)、[Google Cloud Console](https://console.cloud.google.com)。

---

## 2. Supabase：确认数据库 + 建两个私有桶（10 分钟）〔你〕

**2.1 确认数据库已就绪（几乎是现成的）**

你要的连接串是 **Session 模式**（不是 Transaction 模式）。在 Supabase → 你的项目 →
顶部 **Connect** → 选 **Session pooler**，复制那串 `postgresql://...:5432/postgres`。
把 `[YOUR-PASSWORD]` 换成数据库密码。

在本地终端确认表结构在（把下面的 `<串>` 换成你复制的、已填好密码的连接串）：
```bash
DATABASE_URL='<串>' pnpm db:migrate:check
```
- 期望：通过，提示 28 张表 + 索引 + 触发器都在。
- 如果它说要迁移，就先跑 `DATABASE_URL='<串>' pnpm db:migrate` 再 check 一次（幂等，重复跑没事）。

> 你的目标 Supabase 我已经查过，**28 张表 + pgboss 都在**，正常情况下 check 直接通过。

**2.2 建两个私有 Storage 桶** ⚠️ 必做

Supabase → 左侧 **Storage** → **New bucket**，建两个，**Public 开关都保持关闭（私有）**：
- 桶名 `raw-imports`
- 桶名 `exports`

> gengrowth 已有的 `blog-assets` 别动。

**2.3 给导出桶配 30 天生命周期**（可稍后，但上线前要有）

Storage → `exports` 桶 → 设置里配置对象 30 天过期（或按 Supabase 当前 UI 的
lifecycle/retention 设置）。这是规格要求的导出留存策略。

---

## 3. Google Cloud Console：加一条 /app 回调（3 分钟）〔你〕

登录时不需要 Google，但**连 GSC/GA4 需要**，而且回调地址必须和线上完全一致，否则报
`redirect_uri_mismatch`。

1. [Google Cloud Console](https://console.cloud.google.com) → 选到含这个 OAuth 客户端的项目
   → **APIs & Services** → **Credentials**。
2. 点开你那个 **OAuth 2.0 Client ID**（就是本地一直在用的那个）。
3. 在 **Authorized redirect URIs** 里，**新增一条**（不要删 localhost 那条）：
   ```
   https://gengrowth.ai/app/api/mvp/oauth/google/callback
   ```
   注意中间的 **`/app`**，少了它线上连 Google 会失败。
4. **Save**。（Google 有时要几分钟生效。）

---

## 4. Railway：部署 worker（15 分钟）〔你〕

worker 是个常驻后台进程，Vercel 跑不了常驻进程，所以放 Railway。

1. [Railway](https://railway.app) → **New Project** → **Deploy from GitHub repo** → 选中这个仓库。
2. Railway 会读仓库里的 `railway.json`，自动用 **Dockerfile.worker** 构建。（无需你配 build 命令。）
3. 进入这个 service → **Variables** → 把 `deploy/railway.worker.env.template` 里的变量一条条填进去。
   **要点：**
   - `DATABASE_URL` = 第 2.1 步那串 Session 模式连接串
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` = Supabase → Settings → API 里拿
     （service_role 是**密钥**，别外泄）
   - `CREDENTIAL_ENCRYPTION_KEY` = 第 1.3 步生成的那把（**待会 web 填一样的**）
   - `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` = Google 那个客户端的
   - `SF_BLOB_BACKEND=supabase`（生产必须是这个，不能 local）
   - `DB_POOL_MAX=3`（连接池小一点，别把 Supabase 连接数打满）
   - LLM 二选一：
     - 直连 OpenAI：`LLM_PROVIDER=openai` + `OPENAI_API_KEY` + `OPENAI_MODEL`（如 `gpt-4.1-mini`）
     - 或 Azure：把上面两行注释掉，填**全部四个** `AZURE_OPENAI_*` / `OPENAI_API_VERSION`（要么四个全填，要么一个都别填）
   - `APP_BUILD_SHA=eabaab3`（钉住版本，和 web 一致）
   - `NEXT_PUBLIC_BASE_PATH` / `SUPABASE_ANON_KEY` **worker 不要填**
4. 触发部署。部署后看 **Deploy Logs**，应看到：
   - 启动日志里有版本号（`eabaab3`）
   - 一次 recovery sweep（恢复扫描）
   - 拿到 **worker readiness lease**（就绪租约）
   - 日志里**不该出现**任何密钥值、模型输出、客户数据。

> worker 没有网页、没有健康检查端口，这是正常的——它就是个默默干活的后台。

---

## 5. Vercel：部署 web + 挂到 /app（15 分钟）〔你〕

1. [Vercel](https://vercel.com) → **Add New… → Project** → **Import** 这个 GitHub 仓库。
2. 关键设置：
   - **Root Directory** 选 **`apps/web`**（点 Edit 选到这个子目录）。
   - Framework 会自动识别 **Next.js**。（`apps/web/vercel.json` 已声明。）
   - 它是 pnpm monorepo，Vercel 一般能自动装好 workspace 依赖；若构建报找不到 `@sf/*` 包，
     在 Project Settings 里确认允许"包含 Root Directory 外的源码"。
3. **Environment Variables**（Production 环境）→ 照 `deploy/vercel.web.env.template` 填：
   - **`NEXT_PUBLIC_BASE_PATH=/app`** ← 这条最关键，它让整个站挂到 `/app` 下（构建期生效）
   - `APP_ORIGIN=https://gengrowth.ai` ← **只写到域名，不要带 `/app`**
   - `DATABASE_URL` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` = 和 worker **一样**
   - `SUPABASE_ANON_KEY` = Supabase → Settings → API 里的 anon key（web 专用）
   - `CREDENTIAL_ENCRYPTION_KEY` = **和 worker 填的一模一样**
   - `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` = 和 worker 一样
   - `DATAFORSEO_ENABLED=false`、`RAW_IMPORT_BUCKET=raw-imports`、`EXPORT_BUCKET=exports`、
     `SF_BLOB_BACKEND=supabase`、`DB_POOL_MAX=3`、`LOG_LEVEL=info`
   - `APP_BUILD_SHA=eabaab3`
   - **不要填** `SF_DEV_AUTH`（这是本地免登录后门，生产会忽略它，但保持不填最干净）
   - web **不要填** LLM 相关（那是 worker 的）
4. **Deploy**。部署成功后，确认 Vercel 构建日志里 base path 是 `/app`。
5. **绑定域名/路由**：让 `gengrowth.ai` 的 `/app/*` 指向这个 Vercel 部署
   （在 Vercel 的 Domains 里绑 `gengrowth.ai`，或在你现有 gengrowth 站点里把 `/app` 反代到这个部署——
   取决于 gengrowth.ai 现在怎么托管的，这一步按你现有架构来）。

> 改了环境变量后，Vercel 要**重新部署**才生效（尤其 `NEXT_PUBLIC_BASE_PATH` 是构建期变量）。

---

## 6. 验证：登录能用了吗（5 分钟）〔我可帮你跑〕

在**部署好的线上地址**上跑（把域名换成你实际绑的）。

**6.1 版本对上、/app 生效、根路径不通：**
```bash
curl -s https://gengrowth.ai/app/api/mvp/health/version
# 期望：返回的版本里带 eabaab3

curl -s -o /dev/null -w '%{http_code}\n' https://gengrowth.ai/app/api/mvp/health/live
# 期望：200

curl -s -o /dev/null -w '%{http_code}\n' https://gengrowth.ai/api/mvp/health/live
# 期望：404（说明确实挂在 /app 下，根路径没暴露）
```

**6.2 后台就绪（要 worker 活着才 200）：**
```bash
curl -s -o /dev/null -w '%{http_code}\n' https://gengrowth.ai/app/api/mvp/health/ready
# 期望：200。如果是 503，说明 worker 没连上——回第 4 步看 Railway 日志，别跳过这关。
```

**6.3 真实登录（里程碑）：**
浏览器打开 `https://gengrowth.ai/app/login`，用 Supabase 里的账号登录 → 应进入应用。
（登出应回到登录页；会话 cookie 是 HttpOnly/Secure。）

> 账号从哪来：Supabase → **Authentication** → Users → 新建一个用户，或按你们的注册流程。

**6.1 和 6.2 的 curl 你可以直接发给我，我帮你判读。** 走到这，**gengrowth.ai/app 登录就上线了。**

---

## 7. 完整 pilot 还要过的（登录之后，不阻塞登录本身）〔你〕

- 线上连 **GSC**（选 `sc-domain:gengrowth.ai`）跑一次真实采集
- 线上连 **GA4**
- 线上 **OpenAI/Azure** 真实生成一个 Artifact（本地那次是 401，线上要用真 key）
- 验证**导出下载**能下（签名 URL 15 分钟过期）、两个桶确认私有
- 做一次**恢复演练**（见 `docs/RESTORE-DRILL.md`）
- 你亲自走一遍**中英文 / B2B+B2C** 的输出，满意了签字

---

## 常见坑速查

| 现象 | 多半是 | 怎么修 |
|---|---|---|
| 登录后 Google 连不上，报 `redirect_uri_mismatch` | 第 3 步 `/app` 回调没加/没生效 | 回 Google Console 加那条带 `/app` 的，等几分钟 |
| `/app/...` 打不开、根路径反而能开 | Vercel 没设 `NEXT_PUBLIC_BASE_PATH=/app`，或改了没重新部署 | 补上并重新 Deploy |
| `/health/ready` 一直 503 | worker 没起来/没拿到租约 | 看 Railway 日志；确认 `DATABASE_URL` 是 Session 模式 |
| worker 或 web 启动就崩 | 环境变量缺/错（会 fail-fast 报哪个字段） | 照模板补齐；Azure 四个字段要么全填要么全不填 |
| 导出能生成但下载 404 | `SF_BLOB_BACKEND` 没设成 `supabase`，或桶没建 | 两边都设 `supabase`，建好 `raw-imports`/`exports` |
| 连接数报错/打满 | `DB_POOL_MAX` 太大 | web 和 worker 都设 `3` |

**顺序别乱**：先 Supabase（第 2 步）→ 再 Google（第 3 步）→ 再 worker（第 4 步）→ 再 web（第 5 步）→ 验证（第 6 步）。worker 先于 web 起来，`/health/ready` 才会 200。

参考：`docs/LAUNCH-CHECKLIST.md`（勾选版）、`docs/DEPLOYMENT.md`（拓扑与 Delta）、
`deploy/*.env.template`（变量模板）。
