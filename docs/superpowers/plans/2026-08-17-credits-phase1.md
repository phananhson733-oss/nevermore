# 营销站积分体系 Phase 1（福利期）实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 gengrowth.ai 营销站上线「只发不扣」的积分福利期：注册送 100、每日签到 +20（累计封顶 600）、邀请双边各 +50，配套余额徽章、账户页与工具页限免标注；不改动任何工具的准入、配额或鉴权行为。

**Architecture:** 积分账本落在营销站自己的 Supabase `public` schema（新增手工执行的 migration `0004`），沿用现有 `consume_public_tool_quota` 的模式：表 RLS deny-all、所有写入经 `SECURITY DEFINER` + service-role 专用 RPC、余额是单行快照配 append-only 流水、幂等靠 `idempotency_key UNIQUE`。全部经济数额存在 `credit_settings` 单行表里由 RPC 自读，应用层不传金额。工具侧只在 5 个 handler 的 6 个成功返回点加一个**可选注入依赖**的调用，在 `after()` 里做「首次合格运行」上报——路由与既有测试零改动。

**Tech Stack:** Next.js 16 App Router + next-intl（en/zh）、Supabase（`@supabase/ssr` 会话 + service-role admin 客户端 / PostgREST RPC）、Tailwind v4、Vitest（新增 `marketing-sql` project 跑真 Postgres）、pnpm workspace。

**权威文档：** `docs/plans/2026-08-14-marketing-credits-system-design.md`（rev 5）。本计划严格只实现其 §1 Phase 1；任何扣费（consume/refund/charges，migration 0005）与充值（0006）都**不在**本计划范围。

---

## 关键前提（执行前必读）

1. **`node_modules` 不存在**：本 worktree 是 `signalframe-mvp-app` 的 git worktree，尚未安装依赖。Task 1 必须先装。
2. **`@/` 别名在 vitest 里只指向 `apps/web/src`**。营销站里任何需要被单测导入的模块，**必须用相对路径 + 显式 `.ts` 扩展名**互相引用（`@/` 只能出现在不被单测导入的文件里）。这是本仓最常见的踩坑点。
3. **营销站 migration 由 Owner 手工执行**。代码必须在表还不存在时优雅降级（503 + 稳定错误码），照抄 `apps/marketing/src/app/api/waitlist/route.ts:19` 的 `MISSING_STORE_CODES = new Set(["PGRST205", "42P01"])`。
4. **`pnpm lint` 禁 unused vars**（`^_` 豁免）、`pnpm typecheck` 必须过。仓库**没有 formatter**，不要引入 prettier。
5. 每个新建源文件都要带房规头注释：`// @input  -- …` / `// @output -- …` / `// @pos    -- …`（`_DIR.md` 那句可以省略，仓库里根本没有 `_DIR.md`）。
6. **`console.error("[module-name]", …)` 是本目录被接受的日志写法**，尽管有全局 no-console 规则。
7. 提交信息用 conventional commits，**不要**加 Co-Authored-By（仓库全局关了署名）。
8. 每个 Task 结束都要提交。**绝不 `git add -A`**——本工作区可能躺着别人的在建代码，只 add 本任务明确列出的文件。

---

## 文件结构

### 新建

| 文件 | 职责 |
|---|---|
| `apps/marketing/supabase/migrations/0004_credits_ledger.sql` | 4 张表 + 1 个 append-only trigger + 5 个函数 + 授权。唯一的 SQL 权威 |
| `apps/marketing/src/lib/credits/credits-config.ts` | 接线层/UI 的数值真源，兼 `credit_settings` 种子值记录 |
| `apps/marketing/src/lib/credits/credits-config.test.ts` | 数值与 migration DEFAULT 的一致性 pin |
| `apps/marketing/src/lib/credits/credits-store.ts` | RPC 封装：`ensureAccount` / `touchDaily` / `rewardReferral` / `readLedger`，返回判别式联合，fail-closed |
| `apps/marketing/src/lib/credits/credits-store.test.ts` | store 的全部分支（含表缺失 503、RPC 抛错） |
| `apps/marketing/src/lib/credits/referral-cookie.ts` | `gg_ref` 的读/写/清与邀请码格式校验 |
| `apps/marketing/src/lib/credits/referral-cookie.test.ts` | cookie 属性与码校验 |
| `apps/marketing/src/lib/credits/report-first-run.ts` | 永不抛错的首跑上报器 + `after()` 调度 |
| `apps/marketing/src/lib/credits/report-first-run.test.ts` | 吞异常、未登录跳过、调度语义 |
| `apps/marketing/src/lib/credits/sql-test-harness.ts` | 建角色 + 重建 schema + 按序应用营销站 migration（仅测试用） |
| `apps/marketing/src/lib/credits/credits-sql.integration.test.ts` | 真 Postgres：三个 RPC 的语义 + 并发 + 流水重放对账 |
| `apps/marketing/src/lib/auth/server-auth-user.ts` | 经 `auth.getUser()` 校验后返回 uuid 的三态联合 |
| `apps/marketing/src/lib/auth/server-auth-user.test.ts` | 三态映射 |
| `apps/marketing/src/app/api/credits/balance/route.ts` | GET 余额（ensure + touch），no-store，按用户限频 |
| `apps/marketing/src/app/api/credits/balance/route.test.ts` | 401/404/503/200 分支 |
| `apps/marketing/src/app/api/credits/ledger/route.ts` | GET 流水，游标 `(created_at, id)` |
| `apps/marketing/src/app/api/credits/ledger/route.test.ts` | 分页与错误分支 |
| `apps/marketing/src/app/r/[code]/route.ts` | 邀请落地：落 cookie + 302 |
| `apps/marketing/src/app/r/[code]/route.test.ts` | 合法/非法码、cookie 属性 |
| `apps/marketing/src/components/credits/credits-badge.tsx` | 头部余额徽章（client） |
| `apps/marketing/src/components/credits/credits-badge.test.tsx` | 渲染三态 |
| `apps/marketing/src/components/credits/credits-account-client.tsx` | 账户页主体（client） |
| `apps/marketing/src/components/credits/credits-account-client.test.tsx` | 渲染与文案 |
| `apps/marketing/src/app/[locale]/account/credits/page.tsx` | 账户页 server 壳（noIndex、force-dynamic） |
| `apps/marketing/src/app/[locale]/account/credits/page.test.ts` | metadata 与 en/zh 渲染 |

### 修改

| 文件 | 改动 |
|---|---|
| `vitest.config.ts`（根） | 新增 `marketing-sql` project；`integration` project 排除 `apps/marketing/**` |
| `package.json`（根） | 新增 `test:sql:marketing` script |
| `apps/marketing/package.json` | devDependencies 加 `pg` / `@types/pg`（`catalog:`） |
| `apps/marketing/src/lib/auth/server-auth-status.ts` | 改为委托 `server-auth-user.ts`，对外契约一字不变 |
| `apps/marketing/src/proxy.ts` | 排除分支加 `/r/`；`reservedRootPaths` 加 `r`、`account` |
| `apps/marketing/src/lib/tools/quick-wins-handler.ts` | 接口加可选 `reportFirstRun?`；195 行成功点调用；DEFAULT 里注册 |
| `apps/marketing/src/lib/tools/traffic-drop-handler.ts` | 同上，成功点 324 行（**不是** 291 行那个 200+error） |
| `apps/marketing/src/lib/tools/keyword-opportunity-handler.ts` | 同上，成功点 906 行（stage 2；stage 1 的 520 行不算） |
| `apps/marketing/src/lib/agents/audit-handler.ts` | 同上，成功点 328 行（**无 try/catch，上报器绝不能抛**） |
| `apps/marketing/src/lib/agents/profile-refresh-handler.ts` | 同上，**两个**成功点 355（缓存命中）与 421（新跑） |
| `apps/marketing/src/components/layout/header.tsx` | 右侧插槽加徽章 |
| `apps/marketing/src/app/[locale]/layout.tsx` | `shellMessages` 加 `credits: messages.credits` |
| `apps/marketing/src/i18n/messages/en.json` / `zh.json` | 新增 `credits` 顶层命名空间（两边必须同步，否则 `messages.test.ts` 红） |
| `apps/marketing/src/components/tools/connected-tool-content.ts` | `ConnectedToolContent` 加 `creditPrice: number`，EN/ZH 各补 |
| `apps/marketing/src/components/tools/connected-tool-page.tsx` | 渲染限免标注 |
| `apps/marketing/src/components/agents/agent-page.tsx` | Agent 页限免标注 |

---

## Task 1: 环境引导与基线确认

**Files:** 无（只跑命令）

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/wzb/Code/nevermore/credits-design
pnpm install --frozen-lockfile
```
Expected: 安装完成，无 lockfile 冲突。

- [ ] **Step 2: 确认基线是绿的（这是后面判断"是我改红的吗"的唯一依据）**

```bash
pnpm typecheck 2>&1 | tail -5
pnpm lint 2>&1 | tail -5
pnpm test apps/marketing 2>&1 | tail -15
```
Expected: 三条都通过。**如果基线本来就红，先把失败清单记下来再继续**，不要试图修与积分无关的既有失败。

- [ ] **Step 3: 建一次性测试库**

```bash
createdb signalframe_ci_credits 2>/dev/null || echo "already exists"
psql -d signalframe_ci_credits -tAc "select current_database(), version();"
```
Expected: 打印库名与 PostgreSQL 16.x。

- [ ] **Step 4: 不提交（本任务无文件改动）**

---

## Task 2: 数值真源 `credits-config.ts`

**Files:**
- Create: `apps/marketing/src/lib/credits/credits-config.ts`
- Test: `apps/marketing/src/lib/credits/credits-config.test.ts`

- [ ] **Step 1: 先写失败测试**

`credits-config.test.ts`：

```ts
// @input  -- the credits configuration module
// @output -- assertions pinning every number a human might change by hand
// @pos    -- guards the config against silent drift from the migration defaults

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CREDITS_SETTINGS_SEED,
  CREDIT_TOOL_PRICES,
  QUALIFYING_TOOLS,
  REFERRAL_CODE_PATTERN,
} from "./credits-config.ts";

const migrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/0004_credits_ledger.sql",
    import.meta.url,
  ),
);

