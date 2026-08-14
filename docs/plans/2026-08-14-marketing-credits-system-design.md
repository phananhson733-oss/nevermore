# 营销站积分体系设计（Credits v1）

日期：2026-08-14
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
| **上线节奏** | **当前为测试/福利期：只发放、不扣费。消耗机制完整建好但用开关关闭，二期再开** |

现状要点（调研结论，2026-08-14，基于 origin/main）：

- 全仓库零支付设施：无支付 SDK、无 webhook、无积分/计费表。完全绿地。
- 营销站现有配额全部是 IP 维度窗口计数（`consume_public_tool_quota` RPC，service-role 专用，fail-closed）——本设计沿用同一模式。
- 营销站与产品 app 共用同一 Supabase 认证项目，会话 cookie 作用域为 gengrowth.ai 根域（One Tap 登录一次两边生效）→ 积分账户以 Supabase `user_id` 为主键，产品端将来零迁移接入。
- 工具真实成本（2026-08-10 实测拟合）：keyword 工具 DFS ≈ $0.088 p50/次（单次上限 $0.25）+ LLM ≈ 50k tokens；quick-wins 仅 LLM（小）；traffic-drop / 站点审计 / profile 刷新 $0 外部成本；profile 搜索 $0.002–0.013/次。
- Manus 机制基准（官方帮助中心）：注册 +1000；每日 300 重置式（免费用户月上限 1500 且只限最低档模式）；消耗顺序"先花会过期的"；充值积分永不过期；技术故障全额退；邀请双边各 500（第三方口径）。

## 1. 分期

### Phase 1 —— 福利期（本次实施）

只发不扣。目标：把账本、身份、发放三条闭环跑通，积累注册与留存，为二期开闸铺垫预期。

- 积分账本（表 + RPC + 服务层），含消耗/退款 RPC 的完整实现与测试（不接线到工具）
- 注册奖励 +100
- 每日签到 +20（福利期为**累加制**，累计封顶 600；见 §5.2）
- 邀请闭环：双边各 +50，被邀请人完成首次登录态工具运行才计奖
- UI：头部余额徽章、`/account/credits` 页（余额/签到/流水/邀请）、工具页"测试期限免"标注（预告正式价）
- 工具的现有准入/配额行为**零改动**（不加登录门槛、不扣积分）

### Phase 2 —— 开启消耗

- 打开 `CREDITS_MODE=live`：工具准入点接线扣费；余额不足弹窗；失败自动退款
- 每日签到从累加制切换为**重置制**（每日池，见 §5.2）
- keyword 工具与 Agents 统一为 Supabase 登录专享；quick-wins / traffic-drop 匿名保留每天 1–2 次 IP 试用
- 现有平台级熔断（$0.25/次、$5/天、4/h/目标域名）全部保留，作为积分之外的兜底

### Phase 3 —— Airwallex 充值

- PaymentIntent + 托管收银台链路（移植 oracle，修掉已知缺陷）
- 订单表 + webhook + confirm + cron 对账三保险
- USD + CNY

### 远期（不在本设计范围）

产品端 app 接同一账本。前置条件：解除 v0.4 规范对 billing/entitlement 的冻结（`authority/implementation-spec-v0.3/MVP-IMPLEMENTATION-SPEC.md` §100/§145、CLAUDE.md v0.4 范围声明）。

## 2. 架构总览

```
用户（Supabase 会话，One Tap）
   │
   ├── GET /api/credits/balance ──► 服务层 ensureAccount + touchDaily（懒发放）
   ├── GET /api/credits/ledger  ──► 流水分页
   ├── /r/[code] ──► 落 gg_ref cookie（30d）──► 首次登录时归因 referred_by
   │
工具 handler（Phase 2 起）
   ├── 准入点：登录校验 → touchDaily → consume(价格, runId)
   └── 失败路径：refund(runId)（幂等，只退一次）
   │
Airwallex（Phase 3）
   ├── POST /api/credits/orders → PaymentIntent → HPP 跳转
   ├── POST /api/credits/webhook（HMAC 验签）
   ├── POST /api/credits/orders/confirm（return_url 回来后）
   └── GET  /api/cron/reconcile-credit-orders（CRON_SECRET）
   │
Supabase（营销项目 public schema，service-role RPC，RLS deny-all）
   credit_accounts / credit_ledger / credit_purchase_orders / credit_webhook_events
```

身份：一切以 Supabase `user_id` 为准。服务端用现有 server client 读会话（`getServerAuthenticationStatus` 家族），不新增身份体系。GSC 授权（`gg_gsc` 封印 cookie）保持独立，只管数据访问，与积分无关。

## 3. 数据模型

营销站迁移目录 `apps/marketing/supabase/migrations/`，延续现有编号与"OWNER STEP 手动执行"惯例。

