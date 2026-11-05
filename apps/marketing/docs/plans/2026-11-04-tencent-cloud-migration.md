# gengrowth.ai 迁移到腾讯云（美国）

目标：gengrowth.ai（`apps/marketing`）从 Vercel 迁到腾讯云美国区，和 pick.gengrowth.ai 同一套运维。访客看到的页面、链接、登录状态不变；Vercel 保留一段时间做回滚。

现状（2026-11-04 核对）：

- Vercel 项目 `gengrowth-agents`，根目录 `apps/marketing`，Node 24，函数跑在 iad1。
- 根域名 A 记录 `76.76.21.21`，在 Cloudflare 上是仅 DNS（不代理）；`www` CNAME 到 `cname.vercel-dns.com`，由 Vercel 做 301 到根域名。
- `next.config.ts` 已经是 `output: "standalone"`，`outputFileTracingRoot` 指向 monorepo 根目录。
- 除 Workflow 外没有 `@vercel/*` 依赖，`vercel.json` 只有 `ignoreCommand`，没有 cron。
- 最近 30 天线上约 1.5 万次函数调用，几乎都是页面；22 个长耗时接口只被调用过 2 次。

## 范围

做：只迁 gengrowth.ai。顺带拆掉 Workflow（已决定放弃）。拆完后低竞争关键词照常可用，AI 可见性检查暂停发起新检查，见第 1 节。

不做：

- app.gengrowth.ai（`apps/web`）和 Railway 上的 worker 下线。那是另一张清单，涉及删除项目和 DNS，单独确认后再做。
- 任务中心。
- 不改 Supabase、Google OAuth、Resend 的任何配置（域名不变，见"环境变量"）。

第 1 节已合并（PR #355），2026-11-04 在 Vercel 上线。第 2 节已在分支 `chore/marketing-dockerfile-20261104` 上提交，尚未合并。第 3 节起仍待批准，而且要先定第 0 节第 1 条。

## 0. 先定下来的事

1. **Cloudflare 走不走代理。** 默认不走（仅 DNS），和现在一样。走代理会在约 100 秒时断开请求，而 GEO Agent（单次预算 240 秒）、知识库推进（250 秒）、可引用性 AI 审查（120 秒）都超过这个时间，要先改代码拆分。第 1 步之后，低竞争关键词也是一次请求跑完（最长约 280 秒），同样超过。
   **和 pick 的做法冲突（2026-11-04 查 pick 仓库 `deploy/tencent-migration.md`）：** pick 那台机器入站只开 22 端口，网页流量从 Cloudflare 隧道进到 Caddy（`http://caddy:80`）。隧道也是经过 Cloudflare 代理的，一样有约 100 秒的上限。所以"和 pick 放在一起、用同一种方式"与"仅 DNS"不能同时成立，要在下面三种里选一种：
   - 同一台机器、走隧道：先把上面四个长耗时工具拆到 100 秒以内，再迁。
   - 同一台机器、不走隧道：安全组给这台机器开 80/443，Caddy 自己签 `gengrowth.ai` 和 `www` 的证书，DNS 仅 DNS 指到机器公网 IP。pick 照旧走隧道，两边互不影响。
   - 单独一台机器：做法同上一条，只是不和 pick 共用。
2. **只跑一个实例。** 代码里有两处只在单进程下正确：
   - `src/lib/rate-limit.ts` 的限流计数存在进程内存的 `Map` 里；
   - 博客、prompts、skills 页面的 `revalidate = 3600` 缓存在本机文件系统。
   以后要多实例，这两处都要换成共享存储。以现在的流量，一个实例足够。
3. **腾讯云区域和部署方式。** pick 在腾讯云弗吉尼亚的一台 CVM 上，用 Docker Compose 跑，前面是 Caddy（2026-11-02 定，和 ShortsBinge 同一地域）。放在那台机器上，就是多一个 compose 服务，Caddy 多一条站点。Supabase 生产项目 `nevermore`（`pxgzmoypkyyutpcmqexa`）在 us-west-2（见 `docs/INFRASTRUCTURE.md`），到弗吉尼亚是跨美国东西岸；现在 Vercel 跑在 iad1（也是弗吉尼亚），所以数据库延迟和今天一样，不会变差。
4. **出站 IP 白名单。** 迁移后服务器出站 IP 会变。确认 DataForSEO、Supabase 网络限制等第三方有没有按 IP 放行；有的话先把新 IP 加上。

