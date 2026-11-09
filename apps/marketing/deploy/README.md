<!--
@input  -- pick's Tencent VM (Virginia, /srv/pick-workbench) and the files beside this README
@output -- the one-time setup and the day-to-day commands for running gengrowth.ai there, and the task center's database, R2 and env setup
@pos    -- operator runbook; the reasoning and the DNS cutover are in ../docs/plans/2026-11-04-tencent-cloud-migration.md
一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
-->

# gengrowth.ai 在 pick 机器上的部署

访客 → Cloudflare → 隧道 → pick 的 Caddy → 容器 `gengrowth-marketing:3001`。为什么这么做、代价是什么、DNS 怎么切和怎么切回去，都在方案文档第 0、3、5、6 节。

## 一次性准备

动手前先跟 pick 那边说一声，这台机器上会多出这些东西：`drama` 网络上一个容器，`deploy/saas/state/sites/` 里一个文件，一次 Caddy reload，每次发布约 5 分钟的构建 CPU。下面的命令都在服务器上、用 `ubuntu` 用户执行，除非写明在 Mac 上。它就是跑 pick `provision.sh` 的那个用户：`state/sites` 归它，它在 `docker` 组里，sudo 不要密码（2026-11-05 查过）。

1. 目录和代码。deploy key 在 GitHub 的 nevermore 仓库 Settings → Deploy keys 里添加，只读：

   ```bash
   sudo mkdir -p /srv/gengrowth-marketing && sudo chown "$(id -un)" /srv/gengrowth-marketing
   ssh-keygen -t ed25519 -N '' -C gengrowth-marketing-deploy -f ~/.ssh/nevermore_deploy
   cat ~/.ssh/nevermore_deploy.pub
   GIT_SSH_COMMAND='ssh -i ~/.ssh/nevermore_deploy -o IdentitiesOnly=yes' \
     git clone git@github.com:phananhson733-oss/nevermore.git /srv/gengrowth-marketing/repo
   git -C /srv/gengrowth-marketing/repo config core.sshCommand 'ssh -i ~/.ssh/nevermore_deploy -o IdentitiesOnly=yes'
   ```

2. 运行时变量。在 Mac 上执行，`apps/marketing` 目录里，`vercel link` 时选 `gengrowth-agents`。`.env.production.local` 在 git 忽略范围内，传完就删：

   ```bash
   vercel link
   vercel env pull --environment=production .env.production.local
   ssh ubuntu@<服务器> 'umask 077 && cat > /srv/gengrowth-marketing/marketing.env' < .env.production.local && rm .env.production.local
   ```

   Vercel 上标成 Sensitive 的变量拉不出值，文件里写的是字面的 `[SENSITIVE]`。2026-11-05 实拉 `gengrowth-agents` 的 production，66 个里 62 个是这样。这 62 个当天用一次性导出构建取回了原值，已经写进服务器上的 `marketing.env`，做法和检查见迁移方案第 4 节。以后改值直接改服务器上的这个文件；Vercel 项目删掉以后它就是唯一一份，要另外备份到安全的地方。`deploy.sh` 发现还有 `[SENSITIVE]` 就停下并列出变量名，值为空的只提醒。`VERCEL*`、`TURBO_*`、`NX_DAEMON` 是 Vercel 自己构建用的，不用传；`VERCEL_OIDC_TOKEN` 几个小时就过期，也不要放上去。

3. 第一次发布，然后在 Cloudflare 隧道的 Public Hostname 里加 `next.gengrowth.ai` → `http://caddy:80`，用这个地址验收：

   ```bash
   /srv/gengrowth-marketing/repo/apps/marketing/deploy/deploy.sh origin/main
   ```

## 日常

```bash
/srv/gengrowth-marketing/repo/apps/marketing/deploy/deploy.sh origin/main   # 或者某个 sha
/srv/gengrowth-marketing/repo/apps/marketing/deploy/deploy.sh <上次打印的旧 sha>   # 回滚，不重新构建
docker logs --since 1h gengrowth-marketing
```

- 每次发布都会断开正在处理的请求，前后约 2 秒没有响应，挑没人用的时候发。
- 发布前在本地跑 marketing 的 test、typecheck、lint，服务器上不跑。
- 旧镜像不会自动删，每个约 540 MB。留最近几个用来回滚，其余用 `docker rmi gengrowth-marketing:<sha>` 删掉。不要在这台机器上跑全局的 `docker system prune`，那会连 pick 的东西一起清掉。

## 任务中心

任务中心、我的收益和后台用两样外部的东西：pick 那个 TencentDB 里的 `gengrowth_tasks` 库，和 Cloudflare R2 的一个私有桶。缺哪一样，对应的页面就显示「暂时不可用」，站点其余部分照常。方案在 `../docs/plans/2026-11-05-task-center.md`。

1. **数据库连接串**放在 `/srv/gengrowth-marketing/tasks-db.env`，只有一行 `TASKS_DATABASE_URL=...`，权限 600。2026-11-05 pick 已经建好。单独一个文件，是因为 `deploy.sh` 每次发布前用一个 `postgres:17.6` 容器跑 `db/tasks/migrate.sh`，那个容器只该看到这一行。迁移可以重复跑，已经跑过的跳过；失败了 `deploy.sh` 就停下，正在跑的容器不动。

2. **R2。** 在 Cloudflare 后台开 R2、建一个私有桶、建一个只能读写这个桶的 R2 API 令牌（Object Read & Write，限定到这个桶）。然后在桶的 Settings → CORS policy 里贴：

   ```json
   [
     {
       "AllowedOrigins": ["https://gengrowth.ai", "https://next.gengrowth.ai", "http://127.0.0.1:3001"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   后台上传是浏览器直接 PUT 到 R2，没有这段 CORS 浏览器会拦下，后台会提示去查 CORS。`127.0.0.1:3001` 只给本机开发用，不需要可以去掉。

3. **写进 `marketing.env`**，值自己填，不要经过对话或提交进仓库：

   ```bash
   TASK_ADMIN_EMAILS=a@example.com,b@example.com
   R2_ACCOUNT_ID=...
   R2_BUCKET=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   PICK_LOOKUP_URL=http://drama-platform-web-1:8088
   PICK_LOOKUP_TOKEN=...
   ```

   `TASK_ADMIN_EMAILS` 是能进 `/admin/tasks` 的 Google 登录邮箱，逗号分隔，大小写不论。`R2_ACCOUNT_ID` 是 Cloudflare 的账号 ID，在 R2 页面上能看到。注释单独写一行，不要跟在值后面。四个 R2 变量缺任何一个，上传和素材预览都不可用。`PICK_LOOKUP_*` 是后台「查剧」问选剧台用的：地址是选剧台 web 容器在 `drama` 网络上的名字，不走公网；token 要和选剧台 web 那边的 `PICK_LOOKUP_TOKEN` 是同一个，在选剧台那边用 `deploy/saas/set-env.sh web PICK_LOOKUP_TOKEN --show-once` 生成。两个缺一个，查剧面板就直接给手填表单。

   都是运行时变量，不用重新构建。改完重新发一次当前的 sha，容器会带着新变量重建：

   ```bash
   /srv/gengrowth-marketing/repo/apps/marketing/deploy/deploy.sh "$(docker inspect --format '{{.Config.Image}}' gengrowth-marketing | cut -d: -f2)"
   ```

不在名单里的人打开 `/admin/tasks` 看到的是 404。结算文件的格式写在后台的「结算导入」页上。