### 0004_credit_accounts.sql

```sql
create table public.credit_accounts (
  user_id            uuid primary key,          -- Supabase auth user id
  permanent_balance  integer not null default 0 check (permanent_balance >= 0),
  daily_balance      integer not null default 0 check (daily_balance >= 0),
  daily_granted_on   date,
  daily_accrued_total integer not null default 0,  -- 福利期累加计数，用于封顶
  referral_code      text not null unique,
  referred_by        uuid references public.credit_accounts(user_id),
  referral_rewarded_count integer not null default 0,
  first_tool_run_at  timestamptz,               -- 邀请奖励触发标记
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
```

### 0005_credit_ledger.sql

```sql
create table public.credit_ledger (
  id               bigint generated always as identity primary key,
  user_id          uuid not null,
  entry_type       text not null check (entry_type in
    ('signup_bonus','daily_grant','consume','refund',
     'referral_reward_inviter','referral_reward_invitee',
     'purchase','adjustment')),
  amount           integer not null,            -- 有符号总变动
  daily_delta      integer not null default 0,  -- 每日池变动（consume/refund 记录扣减拆分）
  permanent_delta  integer not null default 0,
  balance_daily_after     integer not null,
  balance_permanent_after integer not null,
  tool_slug        text,
  idempotency_key  text not null unique,        -- 幂等的唯一真源
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index credit_ledger_user_created_idx on public.credit_ledger (user_id, created_at desc);
```

关键纪律（吸取 oracle 教训）：

- **余额是单行快照 + append-only 流水**，不做全表求和（oracle 的性能债）。
- **幂等靠 `idempotency_key UNIQUE` 约束**，代码里的 `23505` 分支才有意义（oracle 依赖 23505 但约束根本没建，并发双发——本设计的 P0 修正）。
- 扣减是**单条原子 UPDATE**（`where` 带余额条件），先扣每日池后扣永久池，一条语句跨池凑数（oracle 不支持跨批次扣减的修正）。

幂等键约定：

| 事件 | 键 |
|---|---|
| 注册奖励 | `signup:{userId}` |
| 每日签到 | `daily:{userId}:{YYYY-MM-DD}` |
| 消耗 | `consume:{runId}` |
| 退款 | `refund:{runId}` |
| 邀请（被邀方） | `referral-invitee:{inviteeId}` |
| 邀请（邀请方） | `referral-inviter:{inviteeId}` |
| 充值 | `purchase:{packId}:{intentId}` |

### 0006_credit_purchases.sql（Phase 3 前落库即可）

```sql
create table public.credit_purchase_orders (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null,
  pack_id            text not null,
  credits            integer not null,
  amount_cents       integer not null,          -- 内部一律分
  currency           text not null check (currency in ('USD','CNY')),
  provider           text not null default 'airwallex',
  provider_intent_id text unique,
  status             text not null default 'pending' check
                     (status in ('pending','paid','failed','expired','refunded')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.credit_webhook_events (
  event_id    text primary key,
  received_at timestamptz not null default now()
);
```

RLS：四张表全部开 RLS 且**不建任何 anon/authenticated 策略**（与 `public_tool_rate_limits` 同纪律），一切访问走 service-role RPC / 服务端路由。

### RPC（SECURITY DEFINER，service-role 专用）

| RPC | 语义 |
|---|---|
| `credits_ensure_account(p_user_id, p_ref_code)` | 建户 + 注册奖 100 + 归因 referred_by（一次事务，幂等） |
| `credits_touch_daily(p_user_id, p_amount, p_mode, p_accrual_cap)` | 懒发放。welfare：累加进永久池，`daily_accrued_total` 封顶；live：每日池重置为 p_amount。当日已发直接返回 |
| `credits_consume(p_user_id, p_amount, p_tool, p_idem_key)` | 原子扣减（先每日后永久），返回新余额或 `insufficient` |
| `credits_refund(p_consume_key, p_refund_key)` | 按原扣减拆分反向回补（幂等）。每日池部分次日刷新自然作废 |
| `credits_reward_referral(p_invitee_id)` | 被邀方首次工具运行触发：双边各 +50，检查邀请方封顶，两条 ledger 幂等 |
| `credits_settle_purchase(p_order_id, p_intent_id)` | 订单置 paid + 发永久积分，幂等键兜底 |

所有 RPC 单事务完成"改余额 + 写流水"，两者不可分离。

## 4. 消耗与退款（Phase 2 接线）