## 1. 拆掉 Workflow

2026-11-04 合并（PR #355，合并提交 `59329c9f`），已在 Vercel 上线。实际做法和最初写的"两个都显示暂不可用"不同，原因是两个工具的处境不一样。

**低竞争关键词：改回同步路径，照常可用。** 这个工具在接入 Workflow 之前就有一条同步路径（一次请求跑完，最长 300 秒），一直保留在 `handleKeywordOpportunitiesRequest` 里，和 Workflow 共用同一个结果组装函数，测试也一直在跑。

- `opportunities/route.ts` 不再判断 `X-Keyword-Workflow-Version` 请求头，所有请求都走同步路径。前端照旧发请求头和 `requestId`，服务端忽略这两项；同步返回的 200 带 `data.result`，前端原有的解析能直接用。
- `opportunities/status/route.ts` 固定返回 410 `keyword_run_expired`，不带缓存。只有发布前打开、还在轮询的旧标签页会请求它。
- 前端不再把运行指针写进 sessionStorage。发布前的旧标签页如果留着指针，刷新后会清掉指针、还原表单，并提示上次运行无法恢复，不会自动重跑。不这样处理的话，刷新会自动再发起一次付费运行。
- 代价：运行途中刷新页面，这次结果就丢了（服务端已经花的钱照花）。没有 Workflow 之后也没有按 `requestId` 去重。剩下的防线是 Search Console 闸门：同一 IP 在同一实例里同时只能跑一次（第二次返回 409 `scan_in_progress`），另有按 IP 每小时的次数上限；上一次跑完之后再点，就是新的一次付费运行。迁到单进程 VM 后，"同一实例"就等于整个站。
- 文案改回同步说法：去掉"耐久步骤""检查点""24 小时恢复凭证""Workflow 托管留存"，改成"报告只存在于当前标签页，想留下请下载"。
- `readKeywordIdentity` 原来放在 Workflow handler 里，内容简报和知识库补全也在用，挪到了 `src/lib/tools/keyword-identity.ts`。

**AI 可见性检查：暂停发起新检查。** 一次检查约 15 分钟、几百次付费调用，没有能跨请求运行的执行器就跑不了。

- `visibility-handler.ts` 加了可选依赖 `runsPaused`。load 接口返回 `runsPaused: true`，页面据此禁用"开始"按钮并显示 `errors.runs_paused`。start 接口在检查供应商配置、读取冻结版本、扣当日次数之前，直接返回 503 `runs_paused`，所以不会白扣次数。
- `readRun` 对所有运行指针都返回 `run_unavailable`；历史报告走另一条读取路径，仍能打开。
- 以后要恢复，需要接一个能跑 15 分钟以上的执行器（例如腾讯云上的常驻 worker），再把 `runsPaused` 改回 false。

**删掉的东西：**

- `next.config.ts` 的 `withWorkflow` 包装和 `workflow/next` 导入；`src/proxy.ts` matcher 里的 `.well-known/workflow` 例外；`eslint.config.mjs` 里对应的忽略项；`apps/marketing/.gitignore` 里的 `.workflow-data`、`.workflow-vitest`。
- `src/lib/tools/` 下的 `keyword-opportunity-workflow*.ts`、`keyword-workflow-handler.ts`、`keyword-workflow-contract.ts`、`keyword-workflow-probe.ts` 及其测试；`src/lib/geo-tools/` 下的 `visibility-workflow*.ts` 及其测试；`.workflow-test/` 整个目录。
- 依赖 `workflow`、`@workflow/vitest`，脚本 `test:workflow`、`test:workflow:marketing`，根目录 pnpm override `@workflow/core@4.8.5>nanoid`，以及 CI 里跑 Workflow 集成测试的那一步。lockfile 少了 357 个包。

**保留没删的：** `keyword-workflow-client.ts` 和前端的 202/轮询分支。服务端已经不会返回 202，这部分代码不会再走到，只用来读取并清掉旧指针。要删可以单独再做一次。

这一步单独提交，在 Vercel 上先上线验证，和迁移解耦。上线后要看的：低竞争关键词完整跑一次；AI 可见性检查页面按钮是灰的、有暂停提示；`/.well-known/workflow/*` 返回 404。
上线当天在线上查过的：旧的状态接口返回 410，`/.well-known/workflow/...` 返回 404，首页 200。要登录才能看的两项（关键词完整跑一次、可见性按钮置灰）还没查。

