# 积分体系上线顺序（Phase 1 / 福利期）

这是一张财务表。顺序错了会发错积分，而流水是 append-only 的——发出去的改不回来，只能用治理条目冲抵。

## 顺序

**1. 先部署代码，`MARKETING_CREDITS_ENABLED` 不设或设为 `false`。**

此时站点行为与上线前完全一致：`/api/credits/*` 返回 404、头部徽章不渲染、账户页显示未启用、首跑上报直接短路。工具的准入、配额与鉴权**完全没有** flag 判断，本来就不受影响。

**2. 在营销站 Supabase 项目的 SQL Editor 里执行 `0004_credits_ledger.sql`。**

整个文件一次性执行。它是幂等的（`create table if not exists` / `create or replace function` / 种子行 `on conflict do nothing`），重复执行不会重置任何余额。

**3. 冒烟。**

```sql
select * from public.credit_settings;
```

必须恰好一行，`id = 1`，且：

| 列 | 期望值 |
|---|---|
| `mode` | `welfare` |
| `consumption_paused` | `false` |
| `daily_amount` | 20 |
| `welfare_accrual_cap` | 600 |
| `referral_daily_cap` | 200 |
| `signup_bonus` | 100 |
| `referral_reward` | 50 |
| `referral_inviter_cap` | 20 |

这些是运行时权威——RPC 只读数据库，应用层不传任何金额。`apps/marketing/src/lib/credits/credits-config.ts` 记录同一组种子值，一致性由单测 pin 死。

**4. 设 `MARKETING_CREDITS_ENABLED=true` 并重新部署。**

发放从此刻开始：注册 +100、每日签到 +20（累加，累计封顶 600）、被邀请人首次完成合格工具运行后双边各 +50。

**5. 验证**：登录后打开任意页面，头部出现积分徽章；`/account/credits` 显示余额与流水；流水里应有一条 `signup_bonus +100` 和一条 `daily_grant +20`。

## 回滚

把 `MARKETING_CREDITS_ENABLED` 改回 `false` 并重新部署，一切发放立即停止。

**不要删表。** 流水是账，删了对不回来，而且用户已经看到过自己的余额。

## 调整数值

改 `credit_settings` 的对应列即可，立刻生效、无需部署（RPC 每次调用都重读）：

```sql
update public.credit_settings set daily_amount = 30, updated_at = now() where id = 1;
```

改完记得同步 `credits-config.ts` 里的种子值，否则 `credits-config.test.ts` 会红——那条测试存在的意义就是不让展示的数字和实际发放的数字分家。

## 紧急处置

冻结单个账户（不发放、不计奖）：

```sql
update public.credit_accounts set status = 'frozen', updated_at = now() where user_id = '<uuid>';
```

停掉全站邀请奖励（当天）：

```sql
update public.credit_settings set referral_daily_cap = 0, updated_at = now() where id = 1;
```

这条是安全的：被拒的申领**不会**烧掉被邀请人的 `first_tool_run_at`，恢复上限后他们下次成功运行仍能拿到奖励。

## Phase 2 待恢复清单（开始计费时一起做）

福利期刻意**不在工具页展示任何积分文案**：开关关掉时页面要和上线前完全一致，而客户端组件读不到非 `NEXT_PUBLIC_` 的环境变量，做不到跟着开关走。文案连同定价一起等正式计费时统一改。

到时候要做的七件事：

1. **恢复工具页与 Agent 页的价格标注。** 完整实现（含 EN/ZH 文案、`ConnectedToolContent.creditPrice` 字段、slug 映射表、三条渲染测试）在 commit `dd9669b8` 里，可直接 cherry-pick 后按当时的定价调整。恢复时给它加上开关，别再让它脱离 `MARKETING_CREDITS_ENABLED`。
2. **把三个 Search Console 工具接回合格运行清单**（`credits-config.ts` 的 `QUALIFYING_TOOLS`）。它们现在被排除，是因为准入用的是 `gg_id` 这个 Google 封印 cookie，而账本记的是 Supabase user id，两个身份之间没有绑定——一个 Google 账号能给任意多个 Supabase 账号刷出合格运行。Phase 2 本来就要把这三个工具改成 Supabase 登录专享，改完这层错配自然消失，那时再把它们加回去。
3. **On-Page Checker 定价 1 积分（Owner 已裁决 2026-08-18：暂按 1 积分扣）。** 记下它是什么、不是什么：`on-page-seo-check` 跑的是与 `agent-audit` 完全相同的全站抓取，服务成本一样，而 `agent-audit` 标价 10——竞品那 1 积分买的是一次 100 毫秒的单页取回，我们不是。所以这是一个**有意的获客补贴**，不是成本定价，缺口约 9 积分/次。

   开闸后要盯的两件事，任一发生就把这个数字重新提上来：

   - **同站重复检查的成本是缓存决定的，不是价格决定的。** 一小时内同站再检查复用采集，边际成本接近 0；超出就是又一次完整抓取。如果实际使用集中在「每次都是新站」，9 积分的缺口就是每次都在发生。
   - **它是合格工具（第 4 条）。** 1 积分的入口 + 合格首跑奖励，意味着刷量的收益比在别的工具上更高。刷量审计要单独看这个 slug 的分布。

   真要收窄缺口，顺序是先做一条真正更便宜的单页路径（不跑全站抓取），而不是先把价格抬到 10——抬价把这个工具的获客作用一起抬没了。
