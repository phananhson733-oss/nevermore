# gengrowth.ai/app 候选部署指南（中文版）

这是把 SignalFrame 上线到 **gengrowth.ai/app** 的候选教程。冻结规格 §3.2 仍要求
Railway web + worker；仓库里的 Vercel + Render + `/app` 配置尚无可核验的 Owner
批准记录。Owner 必须先明确选择并记录拓扑；如果没有批准候选方案，请停止使用本指南，
按冻结规格部署 Railway 双服务，仓库内共享镜像和两个入口的操作说明见
`docs/DEPLOYMENT.md` 的 “Frozen-spec Railway topology”。

> **当前状态**：本地实现仍在共享脏工作树中进行最终复验，没有可部署的 immutable SHA。
> 先完成全部本地门禁、形成干净 commit，再部署该精确 SHA。外部 Supabase、Storage、
> OAuth、provider 和 Owner 验收均必须现场验证，不能由仓库文档代替。
> 每步标了谁来做：**〔你〕** 需要你的账号/权限；**〔我〕** 可以让我帮你验证。

---

## 0. 先搞清三个东西是干嘛的（30 秒）

| 部件 | 跑什么 | 放哪 |
|---|---|---|
| **web** | 网站本体（登录页、界面、`/api/mvp` 接口） | **Vercel** |
| **worker** | 常驻后台（抓取、诊断、生成、导出的执行者） | **Render**（Background Worker，一个 Docker 容器） |
| **数据** | 数据库 + 登录 + 文件存储 | **Supabase**（目标项目待 Owner 核验） |

关键规矩：**web、worker 和 migration job 必须用同一个已冻结 commit、同一套数据库和密钥**。

下列外部状态全部视为**未验证**：目标 Supabase migration、pg-boss schema、两个私有
Storage bucket、Google OAuth client/redirect、GitHub remote 以及现有部署。只有 Owner
控制台证据和针对同一 release SHA 的实际检查才能把对应门禁改为完成。

---

## 1. 准备（5 分钟）〔你〕

1. 本地能跑命令。**注意 git 仓库在 `signalframe-mvp-app` 子目录，不是外层 `nevermore`**
   （在外层跑 git 会报 `not a git repository`）：
   ```bash
   cd /Users/wzb/Code/nevermore/signalframe-mvp-app
   ```
2. 记下你要部署的 SHA、确认工作树干净：
   ```bash
   git rev-parse --short HEAD   # 记下这串，这就是你要部署的版本（含 render.yaml + /app）
   git status --porcelain       # 应该没有输出（干净）
   ```
3. 由 Owner 确认目标 Git remote、默认分支和平台连接的仓库，并核对部署平台解析到
   第 2 步记录的精确 SHA。不要从本文推断某个私有仓库或自动部署已经存在。
4. 生成一把"凭证加密钥匙"（如果你还没有一把要长期用的）：
   ```bash
   openssl rand -base64 32
   ```
   把输出**记在密码管理器里**。这就是 `CREDENTIAL_ENCRYPTION_KEY`，web 和 worker 要**填一模一样的值**。
   > ⚠️ 这把钥匙一旦换掉，之前所有连过的 Google 账号都要重新连。**定下来就别改。**