## 2. 构建镜像

已在分支 `chore/marketing-dockerfile-20261104` 上提交 `apps/marketing/Dockerfile`，2026-11-04 在本机（colima，linux/arm64）构建并跑通。构建上下文是仓库根目录：

```bash
docker build -f apps/marketing/Dockerfile \
  --build-arg NEXT_PUBLIC_APP_URL=... --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID=... \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  -t gengrowth-marketing:<sha> .
```

做法：

- 三段构建，基础镜像都是 `node:24-bookworm-slim`。安装层照搬 `Dockerfile.worker`：固定 `corepack@0.34.5`，先复制根目录的 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`.npmrc`、`patches/`，再复制 4 个 workspace 的 `package.json`（`apps/marketing`、`packages/public-tools`、`packages/sources`、`packages/contracts`，后者是 sources 的依赖），然后 `pnpm install --frozen-lockfile`。只复制部分 workspace，pnpm 也接受 lockfile，实测通过。
- 不用 `RUN --mount`，旧版构建器和 BuildKit 都能构建。本机没装 buildx，走的是旧版构建器；pick 的机器上用 BuildKit。
- 最终镜像里只有 standalone 输出、`.next/static`、`public/`、`content/`，以 `node` 用户运行，入口 `node apps/marketing/server.js`，端口 3001。带健康检查（请求 `/robots.txt`）。
- 本机冷构建约 5 分 40 秒（装依赖 3 分 24 秒），镜像 540 MB。

核实过的事：

- **`NEXT_PUBLIC_*` 要在构建时传。** 4 个值被写进了服务端代码（客户端组件不直接读它们），运行时再设不起作用。缺任何一个，构建直接失败（实测：少传一个时停在 `missing build arg NEXT_PUBLIC_SUPABASE_ANON_KEY`，没走到 `next build`），不会打出一个连不上 Supabase、Google 的包。`NEXT_PUBLIC_GA_MEASUREMENT_ID` 代码里有默认值，Vercel 上也没设，不传。
- **构建不需要任何服务端密钥。** 只带 4 个构建参数就能完成构建和全部预渲染；原来担心的 `src/lib/blog.ts` 只在 `BLOG_LEGACY_SUPABASE_ENABLED=true` 时才读 Supabase。服务端变量都在运行时用 `--env-file` 给。
- **入口路径**是 `/app/apps/marketing/server.js`，和预计一致。
- **`content/`** 已经被 Next 的文件追踪自动带进 standalone（顺带也带进了 `src`、`supabase`、`scripts` 这些不用的目录，多占一点空间，不影响运行；`apps/marketing/docs` 原来也会被带进去，根目录 `.dockerignore` 已把它排除，这份方案不会进生产镜像）。Dockerfile 里仍显式复制一次，免得哪天追踪规则变了，博客和法律页打不开。
- **sharp 被追踪漏了一半。** Next 只顺着 `require()` 追踪，sharp 原生模块里 `dlopen()` 的 `libvips-cpp.so` 没被带进来。结果 `/_next/image` 不报错，每张图都原样返回、不缩放不转格式。Dockerfile 在构建后把 `@img+sharp-*` 整个复制进 standalone，并在最终镜像里按 Next 的方式加载一次 sharp，加载不了就构建失败。修好后 1200px 的 PNG 按 640 宽请求，返回 WebP，117 KB 变成 12 KB。
- **写缓存的权限。** 整棵目录归 `node`，ISR 页面和图片缓存都能写，日志里没有 `EACCES`。
- **停容器。** `docker stop` 0.2 秒就退出了，正在处理的请求会被直接断开。部署重启时，跑到一半的长耗时工具（关键词地图、GEO Agent、知识库）会失败，所以重启要挑没人用的时候。

还没核实的：

- 本机构建的是 arm64，服务器是 x86。sharp 的 x64 包要在服务器上第一次构建时才确认；上面那道构建检查会拦住装不上的情况。
- 镜像里没有任何服务端变量，所以登录、需要数据库或第三方接口的工具都没在本机跑过，这些留到第 7 节在服务器上验收。