- 准入点插在各工具 handler 现有配额闸（crawl-gate / gsc-gate）的同一层：登录校验 → `touchDaily` → `consume(价格, runId)`。
- 未登录 → 401 结构化错误（现有 `auth_required` 惯例）；余额不足 → 结构化 `insufficient_credits`（携带余额、价格），前端弹三选一（等明日签到 / 邀请 / 充值）。
- **运行失败自动全额退**：handler 的失败路径调 `refund(runId)`。实测 25% 的 keyword 运行死在爬虫阶段（$0 DFS 支出），不退等于抢钱。对齐 Manus"技术故障全额退"。
- 退款按**原扣减拆分**回补两个池：堵死"故意跑失败把每日积分洗成永久积分"的套利路径；每日池部分若已跨天，会在下次签到重置时自然作废（正确语义：每日积分 use-it-or-lose-it，退款不改变这一点）。
- keyword 两段式工具：stage 1 准入一次性收 25；任一 stage 失败退全款（`refund:{runId}` 幂等保证只退一次）。
- 积分库不可用：消耗类工具 fail-closed 503（对齐现有 `quota_unavailable`）；福利期与匿名路径不受影响。
- 部分成功即成功，不退（有产出就收费）；退款仅限运行以错误终态结束。

## 5. 获取侧机制

### 5.1 注册奖励

+100，`ensure_account` 内一次性发放。仅 Google 登录（One Tap / OAuth），天然抬高批量注册成本。

### 5.2 每日签到

- 触发：当天第一次带登录态的 `GET /api/credits/balance`（头部徽章加载即触发）——"登录即领"，无 cron。
- **福利期（welfare）**：+20 累加进永久池，`daily_accrued_total` 封顶 600（≈30 天量）。封顶后签到返回"已达福利上限"状态，UI 如实展示。
- **正式期（live）**：每日池重置为 20（不累积，Manus 语义）。刻意 < 25：免费用户每天能白嫖便宜工具，最贵的 keyword 工具必须邀请或充值——等效 Manus"每日积分只限 Lite 模式"的分层。
- 切换即改 `CREDITS_MODE` env，两种模式共用同一 RPC。

### 5.3 邀请

- 每账户固定 8 位小写 base32 邀请码（去易混淆字符），建户时生成，冲突重试。
- 链接 `gengrowth.ai/r/{code}`：302 到首页 + 落 `gg_ref` cookie（30 天，last-touch）。
- 归因：被邀请人首次登录（`ensure_account`）时读 cookie，校验码存在且非本人，写 `referred_by`。
- **计奖门槛：被邀请人完成首次登录态的成功工具运行**（`first_tool_run_at` 置位时触发 `reward_referral`）。福利期工具免费也适用——跑通任一工具即算。防纯注册刷量。
- 双边各 +50（永久池）；邀请方累计 20 次计奖封顶（`referral_rewarded_count`）。
- 防滥用：自邀阻断（同 user）；邀请双方 IP 相同仅记日志观察不硬拦（v1）；Google-only 登录 + 首次运行门槛是主防线。

### 5.4 失败退款

见 §4。福利期不扣费故无退款路径。

## 6. 定价常量（单一真源 + 防漂移测试）

`apps/marketing/src/lib/credits/credits-config.ts` 集中全部数值；UI 展示与后端逻辑都从这里取。移植 oracle 的价格一致性测试思路：任何展示层复制品都用测试 pin 回该常量。

零售锚定：**1 积分 ≈ $0.01**。

| 工具 | 真实成本/次 | 积分价（Phase 2 生效） |
|---|---|---|
| Keyword Opportunity Map | ~$0.10–0.13 | 25 |
| Agent 站点审计（SEO/Tech） | $0（算力） | 10 |
| SEO Quick Wins（含 AI 草稿） | ~$0.01–0.03 | 5 |
| Agent Profile 刷新 | 爬虫+LLM | 5 |
| Traffic Drop 诊断 | $0 | 3 |
| Agent Profile 搜索 | $0.002–0.013 | 2 |

| 获取项 | 数值 |
|---|---|
| 注册奖励 | 100 |
| 每日签到 | 20（福利期累计封顶 600） |
| 邀请（双边各） | 50；邀请方 20 次封顶 |

| 积分包（Phase 3） | USD | CNY |
|---|---|---|
| 500 | $4.99 | ¥35 |
| 1,100（+10%） | $9.99 | ¥69 |
| 2,400（+20%） | $19.99 | ¥139 |
| 6,500（+30%） | $49.99 | ¥349 |

毛利粗算：500 积分 $4.99，全部消耗在最贵工具 = 20 次 × $0.13 ≈ $2.6 COGS，毛利 ~48%；其余工具更高。
福利期单用户最大积分负债：100 + 600 + 20×50 = 1,700 ≈ 68 次 keyword 运行 ≈ $8.8 最坏 COGS——可接受的获客成本，且有全局 $5/天熔断兜底。

## 7. 充值链路（Phase 3，移植 oracle 并修坑）

