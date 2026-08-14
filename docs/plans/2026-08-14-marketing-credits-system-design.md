# 营销站积分体系设计（Credits v1）

日期：2026-08-14（rev 2，吸收 spec-reviewer + codex 双评审）
状态：设计稿（待 Owner 终审）
范围：apps/marketing（gengrowth.ai）。产品端 app.gengrowth.ai 明确不在本次范围（v0.3/v0.4 冻结规范禁止 billing 面；见"远期"节）。

## 0. 背景与目标

给 gengrowth.ai 公开工具建一套积分体系，参考 Manus.im 的机制：每日登录得积分、按工具消耗积分、邀请得积分、充值得积分。

Owner 已拍板的决策（2026-08-14）：

| 决策点 | 结论 |
|---|---|
| 覆盖范围 | 先营销站工具，产品端远期接同一账本 |
| 商业模式 | 纯积分充值制起步，不做订阅 |
| 支付渠道 | Airwallex（空中云汇），移植 oracle 项目已实战的链路 |
| 匿名试用 | quick-wins / traffic-drop 保留少量 IP 试用；keyword 工具与 Agents 登录专享 |
| 定价数值 | 接受本文档推荐值（见 §6） |
| **上线节奏** | **当前为测试/福利期：只发放、不扣费。消耗机制的 schema 一期落库，扣费实现与接线二期交付** |

现状要点（调研结论，2026-08-14，基于 origin/main）：

- 全仓库零支付设施：无支付 SDK、无 webhook、无积分/计费表。完全绿地。
- 营销站现有配额全部是 IP 维度窗口计数（`consume_public_tool_quota` RPC，service-role 专用，fail-closed）——本设计沿用同一模式。
- 营销站与产品 app 共用同一 Supabase 认证项目，会话 cookie 作用域为 gengrowth.ai 根域（One Tap 登录一次两边生效）→ 积分账户以 Supabase `user_id` 为主键。注意：产品端还开着 email+password 登录，所以**不能假设积分账户全部来自 Google 身份**，反滥用依赖上限与监控而非登录方式（codex P1-12）。
- 营销站工具的身份现状：keyword / quick-wins / traffic-drop 走 `gg_id` 封印 cookie（Google OAuth，**不是** Supabase 会话）；只有 Agents API 校验 Supabase 会话。`getServerAuthenticationStatus()` 刻意不返回 user id——积分需要新增服务端身份助手（经 `supabase.auth.getUser()` 校验后返回 UUID），绝不从请求参数或未验证 claims 取 `p_user_id`（codex P1-13）。
- 工具真实成本（2026-08-10 实测拟合）：keyword 工具 DFS ≈ $0.088 p50/次（单次 provider 上限 $0.25）+ LLM ≈ 50k tokens（单价未知）；quick-wins 仅 LLM（小）；traffic-drop / 站点审计 / profile 刷新 $0 外部成本；profile 搜索 $0.002–0.013/次。
- 现有熔断的准确表述（codex P1-19）：keyword 工具有"每日 56 次"的**计数**熔断（按 $0.088 p50 折合约 $5/天，最坏 56×$0.25=$14/天）+ 单次 $0.25 provider 上限；它只保护 keyword 工具，不是全平台美元上限。本设计不得把它当成全平台兜底来引用。
- Manus 机制基准（官方帮助中心）：注册 +1000；每日 300 重置式（免费用户月上限 1500 且只限最低档模式）；消耗顺序"先花会过期的"；充值积分永不过期；技术故障全额退；邀请双边各 500（第三方口径）。

## 1. 分期

### Phase 1 —— 福利期（本次实施）

只发不扣。目标：把账本、身份、发放三条闭环跑通，积累注册与留存，为二期开闸铺垫预期。

