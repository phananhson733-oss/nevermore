<!--
@input  -- pick's Tencent VM (Virginia, /srv/pick-workbench) and the files beside this README
@output -- the one-time setup and the day-to-day commands for running gengrowth.ai there
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