本机跑过的页面和接口：`/`、`/zh`、两篇博客、`/blog/rss.xml`、`/zh/blog/rss.xml`、`/robots.txt`、`/sitemap.xml`、`/prompts`、`/skills`、`/privacy` 都是 200；`/app`、`/blog/whitelabel-seo-tool`、`/tools/hidden-keywords` 是 301 到对应地址；`/api/auth/profile` 未登录返回 401；安全头都在，没有 `X-Powered-By`。

## 3. 服务器前面那一层（nginx / Caddy / 负载均衡）

- **超时 ≥ 300 秒。** nginx 默认 60 秒，必须改大。self-hosted 下 `maxDuration` 不起作用，超时完全由这一层决定。
- **把原始域名和协议传给 Next。** 代理层要传 `Host`、`X-Forwarded-Host`，以及 `X-Forwarded-Proto: https`。`src/proxy.ts` 和 next-intl 的语言跳转用请求 URL 拼出跳转地址；少了这些头，跳转会变成 `http://` 或内网地址。marketing 没有用 Server Actions，不涉及它的来源校验。本机容器里核实过（第 2 节）：重定向的 `Location` 是相对路径，不受影响；但 next-intl 写的 `Link` 头（各语言版本的地址）按 `Host` 和 `X-Forwarded-Proto` 拼，带上这两个头时是 `https://gengrowth.ai/...`，不带 `X-Forwarded-Proto` 就变成 `http://gengrowth.ai/...`。
- **HTTP 跳 HTTPS。** 以前由 Vercel 做。HSTS 只对来过的访客生效，第一次来的访客仍需要 `http://` → `https://` 的 301。
- **真实 IP。** 限流器优先信任 `x-real-ip`（`src/lib/rate-limit.ts` 注释写明依赖 Vercel 会剥掉客户端伪造的值）。代理层必须用连接 IP 覆盖 `X-Real-IP`，丢掉客户端发来的同名头，否则按 IP 限流可以被伪造绕过。`/api/consent` 也读这个头。
- **HTTPS 证书要自己管。** 不走 Cloudflare 代理就没有 Cloudflare 的证书，以前是 Vercel 签发的。站点已经下发了 `Strict-Transport-Security: max-age=31536000; includeSubDomains`，老访客的浏览器会强制 HTTPS。切 DNS 时证书哪怕缺一分钟，这些访客都会直接打不开。所以根域名和 `www` 的证书都要在切换前签好，并且能自动续期（Caddy 自带，或者用 certbot）。
- **`www` 跳转。** 现在由 Vercel 做 301 到根域名。迁过去后在代理层做同样的 301（Cloudflare 的重定向规则需要开代理，这里用不上）。
- **访问日志。** 迁过去就没有 Vercel 的日志和 Observability 了。至少保留代理层访问日志和应用标准输出 30 天，再加一个外部可用性探测（探 `/robots.txt` 即可）。

## 4. 环境变量

Vercel 上一共 75 个。只在 preview 或 development 用的 9 个不用迁：`FIRECRAWL_*` 4 个，`GOOGLE_CLIENT_EMAIL`、`GOOGLE_CLOUD_LOCATION`、`GOOGLE_CLOUD_PROJECT`、`GOOGLE_PRIVATE_KEY`、`GOOGLE_SERVICE_ACCOUNT_KEY`。其余 66 个是 production 要的。

- 取值：`vercel env pull --environment=production` 拉到本地，直接导入腾讯云的密钥存储或服务器上权限为 600 的 env 文件。不进 git，不打印到日志。
- `CRON_SECRET`：marketing 代码里没用到，可以不迁。

**因为域名不变，下面这些都不用改**：

- Google OAuth 的回调地址和授权来源（`GOOGLE_REDIRECT_URI`）、One Tap
- Supabase Auth 的站点地址和回调白名单
- Resend 发件域
- GA4
- 登录 cookie 的作用域（`SESSION_COOKIE_DOMAIN`）

已登录的访客切换后仍保持登录。

## 5. CI/CD

`.github/workflows/ci.yml` 现在只能手动触发，验证主要在本地和 Vercel 构建时做。新增一个部署 workflow：

- 触发：push 到 main，`paths` 限定 `apps/marketing/**`、`packages/public-tools/**`、`packages/sources/**`、`pnpm-lock.yaml`、`patches/**`。这取代 `scripts/vercel-ignore-build.mjs marketing` 的作用。
- 步骤：先跑 `pnpm test`、typecheck 和 lint 把关（替代原来 Vercel 构建时的校验），再构建镜像、推到腾讯云镜像仓库，最后在服务器上拉取并重启容器。
- 镜像按 git sha 打标签，回滚旧版本就是重新部署上一个 sha。