- 账本 schema（migration 0004：accounts + ledger + settings，全部约束齐备）与**发放侧** RPC（ensure/touch/reward_referral）。扣费侧（consume/refund/charges）schema 与实现延后到 Phase 2 落库交付，避免把最难验证的跨日/崩溃语义在没有生产反馈时提前固化（codex P2-16）。
- 注册奖励 +100
- 每日签到 +20（福利期为**累加制**，累计封顶 600；见 §5.2）
- 邀请闭环：双边各 +50，被邀请人完成首次合格工具运行才计奖（见 §5.3）
- **工具 handler 的一期改动边界（明确定义，解决"零改动"歧义）**：不改任何准入、配额、鉴权行为；仅在下列 handler 的**成功路径**追加"只读 Supabase 会话探测 + 幂等首跑上报"（未登录则跳过，上报失败不影响工具响应）：quick-wins、traffic-drop、keyword stage 2、agent audit（seo/tech）、profile-refresh。profile-search 不算合格运行（见 §5.3）。扣费接线完全不在一期。
- UI：头部余额徽章、`/account/credits` 页（余额/签到/流水/邀请）、工具页"测试期限免"标注（预告正式价）
- `/r/[code]` 邀请落地路由，**必须同步在 `src/proxy.ts` 加排除**（next-intl proxy 会把未排除路径改写进 `[locale]` 树导致 404；`/go` 已有先例。且根路径单段小写码会被 rewrite 到 `/go/{code}` 短链兜底，邀请链接必须保持 `/r/` 两段式）。

### Phase 2 —— 开启消耗

- migration 0005（charges 表）+ consume/refund RPC + 工具准入接线 + 余额不足弹窗 + 失败退款 + 滞留扣费清扫 cron
- 每日签到从累加制切换为**重置制**（切换机制见 §9，权威在 DB 不在 env）
- keyword 工具与 Agents 统一为 Supabase 登录专享；quick-wins / traffic-drop 匿名保留少量 IP 试用（具体次数进 `credits-config.ts`，测试 pin 死）
- 现有工具级熔断（keyword 56 次/天、$0.25/次、4/h/目标域名等）全部保留
- 开闸前置门（全部满足才切 live）：LLM 单价从生产 `analysis_invocations` 实测校准一次并复核工具定价；对存量福利余额跑一次刷量审计（同 IP 簇、邀请团伙模式），可疑账户先冻结再开闸

### Phase 3 —— Airwallex 充值

- migration 0006（订单 + webhook 事件表）+ PaymentIntent + 托管收银台链路（移植 oracle，修掉已知缺陷，**移植时记录 oracle 源 commit SHA**）
- webhook + confirm + cron 对账三保险；服务端反查核对（见 §7）
- USD + CNY
- 开闸前置门：真卡最小包冒烟 + 退款路径 + 重复/乱序 webhook 回归 + 订单超时/对账并发用例全绿；积分销售条款（无现金价值、不可转让、规则可调整）落 Terms 页

### 远期（不在本设计范围）

产品端 app 接同一账户主键（无数据迁移，但仍需产品端合同、entitlement 与接线工作——不承诺"零工作量"）。前置条件：解除 v0.4 规范对 billing/entitlement 的冻结（`authority/implementation-spec-v0.3/MVP-IMPLEMENTATION-SPEC.md` §100/§145、CLAUDE.md v0.4 范围声明）。

## 2. 架构总览

```
用户（Supabase 会话，One Tap / OAuth / email+password）
   │
   ├── GET /api/credits/balance ──► ensureAccount + touchDaily（懒发放；no-store；限频）
   ├── GET /api/credits/ledger  ──► 流水分页（cursor: created_at desc, id desc）
   ├── /r/[code] ──► 落 gg_ref cookie（30d）──► ensureAccount 时归因 referred_by
   │
工具 handler
   ├── Phase 1 起：成功路径只读会话探测 + 幂等首跑上报（不改准入/配额）
   ├── Phase 2 起：准入点扣费（顺序见 §4）+ 失败退款
   │
Airwallex（Phase 3）
   ├── POST /api/credits/orders → PaymentIntent → HPP 跳转
   ├── POST /api/credits/webhook（HMAC 验签）
   ├── POST /api/credits/orders/confirm（return_url 回来后）
   └── GET  /api/cron/credits-reconcile（CRON_SECRET；Phase 2 起兼扫滞留扣费）
   │
Supabase（营销项目 public schema，service-role RPC，RLS deny-all）
   credit_accounts / credit_ledger / credit_settings          （0004，Phase 1）
   credit_charges                                             （0005，Phase 2）
   credit_purchase_orders / credit_webhook_events             （0006，Phase 3）
```