4. **重新评估合格门槛的经济性。** 现在合格的是 agent-audit、on-page-seo-check 和 profile-refresh，而这三个都只需要一个公开 URL，不构成真实摩擦。开闸前先跑刷量审计（见设计文档 §1 Phase 2 前置门），可疑账户先 `status = 'frozen'`。

   2026-08-17 的 /qa 验收（含 codex 对抗审计）已经把套利面找出来了，**开闸前逐条处理，不要重新推导一遍**：

   - **环形互邀**（实测成立）。`credits_ensure_account` 只拦 `a.user_id <> p_user_id`，也就是只拦自邀。A 邀 B、B 反过来邀 A 是允许的：两个账号在各自跑过一次合格工具后，每人多拿 100（一次 invitee + 一次 inviter）。N 个账号还能凑成环。要堵就在归因时拒绝已经是本账号下线的邀请人。
   - **注册与签到没有全局熔断**。`referral_daily_cap` 只管邀请。开 N 个 Supabase 账号，每个白拿 100 注册奖励 + 每天 20（累计 600），这条链上没有任何速率闸。
   - **邀请人封顶不作废邀请码**（实测：25 个被邀请人，邀请人只拿到 20 笔，被邀请人 25 笔全额发放，全局计数被消耗 25 次）。这可能就是想要的行为——被邀请人是真实新用户——但要**明确裁决**，别默认。
   - **`first_tool_run_at` 记的是"账号存在之后的首次上报"**，不是真正的首次运行。绕过浏览器直接 POST 工具 API（此时还没有 credit_accounts 行）会拿到 `no_account` 且不盖戳，之后再挑一个邀请码绑定，第二次运行就算首跑。门槛高、收益 50 分，但 Phase 2 收费后要重新算这笔账。

5. **补齐 referral 发奖的重试。** `reportFirstToolRun` 是一次性投递：RPC 死锁或超时只写一行 `console.error`，奖励就永久漏发，除非用户碰巧再跑一次工具。福利期漏发一笔 50 分无所谓，收费后不行。要么落一张 pending 表由 worker 重投，要么在下次 balance 调用时补偿。
6. **补齐 LLM 单价**，据此复核工具定价与毛利（设计文档 §6 明确这是开闸前置条件）。

7. **两条已知的窄竞态**，福利期发生概率极低、后果可自愈，收费前值得收掉：

   - `credits_touch_daily` 在 UTC 跨日的毫秒窗口里可能把 `daily_granted_on` **倒写**：请求 A 在 D 日进入函数后固定 `v_today=D` 却卡在行锁前，请求 B 在 D+1 拿到锁、发放并盖戳 D+1，A 随后拿锁又发 D 并把戳改回 D。此后 D+1 的请求会重试已经用过的幂等键 `daily:<uid>:D+1`，撞 UNIQUE 整笔回滚，该用户当天余额接口持续 503，通常到 D+2 才自愈。修法是让戳只能单调前进（`where daily_granted_on is null or daily_granted_on < v_today`）。
   - 一个已有账号（`referred_by` 与 `first_tool_run_at` 都为空）如果在**归因请求和首跑上报并发**时先被 reward RPC 锁到，会走 `no_referrer` 并永久盖戳，即使浏览器里那张有效 `gg_ref` 早就写好了。邀请从此对该账号永久失效，且不可恢复。

## 不在本次范围

扣费（`credits_consume` / `credits_refund` / `credit_charges` / migration `0005`）与充值（`credit_purchase_orders` / Airwallex / migration `0006`）属于 Phase 2 和 Phase 3，各有独立开关与独立的上线门。`credit_settings.mode` 与 `consumption_paused` 两列现在就存在，但在 Phase 2 之前没有任何代码读取它们做扣费决策。
