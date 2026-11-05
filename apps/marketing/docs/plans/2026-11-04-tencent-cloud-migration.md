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

第 1 节已合并（PR #355），2026-11-04 在 Vercel 上线。第 2 节的 Dockerfile、第 3 节的 Caddy 站点文件、第 5 节的部署脚本都在分支 `chore/marketing-dockerfile-20261104` 上（`apps/marketing/deploy/`），尚未合并。合并后 Vercel 只多一处变化：接口按 `Host` 头判断同源、拼跳转地址（第 2 节 `requestOrigin`），在 Vercel 上结果和原来一样。其余文件 Vercel 不读。服务器和 Cloudflare 都还没动。

2026-11-05 定的路线是"最快最简单"：放进 pick 那台机器，走 pick 已有的 Cloudflare 隧道，手动部署。腾讯云迁移不是目的，真正要做的是任务中心、我的收益、管理员上传视频的后台，迁移只求不挡路。

## 0. 先定下来的事

1. **走 pick 的隧道，长耗时工具先不拆（2026-11-05 定）。** pick 那台机器入站只开 22 端口，网页流量从 Cloudflare 隧道进到 Caddy（`http://caddy:80`）。gengrowth.ai 照这个做：不开新端口，不自己签证书。
   **代价：** 隧道经过 Cloudflare 代理，一个请求约 100 秒还没返回，Cloudflare 就断开，访客看到 524。超过这个时间的有低竞争关键词（第 1 步之后一次请求跑完，最长约 280 秒）、GEO Agent（单次预算 240 秒）、知识库推进（250 秒）、可引用性 AI 审查（120 秒）。迁过去以后，这几个工具里跑得久的那一次会在约 100 秒时失败。服务端那次运行会不会接着跑完、照样花钱，没有验证。想恢复，就把它们改成"提交后轮询"，每个请求控制在 100 秒以内。
   当时比较过的另外两种是：同一台机器开 80/443，由 Caddy 自己签证书，DNS 仅 DNS 指到机器；或者单独开一台机器。这两种都没有 100 秒的限制，但要改安全组、自己管证书，而且站点下发了 HSTS，切换时证书缺一分钟，老访客就打不开。
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

服务器上不用手敲这条，`apps/marketing/deploy/deploy.sh` 会从运行时 env 文件里取这 4 个值来构建（第 5 节）。

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
- **`request.url` 不是对外地址（2026-11-05 发现，已修）。** 自己跑的 Next standalone 用服务器自己的监听地址（`HOSTNAME`、`PORT`）拼 `request.url`（`next/dist/server/lib/router-utils/resolve-routes.js`、`next-server.js`），接口里拿到的是 `https://0.0.0.0:3001/...`。协议取自 `X-Forwarded-Proto`，这一半是对的。用旧镜像实测：带着和 Caddy 转发时一样的请求头，同源的退出登录 POST 也返回 403；`/r/<code>` 推荐链接 302 到 `https://0.0.0.0:3001/`。代码里还有 GSC 属性、可引用性审查两处同源校验，Google 登录回调的 `backTo` 也按它拼跳转地址，原样上线的话登录之后会跳到这个地址。
  先试过改配置，走不通：`experimental.trustHostHeader` 在生成 standalone 时被强制写成"是不是在 Vercel 上构建"（`next/dist/build/index.js`），`next.config` 里设了没用。构建后硬改成 true，`request.url` 还是 `0.0.0.0`，而且首页内部转到 `/en` 的那一跳改走 https，报 EPROTO，`/` 返回 500。所以 Dockerfile 没动。
  现在改在代码里：`src/lib/request-origin.ts` 的 `requestOrigin()`，协议照旧取 `request.url` 的，主机名改取 `Host` 头。经隧道进来的请求，`Host` 只可能是 Caddy 站点文件里写了的那几个域名；`X-Forwarded-Host` 故意不读。`Host` 缺失或格式不对时退回 `request.url`，同源校验就只和 `https://0.0.0.0:3001` 比，真实页面发来的请求都不通过，不会误放行；这种请求过不了 Caddy（它按 `Host` 选站点），公网上碰不到。2026-11-05 按仓库规定用 gpt-6-astra 审过这一处，结论 0 条问题；它列为无法确认的是 Cloudflare、Caddy 对重复 `Host` 头的处理，以及 `X-Forwarded-Proto` 一路上是否会被伪造（伪造成 http 只会让同源校验失败）。用到它的 5 处：`isSameOriginPost`（退出登录、账户网站、档案刷新都走它）、GSC 属性、可引用性审查、登录回调的 `backTo`、`/r/<code>`。`src` 里其余用到 `request.url` 的地方都只读查询参数或请求体；登录入口 `/api/auth/google/start` 给 Google 的 `redirect_uri` 来自环境变量 `GOOGLE_REDIRECT_URI`，不受影响。Vercel 上 `Host` 和 `request.url` 的主机名本来就一样，所以那边行为不变；但这是这份方案里唯一会随合并上到 Vercel 的改动，合并后在 Vercel 上看一下退出登录、GSC 属性列表、一条 `/r/<code>` 链接。改完重新构建镜像，带同样的请求头实测：`gengrowth.ai`、`next.gengrowth.ai` 上同源的退出登录 POST 都是 200，带 `Origin: https://evil.example` 的是 403，`/r/abc123` 302 到 `https://gengrowth.ai/`，`/` 200，容器日志里没有报错。