移植来源：`/Users/wzb/Code/oracle`（主树，分支 fix/asteroid-ephemeris）。

| 移植项 | 来源 | 必须修的坑 |
|---|---|---|
| PaymentIntent 创建（金额用主单位非分） | `backend/src/services/airwallexService.ts` | — |
| HPP 跳转封装（CDN SDK，50 行） | `services/airwallexCheckout.ts` | 不依赖 sessionStorage；`return_url` 带订单号，服务端用 `merchant_order_id` 反查 |
| webhook HMAC 验签 | 同上 | **先比 length 再 `timingSafeEqual`**（原实现长度不等直接抛 RangeError） |
| webhook + confirm 双路径共用幂等键 | `backend/src/api/airwallex.ts` | **必须真的建 UNIQUE 约束**（原实现没建，23505 分支永不触发） |
| cron 对账兜底 | `subscriptionReconciler.ts` 模式 | 简化为扫 pending 订单 → 查 Airwallex intent 状态 → settle/expire |
| env `.trim()`、demo/production 双环境、7 项上线验证脚本 | `config/airwallex.ts`、`scripts/verify-airwallex-production.ts` | — |

env（名称沿用 oracle）：`AIRWALLEX_CLIENT_ID` / `AIRWALLEX_API_KEY` / `AIRWALLEX_WEBHOOK_SECRET` / `AIRWALLEX_ENVIRONMENT`。积分包走 PaymentIntent，**不需要** Dashboard price_id。
webhook raw body：Next.js route handler 用 `req.text()` 原文验签（营销站无 express，不存在中间件顺序问题，但测试要 pin 原文字节）。

## 8. UI 与文案

- 头部（登录态）：积分徽章（余额 + 今日签到状态），点击进 `/account/credits`。
- `/account/credits`：余额卡（福利期显示"测试期福利"说明）、签到状态、流水（Manus 式逐条：时间/事由/±数额/余额）、邀请卡（复制链接 + 已计奖次数）、积分包（Phase 3）。
- 工具页标注（福利期）："测试期限免 · 正式上线后 25 积分/次"——提前锚定预期，避免二期开闸被骂。
- 余额不足弹窗（Phase 2）：价格 vs 余额 + 三 CTA。
- i18n：en/zh 双语，沿用 message namespace + TS content module 惯例。文案不得暗示"积分=法币"或承诺兑换；条款页注明积分无现金价值、可调整规则。

## 9. 配置与开关

| env | 含义 |
|---|---|
| `MARKETING_CREDITS_ENABLED` | 总开关（关=现状，UI 与 API 全部隐藏） |
| `CREDITS_MODE` | `welfare`（只发不扣，签到累加）/ `live`（扣费开启，签到重置） |
| `AIRWALLEX_*` | Phase 3 支付凭证 |

数值常量不进 env（进 `credits-config.ts`，改数值走发版，可测试可回溯）。

## 10. 测试策略

- **单元（vitest，沿用现有模式）**：服务层准入/发放/退款/幂等分支；RPC 返回态的全部错误路径；credits-config 与 UI 展示的一致性测试。
- **迁移 SQL**：约束齐全性 review（UNIQUE / CHECK / RLS deny-all）；并发安全由"单语句 UPDATE + UNIQUE"构造保证，辅以针对性回归（同 runId 双 consume、双 refund、双 webhook 只生效一次）。
- **mock e2e**：登录 → 徽章出现 → 签到入账 → 流水展示 → 邀请链接归因；Phase 2 加"扣费 → 余额变化 → 不足弹窗"。
- **支付 e2e 边界**：只能测到 HPP 跳转前（oracle 同款结论）；上线前跑 7 项生产验证 + 真卡最小包冒烟 + 退款。
- 时序敏感用例不靠重跑（仓库既有纪律）。

## 11. 风险与开放问题

1. **Azure LLM 单价缺口**：仓库刻意不写 $/token；工具积分价已按余量定，不阻塞。二期开闸前从 `analysis_invocations` 实测校准一次。
2. **DFS 未拟合端点**：profile 搜索的 `competitors_domain` 价格是外推值；Phase 2 前用真实响应 `cost` 字段校准。
3. **福利期负债**：上限 1,700/人（§6）。若注册量暴涨，先降签到封顶（改常量发版）。
4. **keyword 工具身份统一**（Phase 2）：从 gg_id 门槛改为 Supabase 登录门槛，同一 Google 账号 One Tap 一键，摩擦小，但要处理好既有 gg_id 用户的引导文案。
5. **法务**：积分销售条款（无现金价值、不可转让、规则可调整）需在 Phase 3 前落 Terms 页。
6. **产品端冻结**：产品 app 接入积分需先做规范解冻决策，本设计不触碰。