身份：一切以 Supabase `user_id` 为准，服务端经 `auth.getUser()` 校验后传入 RPC。GSC 授权（`gg_gsc` 封印 cookie）保持独立，只管数据访问，与积分无关。

## 3. 数据模型

营销站迁移目录 `apps/marketing/supabase/migrations/`，延续现有编号与"OWNER STEP 手动执行"惯例。财务表的上线次序固定为：**代码带关闭开关先部署 → 事务内应用 migration → schema/RPC smoke → 打开发放 →（Phase 2）另行打开扣费**。

### 0004（Phase 1）：credit_accounts + credit_ledger + credit_settings

```sql
create table public.credit_accounts (
  user_id            uuid primary key,          -- Supabase auth user id
  status             text not null default 'active' check (status in ('active','frozen')),
  permanent_balance  integer not null default 0 check (permanent_balance >= 0),
  daily_balance      integer not null default 0 check (daily_balance >= 0),
  daily_granted_on   date,
  daily_accrued_total integer not null default 0 check (daily_accrued_total >= 0),
  referral_code      text not null unique check (char_length(referral_code) <= 16),
  referred_by        uuid references public.credit_accounts(user_id),
  referral_rewarded_count integer not null default 0 check (referral_rewarded_count >= 0),
  first_tool_run_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (referred_by is null or referred_by <> user_id)
);

create table public.credit_ledger (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references public.credit_accounts(user_id),
  entry_type       text not null check (entry_type in
    ('signup_bonus','daily_grant','daily_expire','consume','refund',
     'referral_reward_inviter','referral_reward_invitee',
     'purchase','adjustment')),
  amount           integer not null,
  daily_delta      integer not null default 0,
  permanent_delta  integer not null default 0,
  balance_daily_after     integer not null check (balance_daily_after >= 0),
  balance_permanent_after integer not null check (balance_permanent_after >= 0),
  tool_slug        text check (char_length(tool_slug) <= 64),
  idempotency_key  text not null unique check (char_length(idempotency_key) <= 128),
  metadata         jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 4096),
  created_at       timestamptz not null default now(),
  check (amount = daily_delta + permanent_delta),
  check (case entry_type
           when 'signup_bonus' then amount > 0
           when 'daily_grant' then amount > 0
           when 'daily_expire' then amount < 0
           when 'consume' then amount < 0
           when 'refund' then amount >= 0
           when 'referral_reward_inviter' then amount > 0
           when 'referral_reward_invitee' then amount > 0
           when 'purchase' then amount > 0
           else true end)   -- adjustment 允许任意符号，但仅限治理入口（见 §10）
);
create index credit_ledger_user_page_idx on public.credit_ledger (user_id, created_at desc, id desc);
-- append-only：禁止 UPDATE/DELETE 的 trigger（拒绝并 RAISE）
create table public.credit_settings (
  id smallint primary key check (id = 1),
  mode text not null default 'welfare' check (mode in ('welfare','live')),
  daily_amount integer not null default 20,
  welfare_accrual_cap integer not null default 600,
  updated_at timestamptz not null default now()
);
```

要点（吸收双评审）：

- **余额是单行快照 + append-only 流水**，不做全表求和（oracle 性能债）；ledger 建 UPDATE/DELETE 拒绝 trigger。
- **幂等靠 `idempotency_key UNIQUE`**（oracle 依赖 23505 但约束没建的 P0 修正）。**冲突时 RPC 必须校验既有行的 (user_id, entry_type, amount, tool_slug) 与本次参数一致**：一致 → 返回既有结果（幂等重放）；不一致 → 返回 `idempotency_mismatch` 错误，绝不静默当成功（codex P1-16）。
- **每日重置在流水里记两条**：`daily_expire`（-旧余额，若>0）+ `daily_grant`（+20），键 `daily-expire:{userId}:{date}` / `daily:{userId}:{date}`——账能重放对平（codex P1-1）。
- **mode 的权威在 `credit_settings` 单行表，RPC 自己读**，不从应用参数传入——滚动发布期间新旧实例行为一致，welfare→live 切换是一次 DB 事务（codex P1-26）。env 只控制 UI 显隐。
- 所有日期（`daily_granted_on`、幂等键日期、"今天"）**一律 UTC**，由 RPC 内部 `current_date`（DB 时区固定 UTC）生成，不信任应用传入的日期串。
- **SECURITY DEFINER 硬化**（对齐 0001 迁移已有做法）：每个函数 `SET search_path = public, pg_temp`、全限定表名、`REVOKE ALL FROM public, anon, authenticated`、仅 `GRANT EXECUTE TO service_role`。
- RLS：全部表开 RLS 且不建任何 anon/authenticated 策略。