- **构建要连 Google Fonts。** `next/font/google` 在构建时下载字体文件。2026-11-05 本机有一次构建停在这里（`Can't resolve '@vercel/turbopack-next/internal/font/google/font'`，24 个同样的错），原样重跑就过了，是网络抖了一下。在服务器上碰到同样的错，`deploy.sh` 会停在构建、不动正在跑的容器，再跑一次即可。

还没核实的：

- 本机构建的是 arm64，服务器是 x86。sharp 的 x64 包要在服务器上第一次构建时才确认；上面那道构建检查会拦住装不上的情况。
- 镜像里没有任何服务端变量，所以登录、需要数据库或第三方接口的工具都没在本机跑过，这些留到第 7 节在服务器上验收。

本机跑过的页面和接口：`/`、`/zh`、两篇博客、`/blog/rss.xml`、`/zh/blog/rss.xml`、`/robots.txt`、`/sitemap.xml`、`/prompts`、`/skills`、`/privacy` 都是 200；`/app`、`/blog/whitelabel-seo-tool`、`/tools/hidden-keywords` 是 301 到对应地址；`/api/auth/profile` 未登录返回 401；安全头都在，没有 `X-Powered-By`。

## 3. 代理层：pick 的 Caddy 多一个站点文件

请求路径：访客 → Cloudflare（HTTPS 在这里终止）→ 隧道 → cloudflared → pick 的 Caddy（`http://caddy:80`）→ 容器 `gengrowth-marketing:3001`。marketing 的容器接在 pick 的外部网络 `drama` 上（见 `apps/marketing/deploy/compose.yml`）。没有接 pick 的 `state/networks.yml`，因为 `provision.sh` 每次开通客户都会重写那个文件。

站点文件是 `apps/marketing/deploy/gengrowth-marketing.caddy`，`deploy.sh` 把它复制进 pick 的 `state/sites/`，先 `caddy validate`，通过了才 `caddy reload`。这个文件写坏的话，reload 失败会影响机器上所有站点，所以验证不过就把原文件放回去并停下。文件名不会和 `provision.sh` 生成的 `<客户>.caddy` 撞上。