5. 登录各家控制台，确认你有权限：[GitHub](https://github.com)、[Vercel](https://vercel.com)、[Render](https://render.com)、[Supabase](https://supabase.com/dashboard)、[Google Cloud Console](https://console.cloud.google.com)。

---

## 2. Supabase：确认数据库 + 建两个私有桶（10 分钟）〔你〕

**2.1 确认数据库已就绪（当前未验证）**

你要的连接串是 **Session 模式**（不是 Transaction 模式）。在 Supabase → 你的项目 →
顶部 **Connect** → 选 **Session pooler**，复制那串 `postgresql://...:5432/postgres`。
把 `[YOUR-PASSWORD]` 换成数据库密码。

在本地终端确认表结构在（把下面的 `<串>` 换成你复制的、已填好密码的连接串）：
```bash
DATABASE_URL='<串>' pnpm db:migrate:check
```
- 期望：通过，提示 28 张表 + 索引 + 触发器都在。
- 如果它说要迁移，就先跑 `DATABASE_URL='<串>' pnpm db:migrate` 再 check 一次（幂等，重复跑没事）。

> 只有这次针对目标项目的命令输出才能证明数据库已就绪；本地 disposable DB 的通过
> 记录不能替代生产检查。

**2.2 建两个私有 Storage 桶** ⚠️ 必做

Supabase → 左侧 **Storage** → **New bucket**，建两个，**Public 开关都保持关闭（私有）**：
- 桶名 `raw-imports`
- 桶名 `exports`

> 不要修改任何不属于 SignalFrame 的现有 bucket。

**2.3 确认 worker 拥有列表/删除权限**（上线前必做）

Supabase 的 S3 兼容接口不支持 lifecycle 配置，不要在控制台伪造一个“已启用
30 天生命周期”的验收结果。当前实现由 worker 按数据库时钟执行应用内留存：
raw/import/snapshot 字节 90 天，export 字节 30 天。因此 service role 必须能够对两个私有桶
create/read/**list**/delete，并在 worker 日志中验证只有聚合计数的 retention/orphan sweep 成功事件。

当前 pilot sweep 对 `raw`、`raw-import`、`snapshot-raw`、`export` 每一类都有
100,000 对象硬上限，而且没有持久化续扫游标。上线前必须记录每类对象数均不超过该上限，
根据成功 sweep 的聚合 `scannedCount` 提前告警，并把
`ORPHAN_CLEANUP_CAPACITY_EXCEEDED` 与
`STORAGE_RETENTION_CAPACITY_EXCEEDED` 接入值班告警。出现这些事件后不会靠每日重试或重启
自动恢复；扩容前必须先评审并实现 durable cursor/window 方案。

---

## 3. Google Cloud Console：加一条 /app 回调（3 分钟）〔你〕

登录时不需要 Google，但**连 GSC/GA4 需要**，而且回调地址必须和线上完全一致，否则报
`redirect_uri_mismatch`。

1. [Google Cloud Console](https://console.cloud.google.com) → 选到含这个 OAuth 客户端的项目
   → **APIs & Services** → **Credentials**。
2. 选择 Owner 明确批准用于该环境的 **OAuth 2.0 Client ID**；不要假设本地客户端已存在。
3. 在 **Authorized redirect URIs** 里，**新增一条**（不要删 localhost 那条）：
   ```
   https://gengrowth.ai/app/api/mvp/oauth/google/callback
   ```
   注意中间的 **`/app`**，少了它线上连 Google 会失败。
4. **Save**。（Google 有时要几分钟生效。）

---

## 4. Render：部署 worker（15 分钟）〔你〕

worker 是个常驻后台进程，Vercel 跑不了常驻进程，所以放 Render 的 **Background Worker**
（专为"没有网页、只后台干活"的进程设计的服务类型）。

> 成本提醒：常驻 worker 不能缩到 0，**是付费实例**（Render 免费档只给能休眠的 web 服务），
> 起步约几美元/月。任何平台的常驻 worker 都一样，这不是 Render 特有。

**方式 A（推荐，最省事）—— 用 Blueprint 一键建：**
1. [Render](https://render.com) → **New** → **Blueprint** → 选 **`xdawayer/nevermore`** 仓库。
2. Render 读仓库里的 `render.yaml`，自动创建名为 `signalframe-worker` 的 Background Worker，
   用 **Dockerfile.worker** 构建。
3. 它会提示你填所有 `sync: false` 的值，包括 origin-only 的 `APP_ORIGIN` 和下面
   “要点”里的密钥。`DB_POOL_MAX=3`、桶名、backend 与日志级别等固定值由 Blueprint 提供。

**方式 B（手动建）：** New → **Background Worker** → 连仓库 → Runtime 选 **Docker** →
Dockerfile Path 填 `./Dockerfile.worker` → 然后到 **Environment** 逐条填变量。

**变量要点**（完整清单见 `deploy/worker.env.template`）：
- `DATABASE_URL` = 第 2.1 步那串 Session 模式连接串
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` = Supabase → Settings → API 里拿
  （service_role 是**密钥**，别外泄）
- `CREDENTIAL_ENCRYPTION_KEY` = 第 1.3 步生成的那把（**待会 web 填一样的**）
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` = Google 那个客户端的
- `SF_BLOB_BACKEND=supabase`（生产必须是这个，不能 local）
- `DB_POOL_MAX=3`（连接池小一点，别把 Supabase 连接数打满）
- 这个已准备的 Blueprint 固定走直连 OpenAI：`LLM_PROVIDER=openai` +
  `OPENAI_API_KEY` + `OPENAI_MODEL`（如 `gpt-4.1-mini`）。运行时代码也支持
  Azure，但 `render.yaml` 没有编码该变体；若 Owner 选择 Azure，必须脱离本
  Blueprint 手工移除直连字段、填写全部四个 Azure 字段，并另做配置审查和部署验证。
- `FINDING_SUMMARIES_ENABLED=true` 会为非 English/`zh-CN` Finding 启用有预算的
  本地化摘要；若合规或成本策略要求关闭，显式设为 `false`，诊断会使用诚实标注为
  English 的确定性 fallback，Artifact LLM 配置不受影响。
- `APP_BUILD_SHA` **留空即可** —— Render 会自动带 `RENDER_GIT_COMMIT`，worker 启动日志会
  报出真实部署的 SHA（代码已支持读它）。只有想手动覆盖时才填。
- `NEXT_PUBLIC_BASE_PATH` / `SUPABASE_ANON_KEY` **worker 不要填**

触发部署后，看 Render 的 **Logs**，应看到：
- 启动日志里有版本号（你部署的那个 SHA，Render 会自动带上）
- 一次 recovery sweep（恢复扫描）
- 拿到 **worker readiness lease**（就绪租约）
- 日志里**不该出现**任何密钥值、模型输出、客户数据。

> worker 没有网页、没有健康检查端口，这是正常的——它就是个默默干活的后台。
> 冻结规格的 Railway 双服务不是 Render worker 的“等价替换”：它使用
> `Dockerfile.railway` 同一镜像承载 web 与 worker，具体命令见 `docs/DEPLOYMENT.md`。

---

## 5. Vercel：部署 web + 挂到 /app（15 分钟）〔你〕

1. [Vercel](https://vercel.com) → **Add New… → Project** → **Import** **`xdawayer/nevermore`** 仓库。
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
   - `APP_BUILD_SHA` **留空即可** —— Vercel 会自动带 `VERCEL_GIT_COMMIT_SHA`，
     `/health/version` 会在 `buildSha` 里报真实部署的 SHA（硬填一个对不上的值反而更糟）。
   - **不要填** `SF_DEV_AUTH`（它只允许在显式本地 loopback development 场景启用；托管环境保持缺省）
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
# 期望：返回 JSON 里的 buildSha = 你实际部署的 release SHA

curl -s -o /dev/null -w '%{http_code}\n' https://gengrowth.ai/app/api/mvp/health/live
# 期望：200；这只证明 web 进程活着，不代表可以放量

curl -s -o /dev/null -w '%{http_code}\n' https://gengrowth.ai/api/mvp/health/live
# 期望：404（说明确实挂在 /app 下，根路径没暴露）
```

**6.2 后台就绪（要 worker 活着才 200）：**
```bash
curl -s -o /dev/null -w '%{http_code}\n' https://gengrowth.ai/app/api/mvp/health/ready
# 期望：200。如果是 503，说明 worker 没连上——回第 4 步看 Render 日志，别跳过这关。
```

**不要把 `/health/live` 当成上线放量凭据。** 真正的 promotion gate 是：
- `/health/version` 的 `buildSha` 对上目标 SHA
- `/health/ready` 返回 200
- worker 日志也报同一个 SHA 且拿到了 readiness lease

**6.3 真实登录（里程碑）：**
浏览器打开 `https://gengrowth.ai/app/login`，用已预配的 Supabase operator 账号登录 → 应进入应用。
（登出应回到登录页；会话 cookie 是 HttpOnly/Secure。）

> 生产必须在 Supabase Auth 设置中关闭公开注册。账号由 Owner 在
> **Authentication → Users** 创建，然后使用该用户 UUID，按
> `docs/LAUNCH-CHECKLIST.md` Phase 1 的 SQL 写入 `app.operator_profiles`。
> 只有 Auth 用户而没有 operator profile 时，应用会拒绝访问且不会自动授权。

**6.1 和 6.2 的 curl 你可以直接发给我，我帮你判读。** 走到这只表示
`gengrowth.ai/app` 的部署、后台依赖与真实登录链路已经验证；**还不能称为
pilot 上线或开始放量**。继续完成第 7 节以及
`docs/LAUNCH-CHECKLIST.md` Phase 5–6 的托管 provider、恢复和 Owner 验收门禁。

---

## 7. 完整 pilot 还要过的（登录之后，不阻塞登录本身）〔你〕

- 线上连 **GSC**（选 `sc-domain:gengrowth.ai`）跑一次真实采集
- 线上连 **GA4**
- 用本候选的直连 **OpenAI** 真实生成一个 Artifact（线上要用 Owner 提供的真 key）；
  若另选 Azure，先完成上面说明的手工配置审查
- 验证**导出下载**能下（签名 URL 15 分钟过期）、两个桶确认私有
- 做一次**恢复演练**（见 `docs/RESTORE-DRILL.md`）
- 你亲自走一遍**中英文 / B2B+B2C** 的输出，满意了签字

---

## 常见坑速查

| 现象 | 多半是 | 怎么修 |
|---|---|---|
| 登录后 Google 连不上，报 `redirect_uri_mismatch` | 第 3 步 `/app` 回调没加/没生效 | 回 Google Console 加那条带 `/app` 的，等几分钟 |
| `/app/...` 打不开、根路径反而能开 | Vercel 没设 `NEXT_PUBLIC_BASE_PATH=/app`，或改了没重新部署 | 补上并重新 Deploy |
| `/health/ready` 一直 503 | worker 没起来/没拿到租约 | 看 Render 日志；确认 `DATABASE_URL` 是 Session 模式 |
| worker 或 web 启动就崩 | 环境变量缺/错（会 fail-fast 报哪个字段） | 照模板补齐；Azure 四个字段要么全填要么全不填 |
| 导出能生成但下载 404 | `SF_BLOB_BACKEND` 没设成 `supabase`，或桶没建 | 两边都设 `supabase`，建好 `raw-imports`/`exports` |
| 连接数报错/打满 | `DB_POOL_MAX` 太大 | web 和 worker 都设 `3` |

**顺序别乱**：先 Supabase（第 2 步）→ 再 Google（第 3 步）→ 再 worker（第 4 步）→ 再 web（第 5 步）→ 验证（第 6 步）。worker 先于 web 起来，`/health/ready` 才会 200。

参考：`docs/LAUNCH-CHECKLIST.md`（勾选版）、`docs/DEPLOYMENT.md`（拓扑与 Delta）、
`deploy/*.env.template`（变量模板）。