### 0005（Phase 2）：credit_charges——扣费执行状态机

```sql
create table public.credit_charges (
  run_id       uuid primary key,               -- 服务端生成，绝不接受客户端提供
  user_id      uuid not null references public.credit_accounts(user_id),
  tool_slug    text not null check (char_length(tool_slug) <= 64),
  amount       integer not null check (amount > 0),
  daily_part   integer not null check (daily_part >= 0),
  permanent_part integer not null check (permanent_part >= 0),
  status       text not null default 'charged' check (status in ('charged','settled','refunded')),
  created_at   timestamptz not null default now(),
  terminal_at  timestamptz,
  check (amount = daily_part + permanent_part)
);
```

流水只管钱，charges 管**一次运行的执行终态**（codex P1-3/4/6）：`consume` RPC 在同一事务里"扣余额 + 写 ledger + 建 charge(charged)"；工具成功 → `settle`（置 settled）；工具失败 → `refund`；**进程死亡/超时** → cron 清扫把超过 30 分钟仍 `charged` 的记录自动退款（工具最长 240–300s，30 分钟余量充足）。runId 由服务端准入时生成 UUID，重试是新 charge（上一笔由失败退款或清扫兜底）。

### 0006（Phase 3）：credit_purchase_orders + credit_webhook_events

```sql
create table public.credit_purchase_orders (
  id                 uuid primary key default gen_random_uuid(),  -- 兼作 merchant_order_id 与 provider 幂等键
  user_id            uuid not null references public.credit_accounts(user_id),
  pack_id            text not null check (char_length(pack_id) <= 32),
  credits            integer not null check (credits > 0),
  amount_cents       integer not null check (amount_cents > 0),   -- 内部一律分
  currency           text not null check (currency in ('USD','CNY')),
  provider           text not null default 'airwallex',
  provider_intent_id text unique,
  status             text not null default 'pending' check
                     (status in ('pending','paid','failed','expired','refunded','disputed')),
  failure_reason     text,
  paid_at            timestamptz,
  refunded_at        timestamptz,
  reconcile_attempts integer not null default 0,
  last_checked_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.credit_webhook_events (
  event_id    text primary key,
  status      text not null default 'processing' check (status in ('processing','done','failed')),
  attempts    integer not null default 1,
  last_error  text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
```

订单状态单调：`paid` 不可被迟到的 `failed/expired` 降级；webhook 的 claim、状态与积分结算在**同一数据库事务**内完成（codex P1-24）。

### RPC 一览（全部 SECURITY DEFINER + service-role 专用，单事务内"改余额 + 写流水"不可分离）

| RPC | 交付期 | 语义 |
|---|---|---|
| `credits_ensure_account(p_user_id, p_ref_code)` | 1 | 建户 + 注册奖 100 + 归因 referred_by（幂等；见 §5.3 归因时点） |
| `credits_touch_daily(p_user_id)` | 1 | 懒发放。mode 与数额自 `credit_settings` 读取。welfare：+daily_amount 入永久池，`daily_accrued_total` 封顶；live：daily_expire+daily_grant 两条重置每日池。当日已发 → no-op |
| `credits_reward_referral(p_invitee_id)` | 1 | 单事务原子：`UPDATE ... SET first_tool_run_at = now() WHERE user_id = p_invitee_id AND first_tool_run_at IS NULL` 命中才继续；邀请方 `UPDATE ... SET referral_rewarded_count = referral_rewarded_count + 1 WHERE ... AND referral_rewarded_count < 20 RETURNING` 原子占位（防 19→21 并发越界，codex P1-10）；邀请方达上限时**被邀方仍得 +50，邀请方不再得**；双方任一账户 frozen 则不发 |
| `credits_consume(p_user_id, p_run_id, p_amount, p_tool, p_idem_key)` | 2 | 原子扣减（先每日后永久，单条 UPDATE 跨池凑数）+ 建 charge；余额不足返回 `insufficient`；账户 frozen 返回 `frozen` |
| `credits_settle_charge(p_run_id)` | 2 | charge → settled（幂等） |
| `credits_refund(p_run_id)` | 2 | 校验 charge 属于该 user、状态 charged；按原拆分回补，**daily 部分仅当 charge 创建日 == 当前 UTC 日期才回补，跨日作废**（消除跨日 40 分套利与顺序依赖，codex P1-2）；退款后 charge → refunded |
| `credits_settle_purchase(p_order_id, p_verified)` | 3 | 服务端已反查 Airwallex 并核对后调用；订单置 paid + 发永久积分，幂等键 `purchase:{packId}:{intentId}` 兜底 |

