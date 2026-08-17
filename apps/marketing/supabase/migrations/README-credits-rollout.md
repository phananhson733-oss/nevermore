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

到时候要做的五件事：

1. **恢复工具页与 Agent 页的价格标注。** 完整实现（含 EN/ZH 文案、`ConnectedToolContent.creditPrice` 字段、slug 映射表、三条渲染测试）在 commit `dd9669b8` 里，可直接 cherry-pick 后按当时的定价调整。恢复时给它加上开关，别再让它脱离 `MARKETING_CREDITS_ENABLED`。
2. **把三个 Search Console 工具接回合格运行清单**（`credits-config.ts` 的 `QUALIFYING_TOOLS`）。它们现在被排除，是因为准入用的是 `gg_id` 这个 Google 封印 cookie，而账本记的是 Supabase user id，两个身份之间没有绑定——一个 Google 账号能给任意多个 Supabase 账号刷出合格运行。Phase 2 本来就要把这三个工具改成 Supabase 登录专享，改完这层错配自然消失，那时再把它们加回去。
3. **裁决 On-Page Checker 的价格。** `on-page-seo-check` 现在按对标竞品的单页检查定价 1 积分，但它跑的是与 `agent-audit` 完全相同的全站抓取，服务成本一样——竞品那 1 积分买的是一次 100 毫秒的单页取回。福利期不扣费，所以这个缺口现在没有代价；开始计费前必须裁决：要么按真实成本改成 10，要么先做出一条真正更便宜的单页路径再谈 1。恢复价格标注时（第 1 条）会顺带把这个数字暴露给用户，别在那之前忘了这一条。
4. **重新评估合格门槛的经济性。** 现在只剩 agent-audit 和 profile-refresh 合格，而这两个只需要一个公开 URL，不构成真实摩擦。开闸前先跑刷量审计（见设计文档 §1 Phase 2 前置门），可疑账户先 `status = 'frozen'`。
5. **补齐 LLM 单价**，据此复核工具定价与毛利（设计文档 §6 明确这是开闸前置条件）。

## 不在本次范围

扣费（`credits_consume` / `credits_refund` / `credit_charges` / migration `0005`）与充值（`credit_purchase_orders` / Airwallex / migration `0006`）属于 Phase 2 和 Phase 3，各有独立开关与独立的上线门。`credit_settings.mode` 与 `consumption_paused` 两列现在就存在，但在 Phase 2 之前没有任何代码读取它们做扣费决策。
