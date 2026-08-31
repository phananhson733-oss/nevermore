# Isolated citability renderer

This is a separate service, not a Vercel/Next import. It uses the existing
workspace lockfile and Playwright version, and runs as an unprivileged user with
Chromium's sandbox enabled. Do not add `--no-sandbox`, host IPC, Docker socket
mounts, privileged mode or extra capabilities to work around a failed launch.

## Run the bounded service

From the repository root, supply a new scoped `CITABILITY_RENDERER_TOKEN` through
the deployment secret manager (never commit or paste it into command history),
then run:

```sh
docker compose -f apps/marketing/scripts/citability-renderer.compose.yml build
docker compose -f apps/marketing/scripts/citability-renderer.compose.yml up -d
docker compose -f apps/marketing/scripts/citability-renderer.compose.yml exec citability-renderer node apps/marketing/scripts/citability-renderer-runtime.ts
```

If the Docker CLI has no Compose plugin but the standalone `docker-compose`
command is installed, use that command with the same arguments.

The last command reads **actual kernel cgroup v2 files**. It refuses an unlimited
or missing memory/CPU/PID envelope. The production service entrypoint performs
the same check before listening. Compose enforces 768 MiB total memory (no swap),
1 CPU, 128 processes, a read-only root filesystem, 128 MiB temporary storage,
128 MiB private shared memory, dropped capabilities and no-new-privileges.
Hosts must support unprivileged Chromium user namespaces; unsupported hosts fail
closed. The shipped seccomp profile starts from the Apache-2.0 Microsoft Playwright
v1.61.1 `utils/docker/seccomp_profile.json`, mechanically minified. One explicit
addition permits `chroot`, which Chromium uses to jail its **inner user namespace**
into an empty fdinfo directory. No host `CAP_SYS_CHROOT` or other capability is
granted; the outer process still has `CapEff=0`. The upstream capability-gated
rule otherwise blocks this sandbox step when every host capability is dropped.
[Upstream profile](https://github.com/microsoft/playwright/blob/v1.61.1/utils/docker/seccomp_profile.json),
[Chromium namespace sandbox implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/sandbox/linux/services/credentials.cc).

Node 24 runs this TypeScript check directly, avoiding extra pnpm/tsx processes
inside the bounded service container. Run it before sending render requests.

Only loopback port 4318 is published. A trusted HTTPS reverse proxy may expose
`POST /render`; do not expose the service's plain HTTP port directly. Set
`CITABILITY_RENDERER_URL` in Marketing to that exact HTTPS endpoint and configure
the same scoped token. The adapter never follows service redirects with its
authorization header. Do not set any customer provider key in this service.

## Verify the runtime before enabling Marketing

```sh
docker compose -f apps/marketing/scripts/citability-renderer.compose.yml run --rm citability-renderer pnpm exec vitest run --configLoader runner --cache=false --project unit apps/marketing/scripts/citability-renderer.test.ts
```

The runner config loader and disabled test cache avoid writes to the read-only
`/app/node_modules`; do not make the root filesystem writable for the test tool.

This executes real Chromium against deterministic offline DNS/HTTP fixtures,
including the same service HTTP adapter, isolated visible-text captures,
private-target/native-loopback checks, worker/socket policy, finite budgets and
an infinite script deadline. A separate config/unit test verifies the expected
resource limits but cannot substitute for running this container and inspecting
its actual cgroup values.

Run the browser fixture in a separate `compose run --rm` container, as shown;
do not `exec` a second pnpm/tsx service and browser harness into the already
serving container. The 128-PID budget is intentionally shared by every process
in a container. Two complete harnesses were observed exhausting it; the kernel
limit remained enforced rather than being relaxed for the test.

## Evidence boundary

- Two fresh contexts serve the exact same guarded raw HTML: JavaScript disabled
  for the raw body, then enabled for the rendered body. Both use the same bounded
  native CSS-visible-text traversal in an isolated execution world.
- Text resources use the existing DNS/IP-pinned public fetcher. Image/media/font
  bytes are intentionally omitted after URL safety checks; omissions are counted
  separately, and unsafe resources or required-resource failures make the result
  partial. This does not measure image/layout fidelity.
- No browser cookies, credentials, request bodies or persistent profile are used.
  The browser has a deliberately unusable native network proxy; only the guarded
  Node transport can fulfill admitted resources.
- This controlled render does not preserve the source response's HTTP CSP and
  injects a stricter worker/frame/form policy. It is not a simulation of every
  real browser or every search engine. No login or interaction is attempted.
- Missing service, timeouts and incomplete captures do not produce a ratio.

## Verified local runtime evidence — 2026-08-31

The existing local Colima profile was started by the parent task. Only the
dedicated `codex-geo-renderer-20260831` Compose project was used. No provider
credential, production setting or live customer data was used.

- Image build completed from the frozen pnpm lockfile:
  `sha256:8d500b6ffa5d1f2529356c0da9a0201d4c07ab4737ea1d51b33b5b42a27a7563`.
- Applied Compose SHA-256:
  `d8395abe715d1525edb6d357b7ea166b2e66dd16068fd0bca43832a5ef1192b8`.
- Applied seccomp SHA-256:
  `bb0134ec4d0bf7e0eb733fbd255bf68258ab5ff5e8be6bea668a138630743aa5`.
  Docker's loaded profile was compared structurally with this file and matched.
- Actual cgroup files returned memory `805306368`, CPU `1`, PIDs `128`.
  The running process was UID 1000 with `CapEff=0`, `NoNewPrivs=1`, `Seccomp=2`;
  root filesystem read-only and all host capabilities dropped.
- A separate bounded container ran the actual `tsx` HTTP fixture: status
  `measured`, raw `raw`, rendered `raw external JS real JS`, ratio
  `0.15789473684210525`.
- Host-to-live-container HTTP with a synthetic inline-JS document returned 200,
  `measured`, `browser_visible_text`, rendered `raw Linux Chromium`, ratio
  `0.1875`. Its public origin was used for the DNS safety check; this is a
  synthetic document fixture, **not a claim that a live web page was crawled**.
- The live container returned `unavailable/timeout` with a null ratio for an
  infinite script in `12052ms`. A subsequent request returned `measured`
  (`recovered after timeout`), proving cleanup and availability recovery.
- Starting the actual production entrypoint without cgroup bounds exited 1
  before listening, with the missing/unlimited-runtime-limit error.
- The task's containers and network were removed afterward. The built image
  remains available; other containers and the VM were not stopped or pruned.

This is local Linux/container evidence. The renderer has not been hosted or
configured for production Marketing in this task.