幂等键约定：

| 事件 | 键 |
|---|---|
| 注册奖励 | `signup:{userId}` |
| 每日签到 / 每日过期 | `daily:{userId}:{YYYY-MM-DD}` / `daily-expire:{userId}:{YYYY-MM-DD}` |
| 消耗 / 退款 | `consume:{runId}` / `refund:{runId}` |
| 邀请（被邀方 / 邀请方） | `referral-invitee:{inviteeId}` / `referral-inviter:{inviteeId}` |
| 充值 | `purchase:{packId}:{intentId}` |
| 治理调整 | `adjust:{ticketRef}`（独立命名空间，见 §10） |

## 4. 消耗与退款（Phase 2 接线）

**准入顺序（明确定义，codex P1-7）**：登录校验 → 现有全部闸门（in-flight 409、IP/target 窗口、工具级熔断）→ 缓存查询 → **仅当需要发起新的真实运行时**才 `touchDaily + consume`。因此：被限流/409/503 的请求从未扣费，无退款问题；**缓存命中的响应免费**（同一目标 1h 内重复审计不重复收费）。扣费成功后立即开始工具执行。

**终态判定不按 HTTP 状态码**（codex P1-8）：多个工具用 200 承载错误 envelope（`source_unavailable`、`no_gsc_data` 等）。每个工具在 `credits-config.ts` 里维护**可退款终态码清单**（含抛错路径），由一致性测试 pin 死：

| 工具 | 计费成功（settle） | 退款（refund） |
|---|---|---|
| keyword stage 2 | 返回机会列表（含空列表但流程完整） | 任何 stage 2 错误终态 / 抛错 |
| agent audit | 审计结果产出 | 爬虫死亡 / 抛错 |
| quick-wins | 机会行产出 | `no_gsc_data` 等无数据终态 / 抛错 |
| traffic-drop | 诊断结论产出 | `no_gsc_data` / 抛错 |
| profile-refresh | 画像草稿产出 | 爬虫死亡 / 抛错 |
| profile-search | 结果返回 | `source_unavailable` / 抛错 |

**keyword 收费点在 stage 2 准入**（codex P1-5）：stage 1（上下文爬取）保持免费（受现有 IP 配额约束）——25% 的运行死在 stage 1，收费点后移直接消掉最大宗退款流量，也避免"收了钱用户不跑 stage 2"的悬空；stage 2 才发生 DFS 支出。keyword 整单 25 分在 stage 2 一次收取。

**崩溃兜底**：handler 失败路径调 `refund(runId)`；进程死亡由 cron 清扫兜底（§3 0005）。

**退款滥用防线**（codex P1-18）：每用户每日自动退款上限 5 次，超出则该用户当日退款转人工（charge 保持 charged 由清扫处理 + 打风险标记日志）；同一目标域名的重复失败计入现有 per-target 熔断。

**积分库不可用**：live 模式下消耗类工具 fail-closed 503（对齐现有 `quota_unavailable`）；welfare 模式与匿名路径不受影响，余额徽章静默隐藏。

## 5. 获取侧机制

### 5.1 注册奖励

+100，`ensure_account` 内一次性发放（幂等键 `signup:{userId}`）。对任何 Supabase 认证方式生效（含产品端 email+password 注册的账户）；滥用防线是上限+监控+冻结，不依赖登录方式。同邮箱删号重注册会拿到新 UUID 再得一次注册奖——已知残余风险，靠注册奖数额小（=4 次 keyword 运行）与后述监控兜住，不在 v1 上设备指纹。