- **超时。** Caddy 不设上限，真正的上限是 Cloudflare 的约 100 秒（第 0 节第 1 条）。self-hosted 下 `maxDuration` 不起作用。
- **原始域名和协议。** pick 的 Caddyfile 已经信任内网来源（`trusted_proxies static private_ranges`），cloudflared 传来的 `X-Forwarded-Proto: https` 原样交给 Next，`Host` 也不改。next-intl 的 `Link` 头因此是 `https://gengrowth.ai/...`。中间件发出的重定向 `Location` 是相对路径，不受影响；接口里拼的绝对跳转（登录回调、`/r/<code>`）按 `Host` 拼，见第 2 节。
- **HTTP 跳 HTTPS。** 由 Cloudflare 的 "Always Use HTTPS" 做，切换前在 Cloudflare 后台确认它是开着的。没开的话，`http://` 请求也会经隧道进来，按 http 出页面。2026-11-05 实测它原来是关的，已经打开：作用于整个 zone，`http://` 一律 301 到 `https://`，路径和查询参数保留，pick、test1 的 https 响应不变。
- **真实 IP。** 站点文件里 `header_up X-Real-IP {http.request.header.CF-Connecting-IP}`：Cloudflare 把访客 IP 写在 `CF-Connecting-IP` 里，隧道又是唯一入口，所以客户端自己带的 `X-Real-IP` 会被覆盖掉。限流器（`src/lib/rate-limit.ts`）和 `/api/consent` 都先读 `X-Real-IP`，代码不用改。
- **证书不用管。** 访客连的是 Cloudflare 的证书。pick.gengrowth.ai 现在用的就是同一张（2026-11-05 查，`CN=gengrowth.ai`，含 `*.gengrowth.ai`，Google Trust Services 签发），根域名、`www`、验收用的 `next.gengrowth.ai` 都在里面。原来"HSTS 加证书缺口"这个风险没有了。
- **`www` 跳转。** 站点文件里 301 到根域名，和现在 Vercel 的行为一样。
- **验收用的 `next.gengrowth.ai`。** 同一个容器，另加 `X-Robots-Tag: noindex, nofollow`，切换后删掉。`NEXT_PUBLIC_APP_URL` 和 Google 回调地址都是 gengrowth.ai，所以在这个地址上走不了 Google 登录流程，页面里的链接也会跳回正式站。不过登录 cookie 的作用域由 `SESSION_COOKIE_DOMAIN` 决定（`src/lib/supabase/session-cookie-options.ts`），生产上如果设的是 `gengrowth.ai`（为了让 app.gengrowth.ai 共用登录，应该是），那么先在正式站登录，再打开 `next.gengrowth.ai`，浏览器会带着同一个会话，要登录才能验的接口在切换前就能验。2026-11-05 已在 `pick-prod-1` 隧道上加了这条路由（`http://caddy:80`），DNS 记录随之自动建出。
- **Cloudflare 会第一次改写这个站的页面。** gengrowth.ai 现在是仅 DNS，从来没经过 Cloudflare 代理。接上隧道后，zone 里改写 HTML 的功能会作用到它：Rocket Loader 和 Scrape Shield 里的 Email Address Obfuscation（会改写页面里像邮箱的文字并插入脚本）都可能让 React 水合报错，切换前确认这两个是关的。Bot Fight Mode 开着的话会拦一部分自动化请求，记下它的状态。marketing 没有接收第三方回调（webhook）的接口（2026-11-05 查 `src/app/api`），这一项不用担心。验收时在浏览器里打开 `next.gengrowth.ai`，看控制台有没有水合报错。2026-11-05 在 `next.gengrowth.ai` 上查过：
  - **Rocket Loader 是关的。**
  - **Email Address Obfuscation 原来开着，已关掉。** 开着时页面里被插了 `cdn-cgi/l/email-protection`。关掉之后在 Chrome 里打开首页、`/zh` 和一篇博客，控制台没有消息。
  - **Bot Fight Mode 是关的。**
  - **AI 爬虫没被拦。** 用 GPTBot、ClaudeBot、PerplexityBot、Google-Extended、Googlebot 的 UA 访问都是 200。`robots.txt` 和 Vercel 上的逐字节相同，Cloudflare 没有接管它。