describe("credits-config", () => {
  it("prices every qualifying tool and nothing else", () => {
    expect(Object.keys(CREDIT_TOOL_PRICES).sort()).toEqual(
      [...QUALIFYING_TOOLS, "profile-search"].sort(),
    );
    expect(CREDIT_TOOL_PRICES["keyword-opportunities"]).toBe(25);
    expect(CREDIT_TOOL_PRICES["agent-audit"]).toBe(10);
    expect(CREDIT_TOOL_PRICES["quick-wins"]).toBe(5);
    expect(CREDIT_TOOL_PRICES["profile-refresh"]).toBe(5);
    expect(CREDIT_TOOL_PRICES["traffic-drop"]).toBe(3);
    expect(CREDIT_TOOL_PRICES["profile-search"]).toBe(2);
  });

  it("excludes profile-search from the qualifying run list", () => {
    expect(QUALIFYING_TOOLS).not.toContain("profile-search");
  });

  /**
   * The migration is the runtime authority; this file only records the seed.
   * A number changed in one place and not the other is the exact failure this
   * pins — the app would advertise a grant the database never makes.
   */
  it("matches every DEFAULT in the 0004 migration", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const defaults: ReadonlyArray<readonly [string, number]> = [
      ["daily_amount", CREDITS_SETTINGS_SEED.dailyAmount],
      ["welfare_accrual_cap", CREDITS_SETTINGS_SEED.welfareAccrualCap],
      ["referral_daily_cap", CREDITS_SETTINGS_SEED.referralDailyCap],
      ["signup_bonus", CREDITS_SETTINGS_SEED.signupBonus],
      ["referral_reward", CREDITS_SETTINGS_SEED.referralReward],
      ["referral_inviter_cap", CREDITS_SETTINGS_SEED.referralInviterCap],
    ];
    for (const [column, expected] of defaults) {
      const match = new RegExp(
        `${column}\\s+integer\\s+not null\\s+default\\s+(\\d+)`,
      ).exec(sql);
      expect(match, `${column} default not found in migration`).not.toBeNull();
      expect(Number(match?.[1]), `${column} drifted`).toBe(expected);
    }
  });

  it("only accepts referral codes the generator can produce", () => {
    expect(REFERRAL_CODE_PATTERN.test("ab3kd9xz")).toBe(true);
    expect(REFERRAL_CODE_PATTERN.test("AB3KD9XZ")).toBe(false);
    expect(REFERRAL_CODE_PATTERN.test("short")).toBe(false);
    expect(REFERRAL_CODE_PATTERN.test("a".repeat(17))).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test apps/marketing/src/lib/credits/credits-config
```
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 写实现**

`credits-config.ts`：

```ts
// @input  -- nothing; this module is a constant table
// @output -- the wiring-layer and UI source of truth for every credits number
// @pos    -- records the seed values that credit_settings holds at runtime

/**
 * Runtime authority for these numbers is `public.credit_settings`, read by the
 * RPCs themselves. This file exists so the UI can render a price without a
 * round trip, and so a human editing one of them is forced by
 * `credits-config.test.ts` to edit the migration too.
 */
export const CREDITS_SETTINGS_SEED = {
  mode: "welfare",
  dailyAmount: 20,
  welfareAccrualCap: 600,
  referralDailyCap: 200,
  signupBonus: 100,
  referralReward: 50,
  referralInviterCap: 20,
} as const;

/** Slugs recorded on ledger rows and used to price a run in Phase 2. */
export type CreditToolSlug =
  | "keyword-opportunities"
  | "agent-audit"
  | "quick-wins"
  | "profile-refresh"
  | "traffic-drop"
  | "profile-search";

/**
 * Phase 2 prices, shown today only as the "free during testing" notice.
 * Anchored at 1 credit ~ $0.01 against measured per-run cost.
 */
export const CREDIT_TOOL_PRICES: Readonly<Record<CreditToolSlug, number>> = {
  "keyword-opportunities": 25,
  "agent-audit": 10,
  "quick-wins": 5,
  "profile-refresh": 5,
  "traffic-drop": 3,
  "profile-search": 2,
};

/**
 * A referral is earned by finishing one of these, not by signing up. Each
 * requires either a connected Search Console property or a real site to crawl,
 * which is the friction that makes farming cost something. profile-search is
 * one DataForSEO call and is deliberately excluded.
 */
export const QUALIFYING_TOOLS = [
  "keyword-opportunities",
  "agent-audit",
  "quick-wins",
  "profile-refresh",
  "traffic-drop",
] as const satisfies ReadonlyArray<CreditToolSlug>;

export type QualifyingTool = (typeof QUALIFYING_TOOLS)[number];

/** Bound, not spec: the generator emits 8 chars from a 32-symbol alphabet. */
export const REFERRAL_CODE_PATTERN = /^[a-z0-9]{8,16}$/;

/** Balance is a write (lazy daily grant), so the badge cannot poll freely. */
export const BALANCE_RATE_LIMIT = {
  max: 30,
  windowSeconds: 3_600,
} as const;

/** Ledger page size for /account/credits. */
export const LEDGER_PAGE_SIZE = 25;

/** Referral cookie lifetime, last-touch. */
export const REFERRAL_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const REFERRAL_COOKIE_NAME = "gg_ref";

/** Kill switch. Absent or anything but "true" hides the whole feature. */
export function creditsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.MARKETING_CREDITS_ENABLED === "true";
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test apps/marketing/src/lib/credits/credits-config
```
Expected: 「matches every DEFAULT in the 0004 migration」这条会 FAIL（migration 还没写），**其余全 PASS**。这是预期的——Task 3 建完 migration 后它自然转绿。

- [ ] **Step 5: 提交**

```bash
git add apps/marketing/src/lib/credits/credits-config.ts apps/marketing/src/lib/credits/credits-config.test.ts
git commit -m "feat(marketing): add credits configuration source of truth"
```

---

## Task 3: Migration `0004_credits_ledger.sql`

**Files:**
- Create: `apps/marketing/supabase/migrations/0004_credits_ledger.sql`

本任务只写 SQL，正确性由 Task 4 的真 Postgres 测试证明。写完先用 `psql` 手工验一次能不能建起来。

- [ ] **Step 1: 写 migration**

完整文件内容：

```sql
-- Credit accounts, an append-only credit ledger, and the singleton settings row
-- that is the runtime authority for every economic number.
--
-- The welfare phase only ever grants: a signup bonus, one grant per UTC day,
-- and a two-sided referral reward. Nothing is charged. But a ledger that can
-- only add is still a ledger, and the failure that matters is double-granting
-- under concurrency: two tabs loading the header badge in the same
-- millisecond, two tool runs finishing together, twenty invitees qualifying at
-- once against a twenty-reward cap. Every one of those is decided inside a
-- single statement or behind a row lock, because the application-level
-- check-then-write has exactly that race and the race is the whole problem.
--
-- Amounts live in credit_settings rather than in application config so that a
-- rolling deploy cannot have two instances granting different numbers on the
-- same day. apps/marketing/src/lib/credits/credits-config.ts records the seed
-- values and a unit test pins it to the defaults below.
--
-- OWNER STEP: run this against the marketing Supabase project before deploying
-- with MARKETING_CREDITS_ENABLED=true. The credits endpoints answer 503 while
-- these tables are missing, so deploying the code first hides the badge and the
-- account page rather than promising a grant it cannot record.

create table if not exists public.credit_accounts (
  user_id                 uuid        primary key,
  status                  text        not null default 'active'
                                      check (status in ('active', 'frozen')),
  permanent_balance       integer     not null default 0 check (permanent_balance >= 0),
  daily_balance           integer     not null default 0 check (daily_balance >= 0),
  daily_granted_on        date,
  daily_accrued_total     integer     not null default 0 check (daily_accrued_total >= 0),
  referral_code           text        not null unique
                                      check (referral_code ~ '^[a-z0-9]{8,16}$'),
  referred_by             uuid        references public.credit_accounts (user_id),
  referral_rewarded_count integer     not null default 0 check (referral_rewarded_count >= 0),
  first_tool_run_at       timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- Self-referral is the cheapest attack there is; refuse it in the schema so
  -- no future caller can reintroduce it.
  check (referred_by is null or referred_by <> user_id)
);

create index if not exists credit_accounts_referred_by_idx
  on public.credit_accounts (referred_by);

create table if not exists public.credit_ledger (
  id                      bigint generated always as identity primary key,
  user_id                 uuid        not null
                                      references public.credit_accounts (user_id),
  entry_type              text        not null check (entry_type in (
                            'signup_bonus', 'daily_grant', 'daily_expire',
                            'consume', 'refund',
                            'referral_reward_inviter', 'referral_reward_invitee',
                            'purchase', 'adjustment')),
  amount                  integer     not null,
  daily_delta             integer     not null default 0,
  permanent_delta         integer     not null default 0,
  balance_daily_after     integer     not null check (balance_daily_after >= 0),
  balance_permanent_after integer     not null check (balance_permanent_after >= 0),
  tool_slug               text        check (char_length(tool_slug) <= 64),
  -- The single reason a replayed webhook, a double-clicked button and a
  -- retried background job cannot grant twice.
  idempotency_key         text        not null unique
                                      check (char_length(idempotency_key) <= 128),
  metadata                jsonb       not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  check (amount = daily_delta + permanent_delta),
  -- Sign and pool are bound to the entry type, so a miswritten RPC cannot
  -- record an economically impossible row.
  check (case entry_type
           when 'signup_bonus'            then amount > 0 and daily_delta = 0
           when 'daily_grant'             then amount > 0
           when 'daily_expire'            then amount < 0 and permanent_delta = 0
           when 'consume'                 then amount < 0
           when 'refund'                  then amount >= 0
           when 'referral_reward_inviter' then amount > 0 and daily_delta = 0
           when 'referral_reward_invitee' then amount > 0 and daily_delta = 0
           when 'purchase'                then amount > 0 and daily_delta = 0
           else true
         end)
);

-- Paging is (created_at desc, id desc): created_at alone repeats and drops rows
-- when two entries share a timestamp, which two grants in one transaction do.
create index if not exists credit_ledger_user_page_idx
  on public.credit_ledger (user_id, created_at desc, id desc);

create table if not exists public.credit_settings (
  id                   smallint    primary key check (id = 1),
  mode                 text        not null default 'welfare'
                                   check (mode in ('welfare', 'live')),
  consumption_paused   boolean     not null default false,
  daily_amount         integer     not null default 20 check (daily_amount >= 0),
  welfare_accrual_cap  integer     not null default 600 check (welfare_accrual_cap >= 0),
  referral_daily_cap   integer     not null default 200 check (referral_daily_cap >= 0),
  signup_bonus         integer     not null default 100 check (signup_bonus >= 0),
  referral_reward      integer     not null default 50 check (referral_reward >= 0),
  referral_inviter_cap integer     not null default 20 check (referral_inviter_cap >= 0),
  updated_at           timestamptz not null default now()
);

-- Every RPC fails closed when this row is absent rather than falling back to a
-- compiled-in default, so the seed is part of the migration, not of a runbook.
insert into public.credit_settings (id) values (1) on conflict (id) do nothing;

-- The global referral brake. A per-instance counter cannot bound a fleet, so
-- the claim is one atomic UPDATE against this row.
create table if not exists public.credit_daily_counters (
  day                date    primary key,
  rewarded_referrals integer not null default 0 check (rewarded_referrals >= 0)
);

/**
 * The ledger is append-only, including for the service role.
 *
 * Without this, "the balance and the ledger disagree" is one stray UPDATE away
 * and there is no way to tell after the fact which of the two lied.
 */
create or replace function public.credit_ledger_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'credit_ledger is append-only (attempted %)', tg_op;
end;
$$;

drop trigger if exists credit_ledger_immutable_row on public.credit_ledger;
create trigger credit_ledger_immutable_row
  before update or delete on public.credit_ledger
  for each row execute function public.credit_ledger_immutable();

drop trigger if exists credit_ledger_immutable_truncate on public.credit_ledger;
create trigger credit_ledger_immutable_truncate
  before truncate on public.credit_ledger
  for each statement execute function public.credit_ledger_immutable();

-- Service-role only. No anon or authenticated policy is granted, so a leaked
-- publishable key cannot read a balance, forge a grant, or enumerate invites.
alter table public.credit_accounts       enable row level security;
alter table public.credit_ledger         enable row level security;
alter table public.credit_settings       enable row level security;
alter table public.credit_daily_counters enable row level security;

/**
 * A referral code is an identifier, not a secret: the worst case for a guessed
 * code is that a stranger gets credited for a signup. random() is therefore
 * sufficient, and avoids making the migration depend on pgcrypto.
 *
 * The alphabet drops l, o, 0 and 1 so a code read aloud or retyped survives.
 */
create or replace function public.credits_generate_referral_code()
returns text
language plpgsql
as $$
declare
  v_alphabet constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  v_code     text := '';
  v_i        integer;
begin
  for v_i in 1..8 loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * 32)::integer, 1);
  end loop;
  return v_code;
end;
$$;

/**
 * Move a balance and record why, in one statement pair that cannot be split.
 *
 * Internal: revoked from every role including service_role. SECURITY DEFINER
 * callers run as the owner, so the public RPCs below can still reach it while
 * PostgREST cannot.
 */
create or replace function public.credits__append_entry(
  p_user_id         uuid,
  p_entry_type      text,
  p_daily_delta     integer,
  p_permanent_delta integer,
  p_tool_slug       text,
  p_idempotency_key text,
  p_metadata        jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_daily     integer;
  v_permanent integer;
begin
  -- Enforced here rather than in a CHECK because CHECK rejects the
  -- non-immutable size functions, and the RPCs are the only writer.
  if octet_length(coalesce(p_metadata, '{}'::jsonb)::text) > 4096 then
    raise exception 'credit_ledger metadata exceeds 4096 bytes';
  end if;

  update public.credit_accounts as a
     set daily_balance     = a.daily_balance + p_daily_delta,
         permanent_balance = a.permanent_balance + p_permanent_delta,
         updated_at        = now()
   where a.user_id = p_user_id
  returning a.daily_balance, a.permanent_balance
       into v_daily, v_permanent;

  if not found then
    raise exception 'credit account % does not exist', p_user_id;
  end if;

  insert into public.credit_ledger (
    user_id, entry_type, amount, daily_delta, permanent_delta,
    balance_daily_after, balance_permanent_after,
    tool_slug, idempotency_key, metadata
  ) values (
    p_user_id, p_entry_type, p_daily_delta + p_permanent_delta,
    p_daily_delta, p_permanent_delta, v_daily, v_permanent,
    p_tool_slug, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

/**
 * Create the account on first sight, pay the signup bonus once, and attribute
 * a referral if the visitor arrived with a code.
 *
 * Attribution is one-shot: an account that already has a referrer, or that has
 * already qualified a run, cannot be rebound. Otherwise a user could re-enter
 * through a friend's link the day before their first run and move the reward.
 */
create or replace function public.credits_ensure_account(
  p_user_id       uuid,
  p_referral_code text default null
)
returns table (
  user_id                 uuid,
  status                  text,
  daily_balance           integer,
  permanent_balance       integer,
  daily_granted_on        date,
  daily_accrued_total     integer,
  referral_code           text,
  referred_by             uuid,
  referral_rewarded_count integer,
  first_tool_run_at       timestamptz,
  created                 boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_created boolean := false;
  v_code    text;
  v_attempt integer;
  v_inviter uuid;
  v_signup  integer;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if not exists (
    select 1 from public.credit_accounts as a where a.user_id = p_user_id
  ) then
    -- The retry loop is for referral_code collisions only. A collision that
    -- escaped would cost the user their signup bonus.
    for v_attempt in 1..8 loop
      v_code := public.credits_generate_referral_code();
      begin
        insert into public.credit_accounts (user_id, referral_code)
        values (p_user_id, v_code);
        v_created := true;
        exit;
      exception when unique_violation then
        -- Another transaction created THIS account first: not our race to win.
        if exists (
          select 1 from public.credit_accounts as a where a.user_id = p_user_id
        ) then
          exit;
        end if;
      end;
    end loop;

    if v_created then
      select s.signup_bonus into v_signup
        from public.credit_settings as s where s.id = 1;
      if v_signup is null then
        raise exception 'credit_settings row is missing';
      end if;
      if v_signup > 0 then
        perform public.credits__append_entry(
          p_user_id, 'signup_bonus', 0, v_signup, null,
          'signup:' || p_user_id::text, '{}'::jsonb);
      end if;
    end if;
  end if;

  if p_referral_code is not null then
    select a.user_id into v_inviter
      from public.credit_accounts as a
     where a.referral_code = lower(p_referral_code)
       and a.user_id <> p_user_id;

    if v_inviter is not null then
      update public.credit_accounts as a
         set referred_by = v_inviter,
             updated_at  = now()
       where a.user_id = p_user_id
         and a.referred_by is null
         and a.first_tool_run_at is null;
    end if;
  end if;

  return query
    select a.user_id, a.status, a.daily_balance, a.permanent_balance,
           a.daily_granted_on, a.daily_accrued_total, a.referral_code,
           a.referred_by, a.referral_rewarded_count, a.first_tool_run_at,
           v_created
      from public.credit_accounts as a
     where a.user_id = p_user_id;
end;
$$;

/**
 * Grant today's credits if today has not been granted yet. Lazy, so there is
 * no cron and no clock skew between a scheduler and a request.
 *
 * welfare: the grant accrues into the permanent pool up to a lifetime cap.
 * live:    yesterday's unspent daily balance expires and is replaced, and both
 *          halves are written to the ledger so the account still replays.
 *
 * Zero rows returned means the account does not exist yet.
 */
create or replace function public.credits_touch_daily(p_user_id uuid)
returns table (
  mode                text,
  granted             integer,
  daily_balance       integer,
  permanent_balance   integer,
  daily_accrued_total integer,
  daily_amount        integer,
  welfare_accrual_cap integer,
  daily_granted_on    date
)
language plpgsql
security definer
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_today   date := current_date;
  v_mode    text;
  v_amount  integer;
  v_cap     integer;
  v_account public.credit_accounts%rowtype;
  v_grant   integer := 0;
  v_expire  integer := 0;
  v_key     text := to_char(v_today, 'YYYY-MM-DD');
begin
  select s.mode, s.daily_amount, s.welfare_accrual_cap
    into v_mode, v_amount, v_cap
    from public.credit_settings as s where s.id = 1;
  if v_mode is null then
    raise exception 'credit_settings row is missing';
  end if;

  -- The lock is what makes "granted today?" a decision rather than a guess.
  select * into v_account
    from public.credit_accounts as a
   where a.user_id = p_user_id
     for update;
  if not found then
    return;
  end if;

  if v_account.status = 'active'
     and v_account.daily_granted_on is distinct from v_today then
    if v_mode = 'welfare' then
      v_grant := least(v_amount, greatest(v_cap - v_account.daily_accrued_total, 0));
      if v_grant > 0 then
        update public.credit_accounts as a
           set daily_accrued_total = a.daily_accrued_total + v_grant
         where a.user_id = p_user_id;
        perform public.credits__append_entry(
          p_user_id, 'daily_grant', 0, v_grant, null,
          'daily:' || p_user_id::text || ':' || v_key,
          jsonb_build_object('mode', 'welfare'));
      end if;
    else
      v_expire := v_account.daily_balance;
      if v_expire > 0 then
        perform public.credits__append_entry(
          p_user_id, 'daily_expire', -v_expire, 0, null,
          'daily-expire:' || p_user_id::text || ':' || v_key, '{}'::jsonb);
      end if;
      v_grant := v_amount;
      if v_grant > 0 then
        perform public.credits__append_entry(
          p_user_id, 'daily_grant', v_grant, 0, null,
          'daily:' || p_user_id::text || ':' || v_key,
          jsonb_build_object('mode', 'live'));
      end if;
    end if;

    -- Stamped even when the cap left nothing to grant, so a capped account
    -- stops re-deciding on every badge poll.
    update public.credit_accounts as a
       set daily_granted_on = v_today,
           updated_at       = now()
     where a.user_id = p_user_id;
  end if;

  return query
    select v_mode, v_grant, a.daily_balance, a.permanent_balance,
           a.daily_accrued_total, v_amount, v_cap, a.daily_granted_on
      from public.credit_accounts as a
     where a.user_id = p_user_id;
end;
$$;

/**
 * Pay the two-sided referral reward the first time an invitee finishes a
 * qualifying tool run.
 *
 * Order is load-bearing. The global brake is claimed BEFORE first_tool_run_at
 * is stamped, so a refused claim leaves the account able to qualify tomorrow.
 * Stamping first would silently and permanently void a legitimate invitee's
 * reward on a busy day.
 *
 * Reciprocal pairs qualifying simultaneously can deadlock on the two account
 * rows. That is acceptable: Postgres aborts one, the whole transaction rolls
 * back including the stamp, and the next successful run retries.
 */
create or replace function public.credits_reward_referral(
  p_invitee_id uuid,
  p_tool_slug  text default null
)
returns table (rewarded boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_today        date := current_date;
  v_reward       integer;
  v_daily_cap    integer;
  v_inviter_cap  integer;
  v_account      public.credit_accounts%rowtype;
  v_claimed      integer;
  v_inviter      uuid;
  v_inviter_rows integer;
begin
  select s.referral_reward, s.referral_daily_cap, s.referral_inviter_cap
    into v_reward, v_daily_cap, v_inviter_cap
    from public.credit_settings as s where s.id = 1;
  if v_reward is null then
    raise exception 'credit_settings row is missing';
  end if;

  select * into v_account
    from public.credit_accounts as a
   where a.user_id = p_invitee_id
     for update;
  if not found then
    return query select false, 'no_account'::text;
    return;
  end if;
  if v_account.first_tool_run_at is not null then
    return query select false, 'already_marked'::text;
    return;
  end if;
  if v_account.status <> 'active' then
    return query select false, 'frozen'::text;
    return;
  end if;

  if v_account.referred_by is null then
    -- No referrer: stamp anyway. It closes attribution (a later link cannot
    -- rebind the account) and nothing is at stake to lose.
    update public.credit_accounts as a
       set first_tool_run_at = now(),
           updated_at        = now()
     where a.user_id = p_invitee_id;
    return query select false, 'no_referrer'::text;
    return;
  end if;
  v_inviter := v_account.referred_by;

  if v_daily_cap < 1 then
    return query select false, 'global_cap'::text;
    return;
  end if;

  insert into public.credit_daily_counters as c (day, rewarded_referrals)
  values (v_today, 1)
      on conflict (day) do update
     set rewarded_referrals = c.rewarded_referrals + 1
   where c.rewarded_referrals < v_daily_cap
  returning c.rewarded_referrals into v_claimed;

  if v_claimed is null then
    return query select false, 'global_cap'::text;
    return;
  end if;

  update public.credit_accounts as a
     set first_tool_run_at = now(),
         updated_at        = now()
   where a.user_id = p_invitee_id;

  perform public.credits__append_entry(
    p_invitee_id, 'referral_reward_invitee', 0, v_reward, p_tool_slug,
    'referral-invitee:' || p_invitee_id::text,
    jsonb_build_object('inviter', v_inviter));

  -- Atomic claim against the inviter's lifetime cap: a plain read-then-write
  -- lets twenty concurrent invitees push a 20-cap to 21.
  update public.credit_accounts as a
     set referral_rewarded_count = a.referral_rewarded_count + 1,
         updated_at              = now()
   where a.user_id = v_inviter
     and a.status = 'active'
     and a.referral_rewarded_count < v_inviter_cap;
  get diagnostics v_inviter_rows = row_count;

  if v_inviter_rows > 0 then
    perform public.credits__append_entry(
      v_inviter, 'referral_reward_inviter', 0, v_reward, p_tool_slug,
      'referral-inviter:' || p_invitee_id::text,
      jsonb_build_object('invitee', p_invitee_id));
  end if;

  return query select true,
    case when v_inviter_rows > 0 then 'rewarded_both' else 'rewarded_invitee_only' end::text;
end;
$$;

revoke all on function public.credits_generate_referral_code()
  from public, anon, authenticated, service_role;
revoke all on function public.credits__append_entry(uuid, text, integer, integer, text, text, jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.credits_ensure_account(uuid, text) from public, anon, authenticated;
grant execute on function public.credits_ensure_account(uuid, text) to service_role;

revoke all on function public.credits_touch_daily(uuid) from public, anon, authenticated;
grant execute on function public.credits_touch_daily(uuid) to service_role;

revoke all on function public.credits_reward_referral(uuid, text) from public, anon, authenticated;
grant execute on function public.credits_reward_referral(uuid, text) to service_role;
```

- [ ] **Step 2: 手工验证 SQL 能建起来**

```bash
cd /Users/wzb/Code/nevermore/credits-design
psql -d signalframe_ci_credits -v ON_ERROR_STOP=1 <<'SQL'
drop schema if exists public cascade;
create schema public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
SQL
psql -d signalframe_ci_credits -v ON_ERROR_STOP=1 -f apps/marketing/supabase/migrations/0004_credits_ledger.sql
```
Expected: 无 ERROR。若 `set timezone = 'UTC'` 或 `on conflict ... where` 报语法错，就地修正后重跑（这是本任务存在的意义）。

- [ ] **Step 3: 冒烟一次基本路径**

```bash
psql -d signalframe_ci_credits -v ON_ERROR_STOP=1 <<'SQL'
select * from public.credits_ensure_account('11111111-1111-4111-8111-111111111111');
select * from public.credits_touch_daily('11111111-1111-4111-8111-111111111111');
select entry_type, amount, balance_permanent_after from public.credit_ledger order by id;
SQL
```
Expected: 账户建出、`created=true`；touch 后 `granted=20`；流水两条：`signup_bonus +100`（余额 100）、`daily_grant +20`（余额 120）。

- [ ] **Step 4: config 一致性测试转绿**

```bash
pnpm test apps/marketing/src/lib/credits/credits-config
```
Expected: 全 PASS（Task 2 遗留的那条现在有 migration 可读了）。

- [ ] **Step 5: 提交**

```bash
git add apps/marketing/supabase/migrations/0004_credits_ledger.sql
git commit -m "feat(marketing): add credits ledger migration"
```

---

## Task 4: 真 Postgres 测试装置与 SQL 并发回归

**Files:**
- Modify: `vitest.config.ts`（根）、`package.json`（根）、`apps/marketing/package.json`
- Create: `apps/marketing/src/lib/credits/sql-test-harness.ts`
- Test: `apps/marketing/src/lib/credits/credits-sql.integration.test.ts`

营销站此前没有任何 SQL 被测过。本任务补上这条缺失的管道——spec §11 要求的并发证明全靠它。

- [ ] **Step 1: 加 pg 依赖**

编辑 `apps/marketing/package.json`，在 `devDependencies` 里加（保持字母序）：

```json
    "@types/pg": "catalog:",
    "pg": "catalog:",
```

然后：

```bash
pnpm install
```

- [ ] **Step 2: 加 vitest project**

编辑根 `vitest.config.ts`：

(a) 在 `integration` project 的 **`exclude`** 里加 `"apps/marketing/**"`——**`include` 保持不动**：

```ts
          exclude: [
            "**/node_modules/**",
            "**/.next/**",
            // apps/marketing persists to a DIFFERENT Postgres (its own Supabase
            // project, public schema) than DATABASE_URL, and this setup file
            // applies the 53 product migrations. Marketing SQL gets its own
            // project below rather than the wrong database. Excluded here
            // rather than by narrowing `include` to apps/web, which would
            // silently drop the apps/worker integration files from every
            // project at once.
            "apps/marketing/**",
          ],
```

**为什么不能改 `include`**：把 `"apps/**/*.integration.test.ts"` 收窄成 `"apps/web/**"` 会让 `apps/worker` 的 12 个集成测试不属于任何 project——unit 排除了 `*.integration.test.ts`，marketing-sql 只收 marketing。它们不会报错，只会再也不跑。改完必须验证：

```bash
npx vitest list --project integration --filesOnly | grep -c "apps/worker"     # 必须是 12
npx vitest list --project integration --filesOnly | grep -c "apps/marketing"  # 必须是 0
npx vitest list --project marketing-sql --filesOnly | grep -c "apps/marketing" # 必须是 1
```

(b) 在 `projects` 数组末尾追加：

```ts
      {
        test: {
          name: "marketing-sql",
          include: ["apps/marketing/**/*.integration.test.ts"],
          exclude: ["**/node_modules/**", "**/.next/**"],
          environment: "node",
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // One disposable database, shared DDL. Files must not race.
          fileParallelism: false,
        },
      },
```

(c) 根 `package.json` 的 scripts 加一行（放在 `test:integration` 后）：

```json
    "test:sql:marketing": "vitest run --project marketing-sql",
```

- [ ] **Step 3: 写测试装置**

`apps/marketing/src/lib/credits/sql-test-harness.ts`：

```ts
// @input  -- MARKETING_TEST_DATABASE_URL pointing at a disposable loopback database
// @output -- a pg Client connected to a schema rebuilt from the marketing migrations
// @pos    -- the only place marketing SQL is executed outside production

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

const migrationsDir = fileURLToPath(
  new URL("../../../supabase/migrations", import.meta.url),
);

/**
 * Same rule the product integration suite enforces: a test that can reach a
 * non-loopback host, or a database whose name is not obviously disposable, is
 * one typo away from truncating something real.
 */
export function assertDisposable(url: string): void {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    throw new Error(`refusing non-loopback test database host: ${host}`);
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!/^signalframe_(ci|e2e|codex)/.test(database)) {
    throw new Error(
      `refusing test database ${database}: name must start with signalframe_ci/e2e/codex`,
    );
  }
}

/** Supabase ships these roles; a bare Postgres does not, and the grants need them. */
const ROLE_SETUP = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;`;

export async function connectFreshMarketingSchema(): Promise<Client> {
  const url = process.env.MARKETING_TEST_DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("MARKETING_TEST_DATABASE_URL is required");
  }
  assertDisposable(url);

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("drop schema if exists public cascade");
  await client.query("create schema public");
  await client.query(ROLE_SETUP);

  for (const file of readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort()) {
    await client.query(readFileSync(`${migrationsDir}/${file}`, "utf8"));
  }
  return client;
}

/** Opens a second connection so a test can prove two transactions race. */
export async function openConcurrentClient(): Promise<Client> {
  const url = process.env.MARKETING_TEST_DATABASE_URL;
  if (url === undefined) throw new Error("MARKETING_TEST_DATABASE_URL is required");
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}
```

- [ ] **Step 4: 写 SQL 回归测试（先跑，预期失败于「未设置环境变量」）**

`apps/marketing/src/lib/credits/credits-sql.integration.test.ts`：

```ts
// @input  -- a disposable Postgres with the marketing migrations applied
// @output -- proof that the grant RPCs are correct under concurrency
// @pos    -- the only test that runs marketing SQL

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  connectFreshMarketingSchema,
  openConcurrentClient,
} from "./sql-test-harness.ts";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

let db: Client;

beforeAll(async () => {
  db = await connectFreshMarketingSchema();
});

afterAll(async () => {
  await db?.end();
});

beforeEach(async () => {
  // The ledger trigger blocks DELETE, so the reset drops and rebuilds instead.
  await db.query("alter table public.credit_ledger disable trigger credit_ledger_immutable_row");
  await db.query("delete from public.credit_ledger");
  await db.query("alter table public.credit_ledger enable trigger credit_ledger_immutable_row");
  await db.query("delete from public.credit_accounts");
  await db.query("delete from public.credit_daily_counters");
  await db.query("update public.credit_settings set mode = 'welfare', referral_daily_cap = 200 where id = 1");
});

async function ensure(client: Client, userId: string, code?: string) {
  const { rows } = await client.query(
    "select * from public.credits_ensure_account($1, $2)",
    [userId, code ?? null],
  );
  return rows[0];
}

describe("credits_ensure_account", () => {
  it("creates the account and pays the signup bonus exactly once", async () => {
    const first = await ensure(db, USER_A);
    expect(first.created).toBe(true);
    expect(first.permanent_balance).toBe(100);

    const second = await ensure(db, USER_A);
    expect(second.created).toBe(false);
    expect(second.permanent_balance).toBe(100);

    const { rows } = await db.query(
      "select count(*)::int as n from public.credit_ledger where entry_type = 'signup_bonus'",
    );
    expect(rows[0].n).toBe(1);
  });

  it("does not pay twice when two requests create the same account at once", async () => {
    const other = await openConcurrentClient();
    try {
      await Promise.all([ensure(db, USER_A), ensure(other, USER_A)]);
    } finally {
      await other.end();
    }
    const { rows } = await db.query(
      "select permanent_balance from public.credit_accounts where user_id = $1",
      [USER_A],
    );
    expect(rows[0].permanent_balance).toBe(100);
  });

  it("attributes a referral once and refuses to rebind it", async () => {
    const inviter = await ensure(db, USER_A);
    await ensure(db, USER_B, inviter.referral_code);
    const { rows } = await db.query(
      "select referred_by from public.credit_accounts where user_id = $1",
      [USER_B],
    );
    expect(rows[0].referred_by).toBe(USER_A);

    // A second, different code must not move the attribution.
    const third = "33333333-3333-4333-8333-333333333333";
    const other = await ensure(db, third);
    await ensure(db, USER_B, other.referral_code);
    const after = await db.query(
      "select referred_by from public.credit_accounts where user_id = $1",
      [USER_B],
    );
    expect(after.rows[0].referred_by).toBe(USER_A);
  });

  it("refuses self-referral", async () => {
    const account = await ensure(db, USER_A);
    await ensure(db, USER_A, account.referral_code);
    const { rows } = await db.query(
      "select referred_by from public.credit_accounts where user_id = $1",
      [USER_A],
    );
    expect(rows[0].referred_by).toBeNull();
  });
});

describe("credits_touch_daily", () => {
  it("grants once per day in welfare mode and accrues to the permanent pool", async () => {
    await ensure(db, USER_A);
    const first = await db.query("select * from public.credits_touch_daily($1)", [USER_A]);
    expect(first.rows[0].granted).toBe(20);
    expect(first.rows[0].permanent_balance).toBe(120);

    const second = await db.query("select * from public.credits_touch_daily($1)", [USER_A]);
    expect(second.rows[0].granted).toBe(0);
    expect(second.rows[0].permanent_balance).toBe(120);
  });

  it("grants at most once when two badge polls arrive together", async () => {
    await ensure(db, USER_A);
    const other = await openConcurrentClient();
    try {
      await Promise.all([
        db.query("select * from public.credits_touch_daily($1)", [USER_A]),
        other.query("select * from public.credits_touch_daily($1)", [USER_A]),
      ]);
    } finally {
      await other.end();
    }
    const { rows } = await db.query(
      "select count(*)::int as n from public.credit_ledger where entry_type = 'daily_grant'",
    );
    expect(rows[0].n).toBe(1);
  });

  it("stops granting at the welfare accrual cap", async () => {
    await ensure(db, USER_A);
    await db.query(
      "update public.credit_accounts set daily_accrued_total = 590 where user_id = $1",
      [USER_A],
    );
    const capped = await db.query("select * from public.credits_touch_daily($1)", [USER_A]);
    expect(capped.rows[0].granted).toBe(10);

    await db.query(
      "update public.credit_accounts set daily_granted_on = null where user_id = $1",
      [USER_A],
    );
    const exhausted = await db.query("select * from public.credits_touch_daily($1)", [USER_A]);
    expect(exhausted.rows[0].granted).toBe(0);
  });

  it("expires and replaces the daily pool in live mode, and both halves are on the ledger", async () => {
    await ensure(db, USER_A);
    await db.query("update public.credit_settings set mode = 'live' where id = 1");
    await db.query("select * from public.credits_touch_daily($1)", [USER_A]);
    await db.query(
      "update public.credit_accounts set daily_granted_on = null, daily_balance = 7 where user_id = $1",
      [USER_A],
    );
    const next = await db.query("select * from public.credits_touch_daily($1)", [USER_A]);
    expect(next.rows[0].daily_balance).toBe(20);

    const { rows } = await db.query(
      "select entry_type, amount from public.credit_ledger where entry_type in ('daily_expire','daily_grant') order by id",
    );
    expect(rows.map((r) => `${r.entry_type}:${r.amount}`)).toEqual([
      "daily_grant:20",
      "daily_expire:-7",
      "daily_grant:20",
    ]);
  });

  it("returns no rows for an account that does not exist", async () => {
    const { rows } = await db.query("select * from public.credits_touch_daily($1)", [USER_A]);
    expect(rows).toHaveLength(0);
  });
});

describe("credits_reward_referral", () => {
  async function invitee(code: string, id: string) {
    await ensure(db, id, code);
    return id;
  }

  it("pays both sides once and never again", async () => {
    const inviter = await ensure(db, USER_A);
    await invitee(inviter.referral_code, USER_B);

    const first = await db.query("select * from public.credits_reward_referral($1, $2)", [USER_B, "quick-wins"]);
    expect(first.rows[0]).toMatchObject({ rewarded: true, reason: "rewarded_both" });

    const second = await db.query("select * from public.credits_reward_referral($1, $2)", [USER_B, "quick-wins"]);
    expect(second.rows[0]).toMatchObject({ rewarded: false, reason: "already_marked" });

    const balances = await db.query(
      "select user_id, permanent_balance from public.credit_accounts order by user_id",
    );
    expect(balances.rows).toEqual([
      { user_id: USER_A, permanent_balance: 150 },
      { user_id: USER_B, permanent_balance: 150 },
    ]);
  });

  it("stamps the run but pays nothing when there is no referrer", async () => {
    await ensure(db, USER_A);
    const result = await db.query("select * from public.credits_reward_referral($1, $2)", [USER_A, "agent-audit"]);
    expect(result.rows[0]).toMatchObject({ rewarded: false, reason: "no_referrer" });
    const { rows } = await db.query(
      "select first_tool_run_at, permanent_balance from public.credit_accounts where user_id = $1",
      [USER_A],
    );
    expect(rows[0].first_tool_run_at).not.toBeNull();
    expect(rows[0].permanent_balance).toBe(100);
  });

  it("does NOT stamp the run when the global cap refuses the claim", async () => {
    await db.query("update public.credit_settings set referral_daily_cap = 0 where id = 1");
    const inviter = await ensure(db, USER_A);
    await invitee(inviter.referral_code, USER_B);

    const refused = await db.query("select * from public.credits_reward_referral($1, $2)", [USER_B, "quick-wins"]);
    expect(refused.rows[0]).toMatchObject({ rewarded: false, reason: "global_cap" });

    // The whole point: tomorrow it can still qualify.
    const { rows } = await db.query(
      "select first_tool_run_at from public.credit_accounts where user_id = $1",
      [USER_B],
    );
    expect(rows[0].first_tool_run_at).toBeNull();

    await db.query("update public.credit_settings set referral_daily_cap = 200 where id = 1");
    const retried = await db.query("select * from public.credits_reward_referral($1, $2)", [USER_B, "quick-wins"]);
    expect(retried.rows[0].rewarded).toBe(true);
  });

  it("never exceeds the inviter cap under concurrent qualification", async () => {
    const inviter = await ensure(db, USER_A);
    await db.query("update public.credit_settings set referral_inviter_cap = 3 where id = 1");

    const invitees = Array.from({ length: 8 }, (_unused, index) =>
      `44444444-4444-4444-8444-4444444444${String(index).padStart(2, "0")}`);
    for (const id of invitees) await ensure(db, id, inviter.referral_code);

    const clients = await Promise.all(invitees.map(() => openConcurrentClient()));
    try {
      await Promise.all(
        clients.map((client, index) =>
          client.query("select * from public.credits_reward_referral($1, $2)", [invitees[index], "agent-audit"])),
      );
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }

    const { rows } = await db.query(
      "select referral_rewarded_count, permanent_balance from public.credit_accounts where user_id = $1",
      [USER_A],
    );
    expect(rows[0].referral_rewarded_count).toBe(3);
    expect(rows[0].permanent_balance).toBe(100 + 3 * 50);
  });

  it("never exceeds the global daily cap under concurrent qualification", async () => {
    const inviter = await ensure(db, USER_A);
    await db.query("update public.credit_settings set referral_daily_cap = 2, referral_inviter_cap = 100 where id = 1");

    const invitees = Array.from({ length: 6 }, (_unused, index) =>
      `55555555-5555-4555-8555-5555555555${String(index).padStart(2, "0")}`);
    for (const id of invitees) await ensure(db, id, inviter.referral_code);

    const clients = await Promise.all(invitees.map(() => openConcurrentClient()));
    try {
      await Promise.all(
        clients.map((client, index) =>
          client.query("select * from public.credits_reward_referral($1, $2)", [invitees[index], "agent-audit"])),
      );
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }

    const { rows } = await db.query("select rewarded_referrals from public.credit_daily_counters");
    expect(rows[0].rewarded_referrals).toBe(2);
  });
});

describe("ledger integrity", () => {
  it("refuses UPDATE and DELETE", async () => {
    await ensure(db, USER_A);
    await expect(db.query("update public.credit_ledger set amount = 1")).rejects.toThrow(/append-only/);
    await expect(db.query("delete from public.credit_ledger")).rejects.toThrow(/append-only/);
  });

  it("refuses a duplicate idempotency key", async () => {
    await ensure(db, USER_A);
    await expect(
      db.query(
        `insert into public.credit_ledger
           (user_id, entry_type, amount, permanent_delta, balance_daily_after,
            balance_permanent_after, idempotency_key)
         values ($1, 'signup_bonus', 100, 100, 0, 100, $2)`,
        [USER_A, `signup:${USER_A}`],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("replays to the stored balance for every account", async () => {
    const inviter = await ensure(db, USER_A);
    await ensure(db, USER_B, inviter.referral_code);
    await db.query("select * from public.credits_touch_daily($1)", [USER_A]);
    await db.query("select * from public.credits_touch_daily($1)", [USER_B]);
    await db.query("select * from public.credits_reward_referral($1, $2)", [USER_B, "quick-wins"]);

    const { rows } = await db.query(`
      select a.user_id,
             a.permanent_balance,
             a.daily_balance,
             coalesce(sum(l.permanent_delta), 0)::int as replayed_permanent,
             coalesce(sum(l.daily_delta), 0)::int     as replayed_daily
        from public.credit_accounts a
        left join public.credit_ledger l on l.user_id = a.user_id
       group by a.user_id, a.permanent_balance, a.daily_balance`);

    for (const row of rows) {
      expect(row.replayed_permanent).toBe(row.permanent_balance);
      expect(row.replayed_daily).toBe(row.daily_balance);
    }
  });

  it("fails closed when the settings row is missing", async () => {
    await ensure(db, USER_A);
    await db.query("delete from public.credit_settings");
    try {
      await expect(db.query("select * from public.credits_touch_daily($1)", [USER_A]))
        .rejects.toThrow(/credit_settings row is missing/);
    } finally {
      await db.query("insert into public.credit_settings (id) values (1) on conflict (id) do nothing");
    }
  });
});
```

- [ ] **Step 5: 跑测试，确认全绿**

```bash
MARKETING_TEST_DATABASE_URL="postgres://$(whoami)@127.0.0.1:5432/signalframe_ci_credits" pnpm test:sql:marketing
```
Expected: 全部 PASS。**默认假设是「SQL 有真 bug，回去改 SQL，不要改测试的期望值」。**

唯一的例外（不要误改 SQL）：如果失败是 `duplicate key value violates unique constraint "credit_ledger_idempotency_key_key"` 且发生在同一个 UTC 日内伪造二次发放的用例里，那是**测试装置**的问题——每日幂等键含日期（`daily:{userId}:{YYYY-MM-DD}`），同日二次发放本就该被拒。正确做法是把「跨日」场景改成预置 `daily_granted_on = current_date - 1` 再 touch 一次，**绝不能**去松动幂等键：它是这张财务表上唯一的防重放约束。

- [ ] **Step 6: 确认单测 project 没有把它捡走**

```bash
pnpm test apps/marketing 2>&1 | grep -c "credits-sql" || echo "correctly excluded"
```
Expected: `correctly excluded`（unit project 排除 `*.integration.test.ts`）。

- [ ] **Step 7: 提交**

```bash
git add vitest.config.ts package.json apps/marketing/package.json pnpm-lock.yaml \
        apps/marketing/src/lib/credits/sql-test-harness.ts \
        apps/marketing/src/lib/credits/credits-sql.integration.test.ts
git commit -m "test(marketing): run marketing SQL against a real Postgres"
```

---

## Task 5: 可鉴权的用户身份 `server-auth-user.ts`

**Files:**
- Create: `apps/marketing/src/lib/auth/server-auth-user.ts`
- Test: `apps/marketing/src/lib/auth/server-auth-user.test.ts`
- Modify: `apps/marketing/src/lib/auth/server-auth-status.ts`

`getServerAuthenticationStatus()` 刻意丢掉了 user id（因为 `/api/auth/session` 不能吐身份）。积分需要 uuid，所以把「拿到并校验用户」下沉一层，旧函数改为委托——**对外契约一字不改**，它的既有测试必须原样通过。

- [ ] **Step 1: 先读现状**

```bash
cat apps/marketing/src/lib/auth/server-auth-status.ts
cat apps/marketing/src/lib/auth/server-auth-status.test.ts
```
把 `isMissingSessionError` 的判定逻辑与三态语义看清楚：**只有** auth-js 的 `AuthSessionMissingError` + `status === 400` 算「未登录」，其它一切错误和抛异常都算 `unavailable`（fail closed）。新模块必须保持同一判据。

- [ ] **Step 2: 写失败测试**

`server-auth-user.test.ts`：

```ts
// @input  -- a mocked Supabase server client
// @output -- assertions that the verified uuid never collapses an outage into a sign-out
// @pos    -- guards the identity boundary the credits ledger keys on

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("../supabase/server.ts", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

describe("getServerAuthenticatedUser", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
  });

  it("returns the verified uuid", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
      error: null,
    });
    const { getServerAuthenticatedUser } = await import("./server-auth-user.ts");
    await expect(getServerAuthenticatedUser()).resolves.toEqual({
      status: "authenticated",
      userId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("reports unauthenticated only for a missing session", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthSessionMissingError", status: 400 },
    });
    const { getServerAuthenticatedUser } = await import("./server-auth-user.ts");
    await expect(getServerAuthenticatedUser()).resolves.toEqual({ status: "unauthenticated" });
  });

  /**
   * The distinction that matters: a 503 from the auth service is not a
   * signed-out visitor. Collapsing it would silently stop granting credits and
   * look like nobody visited.
   */
  it("reports unavailable for any other error", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthRetryableFetchError", status: 503 },
    });
    const { getServerAuthenticatedUser } = await import("./server-auth-user.ts");
    await expect(getServerAuthenticatedUser()).resolves.toEqual({ status: "unavailable" });
  });

  it("reports unavailable when the client throws", async () => {
    mocks.getUser.mockRejectedValue(new Error("boom"));
    const { getServerAuthenticatedUser } = await import("./server-auth-user.ts");
    await expect(getServerAuthenticatedUser()).resolves.toEqual({ status: "unavailable" });
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm test apps/marketing/src/lib/auth/server-auth-user
```
Expected: FAIL — 模块不存在。

- [ ] **Step 4: 实现 + 让旧函数委托**

新建 `server-auth-user.ts`：把 `server-auth-status.ts` 里的 `isMissingSessionError` 与 `getUser()` 调用整段搬过来，导出：

```ts
export type ServerAuthenticatedUser =
  | { readonly status: "authenticated"; readonly userId: string }
  | { readonly status: "unauthenticated" }
  | { readonly status: "unavailable" };

export async function getServerAuthenticatedUser(): Promise<ServerAuthenticatedUser>
```

改写 `server-auth-status.ts`，只保留一层映射（并保留原有的头注释与「为什么不吐身份」的说明，追加一句说明身份现在由 `server-auth-user.ts` 提供）：

```ts
export async function getServerAuthenticationStatus(): Promise<ServerAuthenticationStatus> {
  return (await getServerAuthenticatedUser()).status;
}
```

`ServerAuthenticationStatus` 类型与所有导出名保持不变。

- [ ] **Step 5: 跑测试**

```bash
pnpm test apps/marketing/src/lib/auth
```
Expected: 新测试 PASS，**`server-auth-status.test.ts` 原样全绿**（这是"没改契约"的证据）。

- [ ] **Step 6: 提交**

```bash
git add apps/marketing/src/lib/auth/server-auth-user.ts \
        apps/marketing/src/lib/auth/server-auth-user.test.ts \
        apps/marketing/src/lib/auth/server-auth-status.ts
git commit -m "refactor(marketing): expose the verified Supabase user id to server code"
```

---

## Task 6: 积分仓储 `credits-store.ts`

**Files:**
- Create: `apps/marketing/src/lib/credits/credits-store.ts`
- Test: `apps/marketing/src/lib/credits/credits-store.test.ts`

照抄 `shared-rate-limit.ts` 的形状：`XxxDependencies` 接口 + `DEFAULT_XXX_DEPENDENCIES` + 尾参默认注入；返回判别式联合；表缺失与 RPC 异常都收敛成 `unavailable`，**理由留在内部不外泄**。

- [ ] **Step 1: 写失败测试**

`credits-store.test.ts` 覆盖：

1. `ensureAccount` 正常路径返回 `{kind:"ok", account:{…}}`，字段从 snake_case 映射成 camelCase。
2. RPC 返回数组（PostgREST 的 `returns table` 行为）时正确取 `[0]`。
3. RPC 返回空数组时 → `{kind:"missing"}`（账户不存在，仅 `touchDaily` 有此态）。
4. `error.code === "PGRST205"` 与 `"42P01"` → `{kind:"unavailable", reason:"store_missing"}`。
5. 其它 error → `{kind:"unavailable", reason:<message>}`。
6. 客户端工厂抛错（缺环境变量）→ `{kind:"unavailable"}`，**不得把异常冒泡**。
7. `rewardReferral` 把 `{rewarded, reason}` 原样透出。
8. `readLedger` 按 `(created_at desc, id desc)` 请求，并把 `limit+1` 的探测行折成 `nextCursor`。

测试用注入的假 `callRpc` / `selectLedger`，**不要** mock `@supabase/supabase-js`。

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test apps/marketing/src/lib/credits/credits-store
```
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 写实现**

`credits-store.ts` 要点：

- 头注释三行 + 一段说明「为什么 unavailable 与 missing 是两个态」。
- 导出类型：
  ```ts
  export interface CreditAccountSnapshot {
    readonly userId: string;
    readonly status: "active" | "frozen";
    readonly dailyBalance: number;
    readonly permanentBalance: number;
    readonly totalBalance: number;
    readonly dailyGrantedOn: string | null;
    readonly dailyAccruedTotal: number;
    readonly referralCode: string;
    readonly referredBy: string | null;
    readonly referralRewardedCount: number;
    readonly firstToolRunAt: string | null;
    readonly created: boolean;
  }
  export type CreditsResult<T> =
    | { readonly kind: "ok"; readonly value: T }
    | { readonly kind: "missing" }
    | { readonly kind: "unavailable"; readonly reason: string };
  ```
- `MISSING_STORE_CODES = new Set(["PGRST205", "42P01"])`，与 waitlist 路由同源。
- `unwrapRow(data)`：`Array.isArray(data) ? data[0] : data`，无行返回 `null`。
- 每个导出函数签名尾部带 `dependencies: CreditsStoreDependencies = DEFAULT_CREDITS_STORE_DEPENDENCIES`。
- **admin 客户端必须在函数内惰性构造**（照 `shared-rate-limit.ts` 的 `callQuotaViaSupabase` 写法），绝不能在模块顶层 `createAdminSupabaseClient()`。这个模块会经 `report-first-run.ts` 被 5 个工具 handler 的 `DEFAULT_*` 传递性导入——顶层构造一旦因缺环境变量抛错，五条工具路由会一起 500。
- `console.error("[credits-store] …", reason)` 记录 unavailable 的真实原因，返回值里的 reason 供路由日志用、**不进 HTTP 响应体**。
- 导出四个函数：`ensureAccount(userId, referralCode)`、`touchDaily(userId)`、`rewardReferral(userId, toolSlug)`、`readLedger(userId, {limit, cursor})`。

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test apps/marketing/src/lib/credits/credits-store
pnpm typecheck 2>&1 | tail -3
```
Expected: PASS + typecheck 通过。

- [ ] **Step 5: 提交**

```bash
git add apps/marketing/src/lib/credits/credits-store.ts apps/marketing/src/lib/credits/credits-store.test.ts
git commit -m "feat(marketing): add the credits store"
```

---

## Task 7: 邀请 cookie 与 `/r/[code]` 落地路由

**Files:**
- Create: `apps/marketing/src/lib/credits/referral-cookie.ts` + `.test.ts`
- Create: `apps/marketing/src/app/r/[code]/route.ts` + `route.test.ts`
- Modify: `apps/marketing/src/proxy.ts`

**关键坑：** 不改 `proxy.ts`，`/r/abc12345` 会被 next-intl 改写成 `/en/r/abc12345` 然后 404。

- [ ] **Step 1: 写 cookie 模块的失败测试**

断言：`REFERRAL_COOKIE_NAME === "gg_ref"`；`referralCookieAttributes()` 返回 `{httpOnly:true, sameSite:"lax", path:"/", maxAge:2592000}` 且 **不含 `domain`**；`secure` 随 `NODE_ENV`；`normalizeReferralCode` 对大写做 lower、对非法格式返回 `null`。

在测试里写清 host-only 的理由注释（引 `sealed-cookie.ts` 的立场）。

- [ ] **Step 2: 跑测试确认失败，然后实现 `referral-cookie.ts`**

```bash
pnpm test apps/marketing/src/lib/credits/referral-cookie
```

- [ ] **Step 3: 写 `/r/[code]` 路由的失败测试**

照 `app/go/[code]/route.ts` 的结构写测试：合法码 → 302 到 `/` 且 `set-cookie` 含 `gg_ref=<code>`；非法码 → 仍 302 到 `/` 但**不**下发 cookie；`params` 支持 Promise 形态。

- [ ] **Step 4: 实现路由**

```ts
// @input  -- GET /r/{code} from a shared referral link
// @output -- a 302 to the home page, with the referral code remembered
// @pos    -- the only entry point that writes gg_ref

import { NextResponse } from "next/server";

import {
  REFERRAL_COOKIE_NAME,
  normalizeReferralCode,
  referralCookieAttributes,
} from "../../../lib/credits/referral-cookie.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ code?: string }> | { code?: string } },
): Promise<Response> {
  const { code } = await Promise.resolve(context.params);
  const response = NextResponse.redirect(new URL("/", request.url), 302);

  const normalized = normalizeReferralCode(code);
  // An unknown or malformed code is a dead link, not an error page: send the
  // visitor to the site and simply remember nothing.
  if (normalized !== null) {
    response.cookies.set(REFERRAL_COOKIE_NAME, normalized, referralCookieAttributes());
  }
  return response;
}
```

- [ ] **Step 5: 改 `proxy.ts`**

(a) 排除分支加一行（在 `/go` 那几行之后）：

```ts
    pathname === "/r" ||
    pathname.startsWith("/r/") ||
```

并在该 `if` 上方的注释里补一句：`/r/{code}` 是邀请落地，只发 cookie 再 302，没有 locale 概念。

(b) `reservedRootPaths` 里按字母序插入 `"account"` 和 `"r"`。

- [ ] **Step 6: 补 proxy 测试**

在 `apps/marketing/src/proxy.test.ts` 加两条：`/r/abc12345` 不被 next-intl 改写（直接 `NextResponse.next()`）；`/account` 不被短链兜底吞掉。

- [ ] **Step 7: 跑全套**

```bash
pnpm test apps/marketing/src/lib/credits/referral-cookie apps/marketing/src/app/r apps/marketing/src/proxy
```
Expected: 全 PASS。

- [ ] **Step 8: 提交**

```bash
git add apps/marketing/src/lib/credits/referral-cookie.ts apps/marketing/src/lib/credits/referral-cookie.test.ts \
        "apps/marketing/src/app/r/[code]/route.ts" "apps/marketing/src/app/r/[code]/route.test.ts" \
        apps/marketing/src/proxy.ts apps/marketing/src/proxy.test.ts
git commit -m "feat(marketing): land referral links and remember the code"
```

---

## Task 8: `/api/credits/balance` 与 `/api/credits/ledger`

**Files:**
- Create: `apps/marketing/src/app/api/credits/balance/route.ts` + `route.test.ts`
- Create: `apps/marketing/src/app/api/credits/ledger/route.ts` + `route.test.ts`

**注意：** 这两个路由必须用**相对路径** import（不能用 `@/`），否则它们的测试无法运行。

- [ ] **Step 1: 写 balance 路由的失败测试**

分支矩阵（每条一个用例）：

| 情况 | 响应 |
|---|---|
| `MARKETING_CREDITS_ENABLED` 未开 | 404 `{error:{code:"credits_disabled"}}` |
| 未登录 | 401 `{error:{code:"auth_required"}}` |
| 鉴权服务不可用 | 503 `{error:{code:"auth_unavailable"}}` |
| 表未建（PGRST205） | 503 `{error:{code:"credits_unavailable"}}` |
| 限频超出 | 429 `{error:{code:"rate_limited"}}`，带 `Retry-After` |
| 正常 | 200，`data.balance / data.mode / data.dailyGrant / data.referral` |

并断言所有响应都带 `Cache-Control: no-store, private`（余额是私有数据且这个 GET 会写库）。

- [ ] **Step 2: 实现 balance 路由**

顺序：flag → 鉴权（`getServerAuthenticatedUser`）→ 按用户键限频（`consumePublicToolQuota("credits-balance:user:" + userId, BALANCE_RATE_LIMIT.max, BALANCE_RATE_LIMIT.windowSeconds)`）→ 读 `gg_ref` cookie → `ensureAccount(userId, refCode)` → 归因成功后**删掉 cookie** → `touchDaily(userId)` → 组装响应。

响应体：

```jsonc
{ "data": {
    "balance": { "permanent": 120, "daily": 0, "total": 120 },
    "mode": "welfare",
    "dailyGrant": { "grantedToday": true, "amount": 20, "welfareRemaining": 480 },
    "referral": { "code": "ab3kd9xz", "rewardedCount": 0, "cap": 20 } } }
```

限频 `unavailable` 时**不要**因此拒绝请求（限频存储挂了不该让徽章消失）——记日志后放行；这与 crawl-gate 的 fail-closed 是有意的不同，在注释里写明理由（这里没有外部成本可被滥用，只有一次 upsert）。

- [ ] **Step 3: 写 ledger 路由的失败测试**

断言：未登录 401；`limit` 超过 `LEDGER_PAGE_SIZE` 被夹住；返回 `{data:{entries:[…], nextCursor:"<createdAt>|<id>"|null}}`；游标格式非法 → 400；表缺失 → 503。

- [ ] **Step 4: 实现 ledger 路由**

响应与游标钉死（不要临场发挥）：

```jsonc
{ "data": {
    "entries": [
      { "id": "12", "type": "daily_grant", "amount": 20,
        "balanceAfter": 120, "toolSlug": null, "createdAt": "2026-08-17T00:12:03.114Z" }
    ],
    "nextCursor": "2026-08-17T00:12:03.114Z|12" } }
```

- `nextCursor` = `` `${createdAt}|${id}` ``，解析时按最后一个 `|` 切分（ISO 时间串里不含 `|`）；任一半缺失或 `id` 非数字 → 400 `invalid_cursor`。
- 查询用 `.order("created_at", {ascending:false}).order("id", {ascending:false}).limit(pageSize + 1)`，多取的那一行只用来判断有没有下一页，不返回。
- `balanceAfter` = `balance_daily_after + balance_permanent_after`（用户看到的是一个总额，不是两个池）。

- [ ] **Step 5: 跑测试 + typecheck**

```bash
pnpm test apps/marketing/src/app/api/credits
pnpm typecheck 2>&1 | tail -3
```

- [ ] **Step 6: 提交**

```bash
git add apps/marketing/src/app/api/credits
git commit -m "feat(marketing): serve the credits balance and ledger"
```

---

## Task 9: 首跑上报器 `report-first-run.ts`

**Files:**
- Create: `apps/marketing/src/lib/credits/report-first-run.ts` + `.test.ts`

这个模块被 5 个工具 handler 调用，其中 `audit-handler.ts:328` 的成功返回**不在 try/catch 里**——它一抛错就是 500，把一次成功的审计变成失败。所以「永不抛错」是硬约束，不是风格偏好。

- [ ] **Step 1: 写失败测试**

`report-first-run.test.ts` 必须覆盖：

1. **上报器同步返回，不返回 promise**（调用点不 await，否则会在 `gate.release()` 的 finally 之前多占 in-flight 槽位，扩大 `scan_in_progress` 409 的窗口）。
2. 调度器抛错时**吞掉**——`expect(() => reportFirstToolRun("quick-wins")).not.toThrow()`。
3. 内部任务里 `getServerAuthenticatedUser` 返回 `unauthenticated` / `unavailable` 时**不调用** `rewardReferral`。
4. 返回 `authenticated` 时用正确的 userId 与 toolSlug 调 `rewardReferral`。
5. `rewardReferral` reject 时被吞掉且写了一行 `console.error("[credits]"…)`。
6. 未配置 `MARKETING_CREDITS_ENABLED` 时直接短路，连身份都不查。

用注入依赖：`{ schedule, readUser, reward, enabled }`，默认实现里 `schedule` 用 `next/server` 的 `after`。

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test apps/marketing/src/lib/credits/report-first-run
```

- [ ] **Step 3: 实现**

```ts
// @input  -- the slug of a tool run that just succeeded, inside a request scope
// @output -- nothing; the referral reward is claimed after the response is sent
// @pos    -- the single side effect the tool handlers gained in Phase 1

import { after } from "next/server";

import { getServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { creditsEnabled, type QualifyingTool } from "./credits-config.ts";
import { rewardReferral } from "./credits-store.ts";

export interface FirstRunReporterDependencies {
  readonly schedule: (task: () => Promise<void>) => void;
  readonly readUser: typeof getServerAuthenticatedUser;
  readonly reward: typeof rewardReferral;
  readonly enabled: () => boolean;
}

export const DEFAULT_FIRST_RUN_DEPENDENCIES: FirstRunReporterDependencies = {
  schedule: (task) => { after(task); },
  readUser: getServerAuthenticatedUser,
  reward: rewardReferral,
  enabled: () => creditsEnabled(),
};

/**
 * Report that a qualifying tool run succeeded, so a referral can be paid.
 *
 * Two properties this function must never lose:
 *
 * 1. It cannot throw. Four of the five call sites sit inside a try whose catch
 *    turns any throw into an error envelope, and the fifth
 *    (agents/audit-handler.ts) has no catch at all — a throw there turns a
 *    completed audit into a 500. A credit is worth strictly less than the run
 *    the visitor already paid for with their time.
 * 2. It cannot await. The handlers release their in-flight gate slot in a
 *    finally that runs after the success expression is evaluated, so awaiting
 *    here would hold the slot for the length of two network round trips and
 *    hand concurrent visitors a scan_in_progress 409 they do not deserve.
 */
export function reportFirstToolRun(
  tool: QualifyingTool,
  dependencies: FirstRunReporterDependencies = DEFAULT_FIRST_RUN_DEPENDENCIES,
): void {
  try {
    if (!dependencies.enabled()) return;
    dependencies.schedule(async () => {
      try {
        const user = await dependencies.readUser();
        if (user.status !== "authenticated") return;
        await dependencies.reward(user.userId, tool);
      } catch (error) {
        console.error("[credits] first-run report failed:", error);
      }
    });
  } catch (error) {
    // after() throws outside a request scope. Nothing about a served response
    // should depend on that.
    console.error("[credits] could not schedule the first-run report:", error);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test apps/marketing/src/lib/credits/report-first-run
```

- [ ] **Step 5: 提交**

```bash
git add apps/marketing/src/lib/credits/report-first-run.ts apps/marketing/src/lib/credits/report-first-run.test.ts
git commit -m "feat(marketing): report a first qualifying tool run"
```

---

## Task 10: 把上报器接进 5 个 handler（6 个成功点）

**Files:**
- Modify: `apps/marketing/src/lib/tools/quick-wins-handler.ts`
- Modify: `apps/marketing/src/lib/tools/traffic-drop-handler.ts`
- Modify: `apps/marketing/src/lib/tools/keyword-opportunity-handler.ts`
- Modify: `apps/marketing/src/lib/agents/audit-handler.ts`
- Modify: `apps/marketing/src/lib/agents/profile-refresh-handler.ts`

**为什么是这个接法（先读懂再动手）：** 五个 handler 没有共享的成功接缝——三个各自复制了一份私有 `json()`，`audit-handler` 连 `json()` 都没有，而且 `traffic-drop-handler.ts:291` 用 HTTP 200 返回 `no_gsc_data` **错误**信封。所以既不能按状态码判成功，也没法包一层。但有一个恰好成立的事实：**五个 handler 的测试文件全都手写字面量 deps 对象，没有一个引用 `DEFAULT_*`**。因此把默认实现注册进模块级 `DEFAULT_*` 对象、接口里声明为**可选**，就能做到路由零改动、既有测试零改动。

对每个 handler 重复以下三步：

- [ ] **Step 1: 接口加可选依赖**

在 `XxxDependencies` interface 里加：

```ts
  /**
   * Called once when a run completes successfully, so a referred visitor's
   * first qualifying run can pay its reward. Optional: tests leave it unset,
   * and nothing about the response depends on it.
   */
  readonly reportFirstRun?: (tool: QualifyingTool) => void;
```

- [ ] **Step 2: 在成功返回点之前调用**

严格按下表定位，**不要**按状态码或 `response.ok` 推断：

| 文件 | 成功点 | slug | 备注 |
|---|---|---|---|
| `quick-wins-handler.ts` | 唯一成功 `return json({ data: envelope }, 200)` | `"quick-wins"` | 零行结果也算完成的运行 |
| `traffic-drop-handler.ts` | `return json({ data: { ...envelope, series: daily } }, 200)` | `"traffic-drop"` | **绝不要**在 `no_gsc_data` 那个 200 前调用 |
| `keyword-opportunity-handler.ts` | stage 2 的 `return json({ data: payload }, 200)` | `"keyword-opportunities"` | 放在既有 `reportKeywordRunCost({…})` 调用**之后**、return 之前；`partial` 也算成功；stage 1 的成功点不加 |
| `audit-handler.ts` | `return Response.json({ data: projected }, …)` | `"agent-audit"` | 缓存命中同样算（spec §5.3 已裁决） |
| `profile-refresh-handler.ts` | 缓存命中三元表达式的真分支 | `"profile-refresh"` | 三元里不好塞语句，先把它拆成 `if` 再调用 |
| `profile-refresh-handler.ts` | 新跑的 `return json({ data }, 200)` | `"profile-refresh"` | |

调用形如：

```ts
    dependencies.reportFirstRun?.("quick-wins");
    return json({ data: envelope }, 200);
```

- [ ] **Step 3: 在模块级 DEFAULT 对象里注册**

三个 tools handler 的 `DEFAULT_*_DEPENDENCIES` 是 `Pick<...>` 类型——把 `"reportFirstRun"` 加进 `Pick` 的键联合，再加实现：

```ts
  reportFirstRun: reportFirstToolRun,
```

两个 agent handler 的 `DEFAULT_DEPENDENCIES` 是完整接口类型，直接加同一行即可。

import 用相对路径：`import { reportFirstToolRun } from "../credits/report-first-run.ts";`

- [ ] **Step 4: 五个 handler 都改完后，跑它们的既有测试**

```bash
pnpm test apps/marketing/src/lib/tools apps/marketing/src/lib/agents
```
Expected: **全绿且一条都没改过测试文件**。任何一条红都说明接法侵入了行为，回退重想——不要去改测试。

- [ ] **Step 5: 加一条针对性的回归测试**

在 `traffic-drop-handler.test.ts` 追加一个用例（这是唯一一个能被误判的点）：

```ts
  it("does not report a first run for the no_gsc_data envelope", async () => {
    const reportFirstRun = vi.fn();
    // ...构造出 daily.length === 0 的场景（照抄同文件里已有的 no_gsc_data 用例）
    const response = await handleTrafficDropRequest(request(), deps({ reportFirstRun, /* … */ }));
    expect(response.status).toBe(200);
    expect(reportFirstRun).not.toHaveBeenCalled();
  });

  it("reports a first run when the diagnosis is produced", async () => {
    const reportFirstRun = vi.fn();
    // ...照抄同文件里已有的成功用例
    await handleTrafficDropRequest(request(), deps({ reportFirstRun, /* … */ }));
    expect(reportFirstRun).toHaveBeenCalledWith("traffic-drop");
  });
```

同样在 `keyword-opportunity-handler.test.ts` 加一条「stage 1 成功不上报、stage 2 成功才上报」。

- [ ] **Step 6: 跑全套 + typecheck + lint**

```bash
pnpm test apps/marketing 2>&1 | tail -10
pnpm typecheck 2>&1 | tail -3
pnpm lint 2>&1 | tail -3
```

- [ ] **Step 7: 提交**

```bash
git add apps/marketing/src/lib/tools/quick-wins-handler.ts \
        apps/marketing/src/lib/tools/traffic-drop-handler.ts apps/marketing/src/lib/tools/traffic-drop-handler.test.ts \
        apps/marketing/src/lib/tools/keyword-opportunity-handler.ts apps/marketing/src/lib/tools/keyword-opportunity-handler.test.ts \
        apps/marketing/src/lib/agents/audit-handler.ts \
        apps/marketing/src/lib/agents/profile-refresh-handler.ts
git commit -m "feat(marketing): report qualifying tool runs from the five handlers"
```

---

## Task 11: i18n `credits` 命名空间

**Files:**
- Modify: `apps/marketing/src/i18n/messages/en.json`、`zh.json`
- Modify: `apps/marketing/src/app/[locale]/layout.tsx`

**两个必踩的坑：** ① `messages.test.ts` 逐叶子比对 en/zh，单边加 key 直接红。② `[locale]/layout.tsx` 只把 5 个命名空间序列化进全局 client provider，不加 `credits` 的话头部徽章会把 key 路径当文案渲染出来（next-intl 缺 key **不抛错**）。

- [ ] **Step 1: 在两个 catalog 里加同构的 `credits` 命名空间**

顶层 `credits` 需要的键（en 示例，zh 同结构）：

```jsonc
"credits": {
  "badge": { "label": "Credits", "loading": "…", "checkedIn": "Checked in today", "unavailable": "Credits unavailable" },
  "account": {
    "title": "Credits", "subtitle": "Free while GenGrowth tools are in testing.",
    "balanceLabel": "Balance", "welfareNotice": "Testing period: tools cost nothing today. These credits are what you will spend once pricing starts.",
    "dailyTitle": "Daily check-in", "dailyGranted": "+{amount} added today", "dailyPending": "Sign in tomorrow for +{amount} more",
    "welfareRemaining": "{remaining} of {cap} testing credits left to earn",
    "referralTitle": "Invite a colleague", "referralBody": "You both get {amount} credits once they finish their first audit.",
    "referralCopy": "Copy invite link", "referralCopied": "Copied", "referralCount": "{count} of {cap} invites rewarded",
    "ledgerTitle": "History", "ledgerEmpty": "Nothing yet.", "ledgerMore": "Show more",
    "entry": { "signup_bonus": "Welcome bonus", "daily_grant": "Daily check-in", "daily_expire": "Daily credits expired",
               "referral_reward_inviter": "Invite rewarded", "referral_reward_invitee": "Invited signup bonus",
               "consume": "Tool run", "refund": "Refund", "purchase": "Top-up", "adjustment": "Adjustment" },
    "signedOut": "Sign in to see your credits.", "unavailable": "Credits are temporarily unavailable."
  },
  "toolNotice": { "free": "Free during testing", "price": "{price} credits per run once pricing starts" }
}
```

zh 侧要点：**不要**直译成生硬中文；"Free during testing" → 「测试期限免」，"credits" → 「积分」。

- [ ] **Step 2: 加进 shell 序列化**

`[locale]/layout.tsx` 的 `shellMessages` 加一项，并写明理由：

```ts
    // The credits badge lives in the Header, so it is shell-wide like auth.
    credits: messages.credits,
```

- [ ] **Step 3: 跑 i18n 测试**

```bash
pnpm test apps/marketing/src/i18n
```
Expected: `messages.test.ts` 全绿（两边 key 完全对齐）。

- [ ] **Step 4: 提交**

```bash
git add apps/marketing/src/i18n/messages/en.json apps/marketing/src/i18n/messages/zh.json \
        "apps/marketing/src/app/[locale]/layout.tsx"
git commit -m "feat(marketing): add credits copy in both locales"
```

---

## Task 12: 头部余额徽章

**Files:**
- Create: `apps/marketing/src/components/credits/credits-badge.tsx` + `.test.tsx`
- Modify: `apps/marketing/src/components/layout/header.tsx`

照 `sign-in-control.tsx` 的形状：client 组件、mount 时 `fetch` + `AbortController`、三态 `useState`（`null` = 未知则**什么都不渲染**）。营销站没有 SWR / react-query，不要引入。

- [ ] **Step 1: 写失败测试**

用仓库既有的组件测试写法：`renderToStaticMarkup` + `NextIntlClientProvider` + 真 `en.json`，断言 `markup` 包含预期文案。覆盖：加载中（不渲染）、未登录（不渲染）、404/503（不渲染）、正常（渲染余额数字与「Credits」）。

- [ ] **Step 2: 实现徽章**

要点：
- `GET /api/credits/balance`，非 2xx 一律静默隐藏（展示层永不 fail-closed）。
- 显示总额 + 今日签到状态点；整体是个 `<Link href={localePath(locale, "/account/credits")}>`。
- 用现成 token：`text-text-dark-secondary`、`rounded-card`、`bg-brand-panel-raised`、`border-brand-border-card`；数字用 mono。
- `credits-badge` 只在 `SignInControl` 判定为已登录时才有意义，但它自己也会拿到 401——直接自己 fetch、自己隐藏，不引入组件间耦合。

- [ ] **Step 3: 挂进 header**

`header.tsx` 右侧那个 `<div className="flex items-center gap-4">` 里，放在 `<LanguageSwitcher />` **之前**：

```tsx
          <CreditsBadge />
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test apps/marketing/src/components/credits apps/marketing/src/components/layout
```

- [ ] **Step 5: 提交**

```bash
git add apps/marketing/src/components/credits/credits-badge.tsx \
        apps/marketing/src/components/credits/credits-badge.test.tsx \
        apps/marketing/src/components/layout/header.tsx
git commit -m "feat(marketing): show the credits balance in the header"
```

---

## Task 13: `/account/credits` 账户页

**Files:**
- Create: `apps/marketing/src/app/[locale]/account/credits/page.tsx` + `page.test.ts`
- Create: `apps/marketing/src/components/credits/credits-account-client.tsx` + `.test.tsx`

模仿 `[locale]/waitlist/page.tsx`：server `page.tsx`（`generatePageMetadata` + `noIndex: true`）+ client 组件 + 局部 `NextIntlClientProvider`。**加 `export const dynamic = "force-dynamic"`**（页面本身不读 cookie，但它渲染的完全是会话相关内容，静态化没有意义且会缓存出错觉）。

- [ ] **Step 1: 写失败测试**

`page.test.ts`：断言 metadata 带 `noIndex`；en/zh 两个 locale 都能渲染出标题。
`credits-account-client.test.tsx`：断言四块（余额卡/签到/邀请/流水）都在；未登录时显示 `signedOut` 文案；503 显示 `unavailable`。

- [ ] **Step 2: 实现**

client 组件职责：
- mount 时并发 `GET /api/credits/balance` 与 `GET /api/credits/ledger`。
- 余额卡：总额大字 + 「测试期限免」说明（`welfareNotice`）。
- 签到块：今天已领 / 明天再来 + 福利剩余额度。
- 邀请卡：`https://gengrowth.ai/r/{code}` 一键复制（`navigator.clipboard`，失败则降级为选中文本）+ 已计奖次数/上限。
- 流水：逐条「日期 · 事由 · ±数额 · 余额」，`entry_type` 经 `credits.account.entry.*` 映射成人话；「显示更多」按 `nextCursor` 翻页。
- 不要把 `entry_type` 原文渲染给用户看。

- [ ] **Step 3: 跑测试 + 确认路由没被短链兜底吞掉**

```bash
pnpm test "apps/marketing/src/app/[locale]/account" apps/marketing/src/components/credits
pnpm test apps/marketing/src/proxy
```

- [ ] **Step 4: 提交**

```bash
git add "apps/marketing/src/app/[locale]/account" apps/marketing/src/components/credits/credits-account-client.tsx \
        apps/marketing/src/components/credits/credits-account-client.test.tsx
git commit -m "feat(marketing): add the credits account page"
```

---

## Task 14: 工具页「测试期限免」标注

**Files:**
- Modify: `apps/marketing/src/components/tools/connected-tool-content.ts`
- Modify: `apps/marketing/src/components/tools/connected-tool-page.tsx`
- Modify: `apps/marketing/src/components/agents/agent-page.tsx`

提前锚定预期，避免二期开闸被骂。

- [ ] **Step 1: 给 `ConnectedToolContent` 加字段**

加 `readonly creditPrice: number;`，EN 与 ZH 两个 `Record<ConnectedTool, Content>` 各自补齐——`Record` 的完整性由 TypeScript 强制，漏一个就编译不过（这正是这个模式的价值）。

**两套 slug 没有一个字面量重合**，必须按下表逐条手写映射，不要指望名字能对上：

| `ConnectedTool`（页面 slug） | `CreditToolSlug`（计价 slug） | 积分 |
|---|---|---|
| `"seo-quick-wins"` | `CREDIT_TOOL_PRICES["quick-wins"]` | 5 |
| `"traffic-drop-diagnosis"` | `CREDIT_TOOL_PRICES["traffic-drop"]` | 3 |
| `"low-competition-keywords"` | `CREDIT_TOOL_PRICES["keyword-opportunities"]` | 25 |

价格一律从 `credits-config.ts` 取，不要手写数字。

- [ ] **Step 2: 在 `connected-tool-page.tsx` 渲染**

放在 `{content.description}` 之后、既有 `{connected ? null : (…)}` 提示块之前，用同一套卡片样式：

```tsx
        <p className="text-[13px] text-text-dark-secondary">
          <span className="text-brand-accent">{t("credits.toolNotice.free")}</span>
          {" · "}
          {t("credits.toolNotice.price", { price: content.creditPrice })}
        </p>
```

（若该组件当前不在 `credits` 命名空间的 provider 覆盖范围内，就在页面级 provider 里补 `credits`，不要把整包 messages 塞进去。）

- [ ] **Step 3: Agent 页同样标注**

`agent-page.tsx` 的 hero boundary-card 网格里加一格，价格取 `CREDIT_TOOL_PRICES["agent-audit"]`。

- [ ] **Step 4: 跑测试**

```bash
pnpm test apps/marketing/src/components/tools apps/marketing/src/components/agents
```
Expected: 全绿。注意 `tools-hub-contract.test.ts` 会正则扫 `slug: "..."`——本任务不新增 slug 字面量，不该触发。

- [ ] **Step 5: 提交**

```bash
git add apps/marketing/src/components/tools/connected-tool-content.ts \
        apps/marketing/src/components/tools/connected-tool-page.tsx \
        apps/marketing/src/components/agents/agent-page.tsx
git commit -m "feat(marketing): tell visitors the tools are free during testing"
```

---

## Task 15: 全量验证与运维交接

**Files:**
- Create: `apps/marketing/supabase/migrations/README-credits-rollout.md`

- [ ] **Step 1: 跑全部门禁**

```bash
cd /Users/wzb/Code/nevermore/credits-design
pnpm typecheck 2>&1 | tail -5
pnpm lint 2>&1 | tail -5
pnpm test 2>&1 | tail -20
MARKETING_TEST_DATABASE_URL="postgres://$(whoami)@127.0.0.1:5432/signalframe_ci_credits" pnpm test:sql:marketing 2>&1 | tail -20
pnpm secrets:scan 2>&1 | tail -5
pnpm --filter @sf/marketing build 2>&1 | tail -15
```
Expected: 全部通过。**把每条的真实输出记下来**——声称通过而没有输出证据是本仓明令禁止的。

- [ ] **Step 2: 确认 flag 关闭时行为等同现状**

```bash
grep -rn "creditsEnabled\|MARKETING_CREDITS_ENABLED" apps/marketing/src --include=*.ts --include=*.tsx
```
逐个确认：flag 关 → 两个 API 返回 404、徽章不渲染、账户页显示未启用、上报器直接短路。**工具 handler 的准入路径上不能出现任何 flag 判断**（它本来就不该被影响）。

- [ ] **Step 3: 写上线交接说明**

`apps/marketing/supabase/migrations/README-credits-rollout.md` 写清顺序（这是财务表，顺序错会发错积分）：

1. 先部署代码，`MARKETING_CREDITS_ENABLED` **不设或为 false** → 站点行为与现状完全一致。
2. 在营销站 Supabase 项目的 SQL Editor 里执行 `0004_credits_ledger.sql`（整文件一次执行）。
3. 冒烟：`select * from public.credit_settings;` 应有且仅有 id=1 一行，数值 = 20/600/200/100/50/20。
4. 置 `MARKETING_CREDITS_ENABLED=true` 并重新部署 → 发放开始。
5. 回滚：把 flag 改回 false 即可停止一切发放；**不要删表**（流水是账，删了对不回来）。
6. 二期（扣费）另有 migration `0005` 与独立开关，不在本次范围。

- [ ] **Step 4: 记录 git 状态并提交**

```bash
git status --short
git add apps/marketing/supabase/migrations/README-credits-rollout.md
git commit -m "docs(marketing): document the credits rollout order"
git log --oneline origin/main..HEAD
```
Expected: 只有本计划涉及的文件；提交序列干净。

---

## 完成标准（Definition of Done）

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm --filter @sf/marketing build` / `pnpm secrets:scan` 全绿，且**贴出真实输出**
- [ ] `pnpm test:sql:marketing` 全绿——三个 RPC 的并发、封顶、幂等、流水重放对账都被真 Postgres 证明过
- [ ] 五个工具 handler 的既有测试**一行未改**且全绿
- [ ] `MARKETING_CREDITS_ENABLED` 关闭时，站点行为与本次改动前完全一致
- [ ] en/zh 文案对齐（`messages.test.ts` 绿）
- [ ] 没有任何扣费、订单、支付相关代码进入本次改动（Phase 2/3 不在范围）
- [ ] `apps/web`（产品端）**零改动**