### 5.2 每日签到

- 触发：当天（UTC）第一次带登录态的 `GET /api/credits/balance`（头部徽章加载即触发）。该端点 `Cache-Control: no-store, private` 并做每用户限频（复用 `consume_public_tool_quota`，如 30 次/小时），多 tab/轮询不放大写入。
- **福利期（welfare）**：+20 累加进永久池，`daily_accrued_total` 封顶 600（≈30 天量）。封顶后签到返回"已达福利上限"状态，UI 如实展示。
- **正式期（live）**：每日池重置为 20（`daily_expire` + `daily_grant` 两条流水）。刻意 < 25：免费用户每天能白嫖便宜工具，最贵的 keyword 工具必须邀请或充值——等效 Manus"每日积分只限 Lite 模式"的分层。
- **切换日语义**：mode 切到 live 当天，已领过 welfare +20 的用户当日不再得每日池（`daily_granted_on` 已是今天），次日起进入重置制。welfare 已累加的永久积分不回收。

### 5.3 邀请

- 每账户固定 ≤16 位小写 base32 邀请码（去易混淆字符），建户时生成，冲突重试。
- 链接 `gengrowth.ai/r/{code}`：302 到首页 + 落 `gg_ref` cookie（**HttpOnly、Secure、SameSite=Lax、host-only、30 天、last-touch**；无效/自己的码不落 cookie）。`/r` 路由加进 `proxy.ts` 排除清单（§1）。
- 归因：`ensure_account` 时读 cookie（首个登录态请求与页面加载同生命周期，cookie 必然在场），校验码存在且非本人，写 `referred_by` 并清 cookie。账户已存在且 `referred_by` 为空时不补归因（一次性，防事后改绑）。
- **计奖门槛：被邀请人完成首次"合格工具运行"**——quick-wins / traffic-drop / keyword stage 2 / agent audit / profile-refresh 的登录态成功运行（这些都要求连接真实 Search Console 或爬取真实站点，抬高刷量成本）；profile-search 不合格（太廉价）。上报机制：每次合格成功运行都调 `reward_referral`（RPC 内部以 `first_tool_run_at IS NULL` 判首次，否则 no-op）——上报失败不影响工具响应，下次成功运行自动重试，**自愈**。
- 双边各 +50（永久池）；邀请方累计 20 次计奖封顶（原子占位，见 §3 RPC 表）；达顶后被邀方仍得 +50。
- **防滥用分层**（codex P1-11/20 的 v1 回应）：①个体上限（签到 600 封顶 / 邀请 20 次封顶 / 注册奖一次）；②**全局熔断**：每 UTC 日全平台计奖邀请数上限（初始 200，进 `credits-config.ts`），触顶停发并告警——封住 Sybil 团伙的日增速；③监控：邀请双方同 IP、同设备簇记结构化日志；④`credit_accounts.status='frozen'` 冻结开关：冻结账户不发放、不消耗、不计奖；⑤Phase 2 开闸前对存量余额跑刷量审计（§1）。v1 明确不做：设备指纹、支付验证门槛。剩余风险定价：福利期积分在 live 前无消耗价值，团伙刷出的余额在开闸审计时可冻结清退（`adjustment` + 治理流程）。

### 5.4 失败退款

见 §4。福利期不扣费故无退款路径。

## 6. 定价常量（单一真源 + 防漂移测试）

`apps/marketing/src/lib/credits/credits-config.ts` 集中全部数值（工具价、可退款终态码、获取数值、全局熔断阈值、匿名试用次数、积分包）；UI 展示与后端逻辑都从这里取。移植 oracle 的价格一致性测试思路：任何展示层复制品都用测试 pin 回该常量。

零售锚定：**1 积分 ≈ $0.01**。

| 工具 | 真实成本/次 | 积分价（Phase 2 生效） |
|---|---|---|
| Keyword Opportunity Map（stage 2 收） | DFS $0.10–0.13 + LLM 未校准（~50k tokens） | 25 |
| Agent 站点审计（SEO/Tech） | $0 外部（算力） | 10 |
| SEO Quick Wins（含 AI 草稿） | LLM ~$0.01–0.03（估） | 5 |
| Agent Profile 刷新 | 爬虫+LLM | 5 |
| Traffic Drop 诊断 | $0 | 3 |
| Agent Profile 搜索 | $0.002–0.013 | 2 |