- **上传大小。** Cloudflare 免费版单个请求体上限 100 MB。以后管理员后台上传视频，要让浏览器直接传到对象存储（预签名地址）或者分片上传，不能整个文件经过这台机器。pick 已经因为同一个原因做过分片上传。
- **日志。** 迁过去就没有 Vercel 的日志和 Observability 了，只剩 `docker logs gengrowth-marketing`（pick 的 `server-setup.sh` 已经配了 Docker 日志轮转）。外部可用性探测可选，探 `/robots.txt` 即可。

## 4. 环境变量

Vercel 上一共 75 个。只在 preview 或 development 用的 9 个不用迁：`FIRECRAWL_*` 4 个，`GOOGLE_CLIENT_EMAIL`、`GOOGLE_CLOUD_LOCATION`、`GOOGLE_CLOUD_PROJECT`、`GOOGLE_PRIVATE_KEY`、`GOOGLE_SERVICE_ACCOUNT_KEY`。其余 66 个是 production 要的。

- 取值：`vercel env pull --environment=production` 拉到本地，经 ssh 写进服务器上的 `/srv/gengrowth-marketing/marketing.env`（权限 600），然后删掉本地那份。不进 git，不打印到日志，不贴进聊天。具体命令见 `apps/marketing/deploy/README.md`。
- **Sensitive 的变量拉不出值，已用一次性构建取回（2026-11-05）。** `vercel env pull` 给这些变量写的是字面的 `[SENSITIVE]`，不是空值。`gengrowth-agents` 的 production 一共 66 个（去掉 `VERCEL*`、`TURBO_*`、`NX_DAEMON` 之后），只有 `BLOG_LEGACY_SUPABASE_ENABLED`、`CRON_SECRET`、`MARKETING_SHORT_LINKS_ENABLED`、`NEXT_PUBLIC_APP_URL` 4 个拉到了真值，其余 62 个连模型名、温度、开关、URL 也都标成了 Sensitive，Vercel 的接口同样不返回。
  - **怎么取回的。** 构建时读得到这些值，所以从一个临时目录往 `gengrowth-agents` 发了一次 `vercel deploy --prod --skip-domain`，构建命令换成导出脚本。脚本只读这 62 个变量名，把值整体加密到服务器上生成的证书（RSA-4096 + AES-256，私钥没离开服务器），日志里只有密文和一行统计，最后故意失败。日志里的统计是 `VERCEL_ENV=production found=62/62 missing=[]`。那次部署 `dpl_3q7a1foaBCAJ7Lx83pcME1ogmYLR` 停在 ERROR，没有分配域名，gengrowth.ai 没动。
  - **怎么核对的。** 在服务器上解密，写回 `marketing.env`，再让 docker compose 自己读一遍，逐个和原值比对，62 个全部一致。私钥、证书、密文和明文中间文件随后在两边都删了。
  - **TOKEN_ENCRYPTION_KEY 是原值。** 所以访客的 Google 登录和 GSC 连接不会因为迁移失效。万一以后只能换新 key：Supabase 登录不受影响，但 `gg_id`、`gg_gsc`、`gg_oauth_tx`、`gg_onetap`、`gg_kw_context` 这几个加密 cookie 会失效，访客要重新连 Google 和 GSC。
  - **16 个 `SIGNALFRAME_*` 值末尾多一个换行。** 多半是当初用 `echo 值 | vercel env add` 加的。营销站和 `packages/` 都不读任何 `SIGNALFRAME_*`，原样保留。
  - **以后改值直接改服务器上的 `marketing.env`。** Vercel 项目删掉以后它就是唯一一份，删之前要另外备份。`deploy.sh` 发现还有 `[SENSITIVE]` 就停下，列出变量名（不打印值）。