**会失去的：** 每个分支自动生成的预览地址。需要的话，可以在同一台机器上加一个 `staging.gengrowth.ai`，手动部署某个分支。这一步可选，不是迁移的前提。

## 6. 切换步骤

1. 第 1 步（拆 Workflow）在 Vercel 上线，跑一两天确认无异常。
2. 本地 `docker build`，核实 standalone 路径、静态文件、图片优化，再用 `docker run` 跑通。2026-11-04 已在本机（arm64）做完，结果见第 2 节；x86 要在服务器上构建时再确认一次。
3. 镜像部署到腾讯云。先不动 DNS，用 `curl --resolve gengrowth.ai:443:<新IP>` 或改本机 hosts 文件，访问新服务器做第 7 节的验收。
4. 提前一天把 Cloudflare 上根域名 A 记录和 `www` 的 TTL 调到最短。
5. 切换：根域名 A 记录改到新 IP；`www` 改为 A 记录指向新 IP（或 CNAME 到根域名）。两条记录都保持仅 DNS。
6. 观察 24 小时：5xx、登录、长耗时工具、证书。
7. **回滚：** 根域名 A 记录改回 `76.76.21.21`，`www` 改回 `cname.vercel-dns.com`。Vercel 项目在观察期内保持自动部署，回滚到的就是最新代码。
8. 稳定 7 天后：Vercel 项目解绑域名、停掉 Git 自动部署，删除 `apps/marketing/vercel.json`。同时更新 `docs/INFRASTRUCTURE.md` 里 `gengrowth-agents` 和营销站环境变量落点的说明。项目本身先留着，后面跟 app 下线一起清理。

## 7. 验收清单

在新服务器上逐项过，切换后再过一遍：

- 页面：`/`、`/zh`、一篇博客（ISR 缓存）、`/blog/rss.xml`（rewrite）、`/zh/blog/rss.xml`。
- 跳转：`/app` → `/waitlist`，`/blog/whitelabel-seo-tool` → `/blog/best-white-label-seo-tool`，`www.gengrowth.ai` → `gengrowth.ai`，`http://gengrowth.ai` → `https://gengrowth.ai`。语言跳转后的 `Location` 头是 `https://gengrowth.ai/...`，不是 `http://` 或内网地址。
- 短链：一个真实的 `/go/[code]`。
- 登录：Google 跳转登录完整走一遍（回调里用 `after()` 撤销旧授权，确认响应后仍执行了）；One Tap；退出登录。
- 接口：`/api/auth/profile` 未登录返回 401；`/api/credits/balance` 已登录正常。
- 长耗时：至少一个 120 秒以上的工具（GEO Agent 或知识库）从头跑到尾，不被中途断开。
- 低竞争关键词完整跑通一次；AI 可见性检查按钮置灰并显示暂停提示，历史报告能打开。
- 响应头：`X-Frame-Options`、`Strict-Transport-Security` 等安全头都在，且没有 `X-Powered-By`。
- 限流：带伪造的 `X-Real-IP` 连续请求，确认仍按真实 IP 计数。
- 图片：`next/image` 的图能正常出来（`/_next/image` 返回 200）。

## 风险和代价

- **失去的：** 分支预览地址、Vercel 日志和 Observability、全球 CDN（静态资源从单一美国机房出）、零运维的证书和扩容。
- **长耗时请求：** 只要保持仅 DNS 加 300 秒超时就没问题。以后想开 Cloudflare 代理，要先把 GEO Agent、知识库、可引用性审查拆到 100 秒以内。
- **单实例：** 机器挂了就是整站不可用。要有可用性探测，以及容器自动重启（`restart: unless-stopped` 或集群自带）。
- **HSTS 加证书：** 这是切换时唯一会让人打不开的硬故障，第 3 节已要求切换前验证证书。

## 工作量（粗估）

- 拆 Workflow：已完成（关键词改回同步路径、可见性暂停、删除依赖和测试）。
- Dockerfile：已完成（本机构建和冒烟测试通过）。
- 部署 workflow、代理层配置：一天左右，前提是第 0 节第 1 条定下来。
- 验收和切换：半天，另加 7 天观察期。
