# Marketing deploy on pick's Tencent VM

gengrowth.ai runs as one container behind pick's Cloudflare tunnel and Caddy. Nothing here runs on Vercel or in CI, and Docker builds leave this directory out (root `.dockerignore`). The plan and its trade-offs live in `../docs/plans/2026-11-04-tencent-cloud-migration.md`.

- `compose.yml` — the `gengrowth-marketing` container on pick's external `drama` network; image tag from `MARKETING_SHA`, env file outside the repo.
- `gengrowth-marketing.caddy` — pick's Caddy site file: the apex proxied with `X-Real-IP` taken from `CF-Connecting-IP`, `www` 301 to the apex, and `next.gengrowth.ai` as a noindex acceptance host.
- `deploy.sh` — manual deploy by git ref: refuses an env file still holding `[SENSITIVE]` placeholders or a bare `$`, builds only when that sha's image is missing, starts it and waits for its health check, validates Caddy before reloading it, and prints the sha to roll back to.
- `README.md` — one-time VM setup and the day-to-day commands.