- compose 读这个文件的方式，2026-11-05 本机用 docker-compose 5.1.4 实测过：双引号会去掉，`\n` 会变成真的换行，这两点和 `vercel env pull` 的写法对得上。但双引号里的 `$NAME` 会被替换成运行 compose 那个 shell 里的同名变量（没有就是空），密钥会被悄悄改掉；`$$` 才是字面的 `$`。所以 `deploy.sh` 发现哪个值里有单个 `$` 就停下，列出变量名，要把那个值里的 `$` 改成 `$$`。
- `CRON_SECRET`：marketing 代码里没用到，可以不迁。

**因为域名不变，下面这些都不用改**：

- Google OAuth 的回调地址和授权来源（`GOOGLE_REDIRECT_URI`）、One Tap
- Supabase Auth 的站点地址和回调白名单
- Resend 发件域
- GA4
- 登录 cookie 的作用域（`SESSION_COOKIE_DOMAIN`）

已登录的访客切换后仍保持登录。

## 5. 发布：手动跑 deploy.sh

不加 GitHub 部署 workflow，和 pick 一样在服务器上手动发布。服务器上的布局：

- `/srv/gengrowth-marketing/repo`：nevermore 的克隆，用一把只读的 GitHub deploy key 拉代码。从 Mac 传镜像到弗吉尼亚太慢（pick 的记录是每秒几十 KB），所以在服务器上构建。
- `/srv/gengrowth-marketing/marketing.env`：运行时变量（第 4 节），不在 git 里。

`apps/marketing/deploy/deploy.sh <git ref>` 依次做这些事：拉代码、切到那个提交；这个 sha 的镜像不在本机就构建（构建参数从 env 文件里取）；`docker compose up -d --wait`，等容器自己的健康检查通过；站点文件有变化就装进 Caddy（第 3 节）；最后打印被替换掉的 sha。把那个 sha 传回去就是回滚，镜像还在，不用重新构建，几秒钟完成。

- **每次发布都会断一下。** 容器重建时正在处理的请求会被断开（第 2 节，`docker stop` 0.2 秒退出）。本机每 0.2 秒探一次，换容器时有一个请求挂了 2 秒没回应，前后约 2.5 秒。挑没人用的时候发。
- **构建占 pick 的机器。** 冷构建本机约 5 分半，期间 CPU 和内存跟 pick 共用。2026-11-05 上机只读查过：x86_64、Ubuntu 24.04、8 核、30 GB 内存（可用约 25 GB）、`/srv` 剩 150 GB；pick 的 web 容器限 6 GB，查的时候 CPU 占 45%。我们的容器限 2 GB，余量够。构建期间 pick 会慢一点，所以也挑没人用的时候发。
- **服务器上的现状（2026-11-05 只读查过）。** 登录用户是 `ubuntu`，在 `docker` 组里，sudo 不要密码，第一次建 `/srv/gengrowth-marketing` 用得上。Docker 29.9.2、compose v5.7.0，`docker build` 走 BuildKit（本机测的是旧的构建器，所以服务器上第一次构建要看一眼）。能连 GitHub、Google Fonts、npm。`deploy.sh` 用到的路径都在：`state/sites/` 归 `ubuntu`、Caddy 把它只读挂到 `/etc/caddy/sites`，`platform.sh` 把 `exec` 原样交给 compose。cloudflared 用 token 跑，新的 Public Hostname 在 Cloudflare 后台加，和第 3 节一致。已有的站点是 `pick.gengrowth.ai` 和 `test1-drama.gengrowth.ai`，跟我们的三个域名不冲突。
- **pick 的清理不会碰我们的东西。** pick 的 `provision.sh` 只写它自己的 `state/sites/<客户>.caddy`，不删别的文件（客户名哪天取成 `gengrowth-marketing` 才会撞）。机器上有个每周一 04:00 的 `drama-docker-prune.timer`，只清 3 天前的构建缓存，不删镜像，回滚用的旧镜像还在；清完之后的第一次构建是冷构建。
- **没有自动把关。** Vercel 构建时会跑的检查没了，发布前在本地跑 marketing 的 test、typecheck、lint。
- **会失去的：** 每个分支自动生成的预览地址。观察期内 Vercel 照旧随 main 自动部署，作为回滚目标。