| 获取项 | 数值 |
|---|---|
| 注册奖励 | 100 |
| 每日签到 | 20（福利期累计封顶 600） |
| 邀请（双边各） | 50；邀请方 20 次封顶；全平台 200 次计奖/日熔断 |

| 积分包（Phase 3） | USD | CNY |
|---|---|---|
| 500 | $4.99 | ¥35 |
| 1,100（+10%） | $9.99 | ¥69 |
| 2,400（+20%） | $19.99 | ¥139 |
| 6,500（+30%） | $49.99 | ¥349 |

**毛利与负债的诚实口径**（codex P1-21/20 修正）：
- keyword 单次 COGS = DFS $0.088 p50 **+ LLM 未校准项**；在 LLM 单价实测前，"500 积分包毛利 ~48%"只是 DFS-only 下界估算，**Phase 2/3 开闸前必须用生产 `analysis_invocations` 实测补全**，毛利结论以校准后为准。Airwallex 手续费、退款、拒付另计。
- 单账户福利上限 1,700（100+600+20×50）只界定**单个账户**；Sybil 团伙的总负债 = 账户数 × (100+600+50)，个体上限拦不住，靠全局计奖熔断限增速 + 开闸前审计清退兜底。福利期积分在 live 之前无消耗价值，这是最大的安全垫。

## 7. 充值链路（Phase 3，移植 oracle 并修坑）

移植来源：`/Users/wzb/Code/oracle` 主树；**动手移植当天记录其 commit SHA 于实施计划**，逐项核对下表"必须修的坑"后再进仓。

| 移植项 | 必须修的坑 |
|---|---|
| PaymentIntent 创建（金额用主单位非分） | `merchant_order_id` = 本地订单 UUID，兼作 provider 幂等键；先落 pending 订单再调 provider，`provider_intent_id` 回写失败由对账两向收敛（本地有单无 intent / provider 有 intent 未绑定，codex P1-25） |
| HPP 跳转封装（CDN SDK，50 行） | 不依赖 sessionStorage；`return_url` 带订单号，服务端用 `merchant_order_id` 反查 |
| webhook HMAC 验签 | 先比 length 再 `timingSafeEqual`；校验 `x-timestamp` 与当前时间偏差 ≤5 分钟（防重放）；body 大小上限 64KB；错误日志脱敏 |
| **结算前服务端反查**（codex P1-22） | 收到 webhook / confirm 后，从 Airwallex API 读取 intent，逐项核对：终态 succeeded、`merchant_order_id` 与本地订单一致、金额/币种与订单的**服务端 pack 快照**一致、环境（demo/prod）一致；任一不符拒绝结算并告警。credits/amount/currency 永远来自服务端订单行，绝不接受客户端或 webhook body 的数额 |
| webhook + confirm 双路径 | 共用幂等键 `purchase:{packId}:{intentId}`，UNIQUE 约束兜底；事件 claim/状态/结算同一事务 |
| cron 对账 | 扫 pending 超 10 分钟订单反查 provider → settle / expire；`reconcile_attempts`/`last_checked_at` 记录 |
| env `.trim()`、demo/production 双环境、7 项上线验证脚本 | 照抄 |

**退款/拒付会计模型**（codex P1-23，v1 政策）：收到 provider refund/chargeback 事件 → 订单置 `refunded/disputed` → 账户立即 `frozen` → 治理流程人工处理（`adjustment` 负条目扣回可扣部分；已花掉形成的差额记录在 metadata 作坏账，不引入负余额列）。预期量级极低，v1 不建自动 clawback。

env（名称沿用 oracle）：`AIRWALLEX_CLIENT_ID` / `AIRWALLEX_API_KEY` / `AIRWALLEX_WEBHOOK_SECRET` / `AIRWALLEX_ENVIRONMENT`。积分包走 PaymentIntent，不需要 Dashboard price_id。webhook raw body：Next.js route handler 用 `req.text()` 原文验签，测试 pin 原文字节。

## 8. UI 与文案

