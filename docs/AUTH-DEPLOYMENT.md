# 自助注册与 Google 登录 · 部署配置

代码已经就绪，但**在下面的配置完成前，登录/注册在生产上不会工作**。这些都是
Owner-gated 的控制台操作，代码无法代劳。

相关实现：spec §1.6、`apps/web/src/lib/auth/{session,plan,actions}.ts`、
`apps/marketing/src/lib/auth/one-tap.ts`、两个 app 的
`lib/supabase/session-cookie-options.ts`。

---

## 0. 先决条件：两站必须指向同一个 Supabase 项目

跨子域共享会话的前提是**同一个 Supabase 项目**（同一个 issuer、同一套 JWT 密钥）。
营销站签发的会话 cookie，产品站要能验证。

- 产品站 `nevermore`：`SUPABASE_URL` / `SUPABASE_ANON_KEY`
- 营销站 `gengrowth-agents`：`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**两边的 URL 必须是同一个项目。** 营销站当前这几个变量是 Vercel 的
`type=sensitive`，只写不可读——`vercel env pull` 和 API 都取不出值，所以无法
「读一下现在指向哪」，只能重新写入确认。

> 营销站的 Supabase 变量在 Vercel 上是 **Production / Preview 两套独立值**。
> 只改 Production 会让所有 preview 部署上的登录静默失效。两套都要写。

---

## 1. Google Cloud Console（OAuth client）

登录用的是**营销站已有的那个 OAuth client**（`GOOGLE_CLIENT_ID`，redirect URI
已注册为 `https://gengrowth.ai/api/auth/google/callback`）。需要补两项：

**Authorized JavaScript origins** — One Tap 在浏览器端初始化，Google 会校验
发起页面的 origin：

```
https://gengrowth.ai
https://app.gengrowth.ai
```

**Authorized redirect URIs** — 加上 Supabase 的回调（不是我们自己的域名）：

```
https://<supabase-project-ref>.supabase.co/auth/v1/callback
```

> 这一条容易漏：Supabase 的 OAuth 是 Supabase 先收 Google 的回调，再重定向到
> 我们的 `/auth/callback`。Google 那边要注册的是 **Supabase 的地址**。

---

## 2. Supabase 控制台

**Authentication → Providers → Google：启用**，填入上面那个 client 的
Client ID 与 Client Secret。

**Authorized Client IDs**（同一页面）：把 Client ID 也填进这个列表。One Tap 走的是
`signInWithIdToken`，Supabase 用这个列表校验 id_token 的 `aud`。**不填这一项，
One Tap 会一直失败而重定向登录正常**，两者的失败方式不一样，排查时注意区分。

**Authentication → URL Configuration → Redirect URLs**：

```
https://app.gengrowth.ai/auth/callback
```

---

## 3. 环境变量

### 产品站（Vercel 项目 `nevermore`）

| 变量 | 值 | 说明 |
|---|---|---|
| `SESSION_COOKIE_DOMAIN` | `gengrowth.ai` | 会话 cookie 写到注册域，两站共享。**不设=host-only**，营销站登录后进 app 会是未登录态 |
| `SF_SIGNUP_MODE` | 不设 | 默认开放自助注册。滥用时设 `invite` 可退回邀请制 |

### 营销站（Vercel 项目 `gengrowth-agents`）

| 变量 | 值 | 说明 |
|---|---|---|
| `SESSION_COOKIE_DOMAIN` | `gengrowth.ai` | 同上，两站必须一致 |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | 与 `GOOGLE_CLIENT_ID` 相同 | One Tap 需要在浏览器端拿到 client id。**不设则不弹 One Tap**（静默跳过，不报错） |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | 指向产品站同一个 Supabase | 见第 0 节 |

> `SESSION_COOKIE_DOMAIN` **只在真实域名下设置**。localhost 和 `*.vercel.app`
> 上浏览器会直接拒收带 domain 的 Set-Cookie，表现为「登录成功但立刻又是未登录」。
> Preview 环境请留空。

---

## 4. 数据库迁移

`0044_workspace_plan_tier.sql` 给 `app.workspaces` 加了 `plan_tier`。

- 加列带常量默认值，PostgreSQL 11+ 是 metadata-only，不重写表，锁窗口极短。
- **存量 workspace 会被回填为 `internal`**（不受项目数限制）——它们是人工预置给
  已知 operator 的。列默认值是 `free`，所以此后任何没显式指定的插入都会落在
  受限档。

---

## 5. 验收（配置完成后按顺序验证）

1. **重定向登录**：`app.gengrowth.ai/login` → Continue with Google → 应落到
   `/new-project`（新账号）或 `/`（已有 operator）。
2. **自助注册确实建了新 workspace**：新账号登录后查库，确认 `operator_profiles`
   多了一行，且它的 `workspace_id` **不等于**任何已有 workspace 的 id。
   这是隔离的核心，值得手工确认一次。
3. **免费档闸门**：新账号建第 1 个项目应成功；建第 2 个应看到「免费版包含 1 个
   进行中的项目」，而不是通用报错。
4. **跨子域**：在 `gengrowth.ai` 首页完成 One Tap → 直接打开
   `app.gengrowth.ai` → 应已是登录态，无需再登一次。
5. **One Tap 没弹出来时**先查两件事：`NEXT_PUBLIC_GOOGLE_CLIENT_ID` 是否已设，
   以及 Supabase 的 Authorized Client IDs 是否填了。这两项缺任一都会让 One Tap
   静默不弹，而重定向登录照常工作。

---

## 尚未完成

- 营销站 header 的「登录 / 注册」按钮：等 `feat/marketing-signal-console`
  合入后按 Signal Console 规范补（两边改的是同一个 `header.tsx`）。
  在此之前 One Tap 已可用，营销站也可以用 `siteConfig.appUrl` 跳产品站登录页。