## 6. 切换步骤

1. 第 1 步（拆 Workflow）在 Vercel 上线，跑一两天确认无异常。
2. 本地 `docker build`，核实 standalone 路径、静态文件、图片优化，再用 `docker run` 跑通。2026-11-04 已在本机（arm64）做完，结果见第 2 节；x86 要在服务器上构建时再确认一次。
3. 服务器一次性准备（`apps/marketing/deploy/README.md`）：先告诉 pick 那边要动哪些东西；目录、deploy key、`marketing.env`。
4. `deploy.sh origin/main`。在 Cloudflare 隧道的 Public Hostname 里加 `next.gengrowth.ai` → `http://caddy:80`，在这个地址上做第 7 节里不需要登录的那些项。
5. 切换前把现有两条记录抄下来：根域名 A `76.76.21.21`（仅 DNS），`www` CNAME `cname.vercel-dns.com`（仅 DNS）。
6. 切换：只删内容是 `76.76.21.21` 的那条根域名 A 记录和 `www` 那条 CNAME，根域名上的 TXT、MX（Resend 的 SPF/DKIM、各种站点验证）一条都不要碰。删完紧接着在隧道里加 `gengrowth.ai`、`www.gengrowth.ai` 两个 Public Hostname，都指到 `http://caddy:80`。Cloudflare 不允许在已有记录的名字上加隧道地址，所以只能先删后加，中间会有一两分钟的空档；本地 DNS 缓存没过期的访客这段时间还在 Vercel 上。确认 "Always Use HTTPS" 开着。2026-11-05 已切：两个名字分开做，各自删完马上加隧道路由，根域名空了不到一分钟，`www` 不到两分钟；删之前根域名上没有 AAAA。切完从 Cloudflare 边缘查：两个名字都解析到 Cloudflare，响应里没有 `x-vercel-id`；页面、rss、sitemap、robots 都是 200，根域名没有 noindex；`www` 301 到根域名并保留路径和参数，`http://` 301 到 `https://`；canonical、og:url 和 sitemap 里的 195 个地址都是 `https://gengrowth.ai`；`/api/auth/google/start` 跳到 accounts.google.com，`redirect_uri` 是 `https://gengrowth.ai/api/auth/google/callback`；test1 仍是 200。
7. 切完马上做第 7 节里要登录的那些项。登录不通就立刻回滚。2026-11-05 切完后在正式站上用 Google 登录、One Tap 和退出登录，都正常，不用回滚；那段时间容器日志里没有报错，浏览器确认走的是新服务器（没有 `x-vercel-id`）。
8. 观察 24 小时：`docker logs` 里的 5xx，524 的多少，登录。
9. **回滚：** 删掉隧道里那两个 Public Hostname（连同它们建出来的 DNS 记录），按第 5 步抄下来的值把两条记录加回去。Vercel 项目在观察期内保持自动部署，回滚到的就是最新代码。
10. 稳定 7 天后：删掉 `next.gengrowth.ai` 的 Public Hostname 和站点文件里那一段；Vercel 项目解绑域名、停掉 Git 自动部署，删除 `apps/marketing/vercel.json`；更新 `docs/INFRASTRUCTURE.md` 里 `gengrowth-agents` 和营销站环境变量落点的说明。项目本身先留着，后面跟 app 下线一起清理。

## 7. 验收清单

在新服务器上逐项过，切换后再过一遍：