- 头部（登录态）：积分徽章（余额 + 今日签到状态），点击进 `/account/credits`。
- `/account/credits`：余额卡（福利期显示"测试期福利"说明）、签到状态、流水（逐条：时间/事由/±数额/余额；游标分页 `(created_at, id)` 双键）、邀请卡（复制链接 + 已计奖次数）、积分包（Phase 3）。
- 工具页标注（福利期）："测试期限免 · 正式上线后 25 积分/次"——提前锚定预期，避免二期开闸被骂。
- 余额不足弹窗（Phase 2）：价格 vs 余额 + 三 CTA（等明日签到 / 邀请 / 充值）。
- i18n：en/zh 双语，沿用 message namespace + TS content module 惯例。文案不得暗示"积分=法币"或承诺兑换；条款页注明积分无现金价值、可调整规则（Phase 3 前落地）。

## 9. 配置与开关

| 开关 | 落点 | 语义 |
|---|---|---|
| `MARKETING_CREDITS_ENABLED` | env | 只控制 UI 与 credits API 路由显隐（fail-open 为隐藏）。**不**改变已接线工具的扣费行为 |
| `credit_settings.mode` | **DB 单行** | welfare / live 的唯一权威，RPC 自读；切换是一次 DB 事务，滚动发布无双模窗口 |
| 消耗紧急开关（Phase 2） | `credit_settings` 增列 `consumption_paused boolean` | 置 true 时消耗类工具返回 503"暂停服务"，**不是变免费**（fail-closed，防止昂贵工具裸奔） |
| `AIRWALLEX_*` | env | Phase 3 支付凭证 |

数值常量不进 env（进 `credits-config.ts`，改数值走发版，可测试可回溯）。

## 10. 治理入口（adjustment）

`adjustment` 条目仅允许通过独立的运维脚本（service-role，本机执行，同现有 OWNER STEP 惯例）写入：必须携带 metadata `{actor, reason, ticketRef}`，幂等键 `adjust:{ticketRef}`；普通服务层代码路径不得调用。用途：刷量清退、客服补偿、拒付扣回。

## 11. 测试策略

- **单元（vitest）**：服务层准入/发放/退款/幂等分支、每工具可退款终态映射、credits-config 与 UI 展示一致性、`/r/[code]` 归因与 cookie 语义。
- **SQL 集成（disposable PostgreSQL，沿用仓库 `signalframe_ci*` 纪律）**（codex P1-27）：把 0004+（及后续期次）migration 实际应用到一次性库，多连接并发回归：同 runId 双 consume 只扣一次、双 refund 只退一次、跨日退款 daily 部分作废、touch/refund 乱序结果确定、20 邀请封顶并发不越界、welfare 封顶并发不超发、webhook 双投同事务只结算一次；最后**用 ledger 重放校验快照余额一致**。
- **mock e2e**：登录 → 徽章 → 签到入账 → 流水 → 邀请链接归因 →（Phase 2）扣费/不足弹窗/失败退款。
- **支付 e2e 边界**：只能测到 HPP 跳转前；Phase 3 开闸门见 §1。
- 时序敏感用例不靠重跑（仓库既有纪律）。

## 12. 风险与开放问题

1. **LLM 单价缺口**：Phase 2 开闸前从生产 `analysis_invocations` 实测校准，复核 keyword/quick-wins 定价与毛利结论（§6）。
2. **DFS 未拟合端点**：profile 搜索的 `competitors_domain` 价格是外推值；Phase 2 前用真实响应 `cost` 字段校准。
3. **Sybil 负债**：个体上限 + 全局计奖熔断 + 开闸前审计清退 + 冻结机制（§5.3/§6）；接受 v1 无设备指纹的残余风险。
4. **keyword 工具身份统一**（Phase 2）：从 gg_id 门槛改为 Supabase 登录门槛，同一 Google 账号 One Tap 一键，摩擦小，但要处理好既有 gg_id 用户的引导文案。
5. **账户删除/重注册**：ledger 按 UUID 保留（无 PII）；重注册重得注册奖为已知残余风险（§5.1）。
6. **产品端冻结**：产品 app 接入积分需先做规范解冻决策，本设计不触碰。
7. **实施计划切分**：本 spec 覆盖三期蓝图，但**每期单独出实施计划**；第一份计划严格只含 Phase 1 范围（0004 迁移 + 发放侧 + UI + 首跑上报埋点 + `/r` 路由）。