- 页面：`/`、`/zh`、一篇博客（ISR 缓存）、`/blog/rss.xml`（rewrite）、`/zh/blog/rss.xml`。
- 跳转：`/app` → `/waitlist`，`/blog/whitelabel-seo-tool` → `/blog/best-white-label-seo-tool`，`www.gengrowth.ai` → `gengrowth.ai`，`http://gengrowth.ai` → `https://gengrowth.ai`。语言跳转后的 `Location` 头是 `https://gengrowth.ai/...`，不是 `http://` 或内网地址。
- 短链：一个真实的 `/go/[code]`。
- 登录：Google 跳转登录完整走一遍（回调里用 `after()` 撤销旧授权，确认响应后仍执行了）；One Tap；退出登录。
- 接口：`/api/auth/profile` 未登录返回 401；`/api/credits/balance` 已登录正常；同源的 POST（例如退出登录）不返回 403，带别的 `Origin` 的返回 403（第 2 节 `requestOrigin`）。切换后登录一次，跳回的是 `gengrowth.ai` 上原来那一页，不是 `0.0.0.0`。
- Cloudflare：浏览器控制台没有水合报错（第 3 节 Rocket Loader、邮箱混淆）。
- 长耗时：一个 100 秒内能跑完的工具正常出结果。再跑一个会超过 100 秒的（GEO Agent 或知识库），预期在约 100 秒时 524；看前端给出的报错是否看得懂、页面没有卡住，并在 `docker logs` 里看那次运行有没有接着跑完。
- 低竞争关键词完整跑通一次；AI 可见性检查按钮置灰并显示暂停提示，历史报告能打开。
- 响应头：`X-Frame-Options`、`Strict-Transport-Security` 等安全头都在，且没有 `X-Powered-By`。
- 限流：带伪造的 `X-Real-IP` 连续请求，确认仍按真实 IP 计数。
- 图片：`next/image` 的图能正常出来（`/_next/image` 返回 200）。

## 风险和代价

- **失去的：** 分支预览地址、Vercel 日志和 Observability、发布前的自动检查、零运维的扩容。静态资源改由 Cloudflare 缓存出，不会比现在差。
- **长耗时请求：** 超过约 100 秒的请求会 524（第 0 节第 1 条）。这是为了快而接受的。
- **和 pick 共用一台机器：** 构建时抢 CPU 和内存；Caddy 的站点文件写坏会影响 pick 的所有站点（`deploy.sh` 已在 reload 前验证）。机器挂了，两个站一起不可用。容器设了 `restart: unless-stopped`。
- **单实例：** 见第 0 节第 2 条。

## 工作量（粗估）

- 拆 Workflow：已完成（关键词改回同步路径、可见性暂停、删除依赖和测试）。
- Dockerfile：已完成（本机构建和冒烟测试通过）。
- 代理层配置、部署脚本：已写好（`apps/marketing/deploy/`）。2026-11-05 在本机搭了一个假的 pick（只有 Caddy，用 pick 真实的 Caddyfile，接在本地 `drama` 网络上），`deploy.sh` 实际跑过这几种情况：首次发布（构建、等健康检查、装站点文件、reload），同一个 sha 再发（跳过构建、不 reload），站点文件写坏（Caddy 拒收，原文件放回，退出码 1），回滚到旧 sha（不构建，几秒完成）。经这个 Caddy 访问，根域名 200，`Link` 头是 https，`www` 301 带路径和参数，`next` 带 noindex，`/_next/image` 出 WebP。把上游换成回显请求头的容器后看到，伪造的 `X-Real-IP` 被 `CF-Connecting-IP` 覆盖了。没测的有：真实的 cloudflared 隧道、x86 构建（服务器上的 Docker 版本已查，见第 5 节）。
- 服务器准备、验收和切换：拿到机器权限后半天，另加 7 天观察期。卡在权限上，不在代码上。
