# GEO 知识库上线顺序（迁移 0006）

这三张表里有一张是 append-only 的。冻结出去的版本改不回来也删不掉，而 AI 可见性体检按 `snapshot_id` 引用它的提问集——删掉快照等于让一次已经付过钱的采样失去「它当时问了什么」的记录。

## 先决条件：0005 必须已经在这个 Supabase 项目里跑过

0006 用了 0005 的一个函数 `public.marketing_canonical_jsonb_text`，而 plpgsql 的函数体在 `create function` 时只做语法检查、不做名字解析。所以 **0005 没跑过时 0006 照样能安装成功**，注册站点也能成功，只有第一次保存草稿时才会炸：

```
ERROR:  function public.marketing_canonical_jsonb_text(jsonb) does not exist
CONTEXT:  PL/pgSQL function public.marketing_geo_save_kb_draft(uuid,uuid,text,jsonb,text,integer) line 25 at assignment
```

执行 0006 之前先确认：

```sql
select count(*) as canonical_helper_present
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'marketing_canonical_jsonb_text';
```

必须是 `1`。是 `0` 就先整份执行 `0005_account_websites.sql`。

## 为什么代码先上、SQL 后跑

这不是选择。main 合并即自动部署（Vercel `gengrowth-agents`），SQL 是 Supabase SQL Editor 里的手工步骤，只能在部署之后。所以「代码已上线、表还不存在」这个窗口一定会出现，问题只是它安不安全。

它安全，因为表缺失时知识库 fail-closed。浏览器角色对这三张表没有任何权限，所有读写都走 service_role 的 PostgREST 请求：表不在 schema cache 里返回 `PGRST205`，函数不在返回 `PGRST202`，两者都是传输层错误，没有一条路径能把它读成「这个账号还没有知识库」。

窗口期里必须成立的两件事，值得在跑 SQL 之前亲眼确认一次：

- 工具页显示的是**不可用**，不是一个空知识库。空知识库会让人以为可以开始填。
- 保存不会静默成功。

反过来先跑 SQL 也不会坏（没人读这些表），但没有意义。真正不能做的是在窗口里改代码去「兼容表不存在」——那是把 fail-closed 改成 fail-open。

## 顺序

1. **合并 PR，等部署真的完成。** 合并不等于部署完成，Vercel 会漏掉紧挨着的合并；先确认生产上跑的 commit 就是这次的。
2. **打开知识库工具页，确认是不可用状态。** 这是在验证上一节那两件事，不是走过场。
3. **在 SQL Editor 跑先决条件那条 SQL**，确认返回 1。
4. **整份执行 `0006_geo_knowledge_base.sql`。** 它是幂等的（`create table if not exists`、`create index if not exists`、`create or replace function`、`drop trigger if exists` + `create trigger`，外键先 `drop constraint if exists` 再加），重复执行不会丢行，也不会重置任何已经冻结的版本。
5. **跑下面三段冒烟。** 任何一行与期望不符就停在这里，不要继续第 6 步。
6. **回工具页刷新**，建一个知识库、保存一次、冻结一次，确认版本号是 1。

## 冒烟

### 1. 表、RLS、不可变触发器

```sql
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_trigger t
         where t.tgrelid = c.oid and not t.tgisinternal) as triggers
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('marketing_geo_knowledge_bases',
                     'marketing_geo_kb_drafts',
                     'marketing_geo_kb_snapshots')
 order by c.relname;
```

| table_name | rls_enabled | triggers |
|---|---|---|
| `marketing_geo_kb_drafts` | t | 0 |
| `marketing_geo_kb_snapshots` | t | **2** |
| `marketing_geo_knowledge_bases` | t | 0 |

快照那 2 个触发器缺一不可：一个 row-level 拦 UPDATE / DELETE，一个 statement-level 拦 TRUNCATE。row 触发器永远看不到 TRUNCATE，所以只有一个的时候，append-only 是假的。

### 2. 权限（这一段就是隔离边界本身）

```sql
select c.relname as table_name,
       has_table_privilege('anon',          c.oid, 'select') as anon_select,
       has_table_privilege('authenticated', c.oid, 'select') as auth_select,
       has_table_privilege('service_role',  c.oid, 'select') as sr_select,
       has_table_privilege('service_role',  c.oid, 'insert') as sr_insert,
       has_table_privilege('service_role',  c.oid, 'update') as sr_update,
       has_table_privilege('service_role',  c.oid, 'delete') as sr_delete
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('marketing_geo_knowledge_bases',
                     'marketing_geo_kb_drafts',
                     'marketing_geo_kb_snapshots')
 order by c.relname;

select p.proname as function_name,
       has_function_privilege('anon',          p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('service_role',  p.oid, 'execute') as sr_exec
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('marketing_geo_upsert_kb',
                     'marketing_geo_save_kb_draft',
                     'marketing_geo_freeze_kb')
 order by p.proname;
```

三张表都必须是 `f f t f f f`（只有 service_role 的 SELECT 是 t），三个函数都必须是 `f f t`。

为什么这一段比 RLS 重要：service_role 带 BYPASSRLS，RLS 对它是透明的，所以隔离边界不是策略而是权限。service_role 只有 SELECT，写路径只剩三个 SECURITY DEFINER 函数，而函数里每一条 where 都带 `user_id = p_user_id`。anon 与 authenticated 一个权限都没有，浏览器直连 PostgREST 读不到任何人的知识库——包括自己的。

### 3. 生命周期、不可变、跨用户

整段在一个事务里，最后 `rollback`，不留任何行。

```sql
begin;
do $$
declare
  v_user    uuid := '00000000-0000-4000-8000-00000000dead';
  v_other   uuid := '00000000-0000-4000-8000-00000000beef';
  v_kb      uuid;
  v_payload jsonb := '{"schemaVersion":"marketing-geo-kb.v1","officialName":"rollout smoke"}'::jsonb;
  v_qs      jsonb := '{"schemaVersion":"marketing-geo-question-set.v1","questions":[]}'::jsonb;
  v_hash    text;
  v_qhash   text;
  v_out     text;
  v_rev     integer;
  v_snap    uuid;
  v_first   uuid;
  v_reused  boolean;
begin
  v_hash  := encode(sha256(convert_to(public.marketing_canonical_jsonb_text(v_payload), 'UTF8')), 'hex');
  v_qhash := encode(sha256(convert_to(public.marketing_canonical_jsonb_text(v_qs), 'UTF8')), 'hex');

  select kb_id into v_kb
    from public.marketing_geo_upsert_kb(v_user, 'https://smoke.invalid', 'smoke.invalid', 'smoke.invalid');
  raise notice '1  upsert kb              -> %', v_kb;

  select outcome into v_out from public.marketing_geo_save_kb_draft(v_user, v_kb, 'marketing-geo-kb.v1', v_payload, v_hash, 0);
  raise notice '2  save (base 0)          -> %   [saved]', v_out;
  select outcome into v_out from public.marketing_geo_save_kb_draft(v_user, v_kb, 'marketing-geo-kb.v1', v_payload, v_hash, 0);
  raise notice '3  save again (base 0)    -> %   [conflict]', v_out;
  select outcome into v_out from public.marketing_geo_save_kb_draft(v_user, v_kb, 'marketing-geo-kb.v1', v_payload, repeat('f', 64), 1);
  raise notice '4  save with wrong hash   -> %   [hash_mismatch]', v_out;
  select outcome into v_out from public.marketing_geo_save_kb_draft(v_other, v_kb, 'marketing-geo-kb.v1', v_payload, v_hash, 1);
  raise notice '5  save as another user   -> %   [not_found]', v_out;

  select outcome, snapshot_id, revision, reused_existing into v_out, v_snap, v_rev, v_reused
    from public.marketing_geo_freeze_kb(v_user, v_kb, 'marketing-geo-kb.v1', 1, v_qs, v_qhash);
  v_first := v_snap;
  raise notice '6  freeze                 -> % rev % reused %   [frozen 1 f]', v_out, v_rev, v_reused;
  select outcome, snapshot_id, revision, reused_existing into v_out, v_snap, v_rev, v_reused
    from public.marketing_geo_freeze_kb(v_user, v_kb, 'marketing-geo-kb.v1', 1, v_qs, v_qhash);
  raise notice '7  freeze again           -> % rev % reused % same-row %   [frozen 1 t t]', v_out, v_rev, v_reused, (v_snap = v_first);
  select outcome into v_out from public.marketing_geo_freeze_kb(v_other, v_kb, 'marketing-geo-kb.v1', 1, v_qs, v_qhash);
  raise notice '8  freeze as another user -> %   [not_found]', v_out;

  begin
    update public.marketing_geo_kb_snapshots set revision = 99 where kb_id = v_kb;
    raise notice '9  UPDATE a snapshot     -> ACCEPTED   [FAIL: must be rejected]';
  exception when others then
    raise notice '9  UPDATE a snapshot     -> rejected: %', sqlerrm;
  end;
  begin
    delete from public.marketing_geo_kb_snapshots where kb_id = v_kb;
    raise notice '10 DELETE a snapshot     -> ACCEPTED   [FAIL: must be rejected]';
  exception when others then
    raise notice '10 DELETE a snapshot     -> rejected: %', sqlerrm;
  end;
  begin
    truncate public.marketing_geo_kb_snapshots cascade;
    raise notice '11 TRUNCATE snapshots    -> ACCEPTED   [FAIL: must be rejected]';
  exception when others then
    raise notice '11 TRUNCATE snapshots    -> rejected: %', sqlerrm;
  end;
end
$$;
rollback;
```

期望输出（`snapshot_id` 与 kb 的 uuid 每次不同）：

```
NOTICE:  1  upsert kb              -> 7dfeb47e-ba55-4405-bd83-106576f8f5c5
NOTICE:  2  save (base 0)          -> saved   [saved]
NOTICE:  3  save again (base 0)    -> conflict   [conflict]
NOTICE:  4  save with wrong hash   -> hash_mismatch   [hash_mismatch]
NOTICE:  5  save as another user   -> not_found   [not_found]
NOTICE:  6  freeze                 -> frozen rev 1 reused f   [frozen 1 f]
NOTICE:  7  freeze again           -> frozen rev 1 reused t same-row t   [frozen 1 t t]
NOTICE:  8  freeze as another user -> not_found   [not_found]
NOTICE:  9  UPDATE a snapshot     -> rejected: GEO knowledge base snapshots are append-only (attempted UPDATE)
NOTICE:  10 DELETE a snapshot     -> rejected: GEO knowledge base snapshots are append-only (attempted DELETE)
NOTICE:  truncate cascades to table "marketing_geo_knowledge_bases"
NOTICE:  truncate cascades to table "marketing_geo_kb_drafts"
NOTICE:  11 TRUNCATE snapshots    -> rejected: GEO knowledge base snapshots are append-only (attempted TRUNCATE)
DO
ROLLBACK
```

三处最容易看漏，逐条对：

- **第 3 步是 `conflict` 不是 `saved`。** 草稿版本号是 CAS 令牌，两个标签页同时编辑必须撞车而不是互相覆盖。
- **第 7 步是 `reused t` 且 `same-row t`。** 同一份 payload 冻结两次只能有一个版本；否则双击按钮就能给同一份内容造出两个 `snapshot_id`，之后的运行会指向哪一个说不清。
- **第 5 / 8 步是 `not_found` 不是报错。** 别人的 kb_id 既不区分「不存在」也不区分「不是你的」，这是有意的，不泄漏存在性。

第 11 步会短暂拿 ACCESS EXCLUSIVE 锁——触发器在真正截断之前就报错，没有丢数据的风险，但锁是真的。刚跑完迁移、表还是空的时候跑没有影响；表上已经有真实流量之后要再验证，把第 11 步删掉。

## 回滚

**首选：回滚代码，不动表。** revert PR 重新部署，工具页回到不可用（走的就是上面那条 fail-closed 路径），已经写进去的行原封不动。代价只有「用户看到工具消失」。

**表回滚：不建议。** 顺序如下（已验证可执行）：

```sql
begin;
drop function if exists public.marketing_geo_freeze_kb(uuid, uuid, text, integer, jsonb, text);
drop function if exists public.marketing_geo_save_kb_draft(uuid, uuid, text, jsonb, text, integer);
drop function if exists public.marketing_geo_upsert_kb(uuid, text, text, text);
drop table if exists public.marketing_geo_kb_snapshots cascade;
drop table if exists public.marketing_geo_kb_drafts cascade;
drop table if exists public.marketing_geo_knowledge_bases cascade;
drop function if exists public.marketing_geo_kb_snapshots_immutable();
commit;
```

`marketing_geo_kb_current_snapshot_fk` 会随 snapshots 一起 cascade 掉，不用单独处理。`marketing_canonical_jsonb_text` 属于 0005，别动它——账号网站档案还在用。

代价逐条，先看完再决定：

- **append-only 拦不住 DROP TABLE。** 触发器只拦 UPDATE / DELETE / TRUNCATE。快照删了就没了，没有第二份。
- **已经跑过的可见性体检会失去它问过什么。** 运行行按 `snapshot_id` 引用提问集；提问集只在快照行里。那是一次已经付过钱的采样，重跑要重新付。
- **版本号会从头开始。** 用户已经看到过「已冻结 v1」；重建之后同一份 payload 会拿到一个新的 `snapshot_id`，再冻结又是 1。

所以停用走代码，不走 drop table。

## 这套表存了什么

| 表 | 存 |
|---|---|
| `marketing_geo_knowledge_bases` | 站点身份：`user_id` + `canonical_site_key`（这一对唯一）、`origin`、`host`、当前冻结版本指针、时间戳 |
| `marketing_geo_kb_drafts` | 每个知识库恰好一行可变草稿：`payload` jsonb（≤128 KiB）、`content_hash`、`draft_version`（CAS 令牌） |
| `marketing_geo_kb_snapshots` | 冻结版本：同一份 `payload`、它派生出的 `question_set`（≤256 KiB）、两个 sha256、`revision`、`frozen_at` |

`payload` 里是用户自己填的内容：品牌正式名与别名、品类词、市场与语言、ICP 角色（标签 / 细分 / 痛点 / 决策标准 / 语汇）、竞品域名与品牌名及是否已确认、已核实事实（值 + 出处 URL + 观察时间，或者空值 + 为什么空）、以及一次性导入时来源网站档案快照的 id。

`question_set` 是 `payload` 加模板注册表版本的纯函数结果，和 payload 存在同一行。它存在这里而不是每次运行时重算，是为了让一次运行可复现：以后注册表发新版，不能追溯改写过去问过的题。

两个 hash 是双向的：调用方算一遍，数据库用自己的规范形式再算一遍，对不上就拒。所以哪一边单独都定义不了「这是同一份内容」，中途被改过的 payload 也没法顶着旧 hash 存进去。

## 不存什么

- **不存 provider 回答原文。** 按设计（D5），可见性体检每轮落一行 `marketing_geo_runs`（聚合指标 + 逐题计数，另一次迁移，尚未执行）；回答正文任何一张表都不存。
- **不存任何密钥。** DataForSEO / LLM 凭据只在 Railway 与 Vercel 的 secret store 里。
- **不存 GSC 身份。** GSC 那几个工具认的是 `gg_id` 这个 Google 封印 cookie，知识库认的是 Supabase `user_id`。两个身份没有绑定，这里也不试图绑定。
- **不存邮箱、账号资料、积分。** 全表只有 `user_id` 这一个 uuid 指向账号。
- **不存跨用户可见的东西。** 三张表都没有 policy，浏览器角色一个权限都没有。跨用户可见性只可能来自服务端代码忘记传 `user_id`，而三个 RPC 的每一条 where 都带着它。
- **没有删除路径。** 这一期没有删除知识库的 RPC；外键是 `on delete restrict`，所以即使有人拿到了写权限，也删不掉一个还有草稿或快照的知识库。

---

# AI 可见性体检（迁移 0007）

## 先决条件：0006 必须已经在这个 Supabase 项目里跑过

0007 的 `marketing_geo_visibility_runs` 有一个到 `marketing_geo_kb_snapshots (id, user_id)` 的复合外键，写入函数还会直接查那张表。**没有 0006，`create table` 当场就失败**——这一次不像 0006 依赖 0005 那样会「装得上、第一次用才炸」，因为外键在建表时就要求被引用的表存在。确认一下：

```sql
select to_regclass('public.marketing_geo_kb_snapshots');
-- 期望：public.marketing_geo_kb_snapshots；如果是 null，先跑 0006。
```

## 顺序

代码可以先上。没有这张表时，一轮体检会在最后一步落库时失败并把 `store_unavailable` 显示出来——但那时钱已经花掉了。**所以这条迁移要在把工具入口交给任何人之前跑完**，不能像 0006 那样容忍一段空窗。

```bash
# DATABASE_URL 从 Railway worker 的变量里取，去掉 query string
psql "$DATABASE_URL" -f apps/marketing/supabase/migrations/0007_geo_visibility_runs.sql
```

## 冒烟

```sql
-- 1. 表在，RLS 开着，且一条策略都没有（真正的边界是下面的 revoke）
select relrowsecurity from pg_class where oid = 'public.marketing_geo_visibility_runs'::regclass;
-- 期望：t
select count(*) from pg_policies where tablename = 'marketing_geo_visibility_runs';
-- 期望：0

-- 2. 三个角色都不能写；service_role 只能读
select grantee, privilege_type from information_schema.role_table_grants
 where table_name = 'marketing_geo_visibility_runs' order by grantee, privilege_type;
-- 期望：`service_role` 只有 SELECT（外加 REFERENCES / TRIGGER，那两个不是写）。
-- `postgres` 会带着全套权限出现，它是表的属主，这一行是正常的——2026-08-29
-- 实际执行时确认过。`anon` 与 `authenticated` 一行都不该有。
-- 任何 service_role 的 INSERT、UPDATE、DELETE 都是缺陷。

-- 3. append-only 的两个触发器都在（行级挡改删，语句级挡 truncate）
select tgname from pg_trigger
 where tgrelid = 'public.marketing_geo_visibility_runs'::regclass and not tgisinternal
 order by tgname;
-- 期望：marketing_geo_visibility_runs_immutable_row
--       marketing_geo_visibility_runs_immutable_truncate

-- 4. 写入函数只有 service_role 能执行
select has_function_privilege('service_role',
  'public.marketing_geo_record_visibility_run(uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb,jsonb)', 'execute') as service_role,
  has_function_privilege('authenticated',
  'public.marketing_geo_record_visibility_run(uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb,jsonb)', 'execute') as authenticated;
-- 期望：t / f
```

第 3 项值得单独盯：这张表是「这轮体检花了多少钱、看到了什么」的唯一记录，也是下一轮做对比的基线。基线能被改写，对比就能说任何话。

## 已执行

2026-08-29 对生产库执行完毕（连接串取自 Railway `signalframe` 项目 worker 服务的
`DATABASE_URL`，去掉 query string）。四项冒烟全部符合预期：RLS 开、零策略、
两个不可变触发器在位、写入函数只有 service_role 可执行。

## 回滚

```sql
drop function if exists public.marketing_geo_record_visibility_run(
  uuid, uuid, uuid, text, integer, jsonb, jsonb, jsonb, jsonb);
drop table if exists public.marketing_geo_visibility_runs;
```

丢的是历史轮次与基线，知识库本身不受影响。回滚后工具仍能跑完并出报告，只是最后落库那步会失败——所以要么同时把入口撤下来，要么接受访客付了钱看得到报告但存不下来。

## 这张表存了什么

每轮一行：manifest（问题集指纹、样本数、市场、模型面、起止时间、调用数与实测花费）、聚合指标、逐题的「答了没有 / 提到没有」、被引用域名的计数。

## 不存什么

**不存模型回答的原文。** 判定在写库之前就做完了，落下来的只有数字和问题文本本身。回答里可能有第三方的名字、也可能有模型编的东西，留着它既扩大了泄漏面，也会让人把它当成「AI 说过的话」的证据来引用——它不是，它是一次不可复现的采样。

---

# GEO 知识库 v3（迁移 `20260907143000_geo_kb_v3.sql`）

设计稿：`docs/plans/2026-09-07-geo-kb-redesign-design.md`，切片 S1a。

这条迁移把知识库从「测量管线的副产品」改成「可发布、有版本、可审阅的档案」在**库端**的那一半：
草稿 payload 丢掉 28 字段的 `profileCopy`、改成只引用已确认 Profile 的 `generationInput`；
提问集从「冻结的前置条件」降为「可缺席的派生产物」；发布由一个新的 RPC 承担，而不是复用冻结。

**这条迁移不改任何既有迁移文件，也不重写任何一行既有数据。** v1 / v2 的草稿、快照、上下文、
候选、生成记录全部逐字节保留，每一条 v1/v2 判据都原样留在原处，v3 判据加在它旁边。

## 先决条件

`20260905155607_geo_knowledge_pack_companion.sql` 必须已经在这个 Supabase 项目里跑过。
这条迁移 `create or replace` 了它定义的四个函数（`marketing_geo_finish_generation`、
`marketing_geo_knowledge_input_valid`、`marketing_geo_knowledge_result_valid`、
`marketing_geo_generation_input_current`），签名逐字不变——**绝不要 `drop function`**，
签名一变就会留下重载，两个版本同时存在时调用哪个由参数类型决定，那是最难查的一类故障。

## 顺序

代码先上、SQL 后跑仍然成立（理由见本文件开头那一节）：这条迁移只放宽约束、只新增分支、
只加一个新函数，对还没有 v3 代码的部署完全是 no-op。

```bash
# DATABASE_URL 从 Railway worker 的变量里取，去掉 query string
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f apps/marketing/supabase/migrations/20260907143000_geo_kb_v3.sql
```

`--single-transaction` 不是可选项。不带它时 psql 逐条自动提交，而
`marketing_geo_publish_kb_v3` 是本文件里唯一一个**新建**的 SECURITY DEFINER 函数：
`create` 提交的那一刻它按 PostgreSQL 默认 ACL 就是 `PUBLIC` 可执行的，回收权限的
`revoke` 在两百行之后。正常跑完当然没问题（跑完之后 anon/authenticated 都没有
EXECUTE，见下面「冒烟」那条 ACL 断言），但连接在这两条之间断掉，暴露就留下了。
包进一个事务，撕裂的应用什么也不会留下。本文件没有 `CONCURRENTLY`、没有 `VACUUM`，
单事务能整份跑完。

（同样的窗口在 0004/0005/0006/0007 和 20260831034706 里都存在——那是仓库既有的
部署习惯，不是这份迁移引入的。这里先把新的一份关上。）

全文幂等：每个 `add constraint` 前都有 `drop constraint if exists`，函数一律
`create or replace`，`drop not null` 对已经可空的列是 no-op。跑两遍和跑一遍结果相同
（集成测试里有一条用例专门断言这一点，连 `pg_get_constraintdef` 的文本都逐条对比）。

## 它拆掉了哪些拦截点

按「不改的话 v3 会死在哪」排列：

| # | 位置 | v3 原本会怎么死 | 这条迁移怎么做 |
|---|---|---|---|
| 1 | `marketing_geo_kb_drafts_schema_version_check` | 23514，存不进 v3 草稿 | 允许 v3 |
| 2 | `marketing_geo_kb_snapshots_schema_version_check` | 同上 | 允许 v3 |
| 3 | `marketing_geo_draft_v2_shape` | 前件恒假，对 v3 **空洞通过**，等于没校验 | v2 那条原样不动，另加 `marketing_geo_draft_v3_shape`：payload 的 `schemaVersion` 必须与列一致，`generationInput`/`review`/`runRef` 必须是对象，且**不得含 `profileCopy`** |
| 4 | `marketing_geo_snapshot_v2_requires_prepared` | `(v2)=(prepared_id not null)` 对带候选的 v3 求值为 `false=true` | 左侧放宽为 v2 或 v3；v1 仍不得带候选 |
| 5 | `marketing_geo_kb_prepared_candidates_candidate_check` | 候选 v3 无分支 | 加 v3 分支，上限 2359296 |
| 6 | `marketing_geo_snapshot_contexts_context_check` | context v3 无分支 | 加 v3 分支，上限 262144（v3 的 context 是薄的，不含事实） |
| 7 | `marketing_geo_kb_generations_result_check` | 只含提问集的 result、知识 result v2 都无分支 | 加 `marketing-geo-question-generation-result.v1`（393216）与 `marketing-geo-knowledge-generation-result.v2`（2097152） |
| 8 | `marketing_geo_kb_snapshots.question_set` / `question_set_hash` 均 `not null` | 无提问集的版本存不下 | 两列改可空，另加 `marketing_geo_snapshot_question_set_pairing`：两者要么都空要么都不空，且 v1/v2 快照仍必须非空 |
| 9 | 草稿/快照 payload 上限 393216 | v3 payload 放不下 | 按 `schema_version` 分档：v1/v2 保持 393216；v3 总量 1048576，另加 `knowledge ≤ 524288`、`review ≤ 131072` 两个分项预算 |
| 10 | 候选表 `generation_id uuid not null unique` | v3 候选由发布铸造、同一 run 可发布多次，一对一身份不成立 | 改可空、去掉 UNIQUE（复合 FK 保留：它是 MATCH SIMPLE，`generation_id` 为 NULL 时自动跳过，v1/v2 候选仍照旧被校验） |
| 11 | `marketing_geo_generation_input_current` | 无条件要求草稿有合法 `profileCopy`，v3 没有 → **每一条 v3 生成永远 `input_stale`** | 加 v3 分支：改校验 `generationInputHash` 等于草稿 `runRef` 的值，且 `generationInput.profileRef` 仍指向网站当前已确认 Profile 快照（id / revision / content hash 三项）。v1/v2 路径逐字不变 |
| 12 | `marketing_geo_save_kb_draft` | 拒绝把带 `profileCopy` 的草稿存成没有的，v2→v3 升不上去 | `p_schema_version='marketing-geo-kb.v3'` 时豁免这一条（v2 存 v2 仍然拒） |
| 13 | 同上 | 审阅期间 `generationInput` 没有只读保护 | 新增 outcome **`generation_input_locked`**（见下节） |
| 14 | `marketing_geo_knowledge_input_valid` | 钉死 7 键含 `profileCopyHash` + input schema v1 → v3 claim 永远 `conflict` | 加 v2 分支：键集换成 `generationInputHash`（仍是恰好 7 键，两个分支各自钉全量键） |
| 15 | 同上，`receiptId` 正则 | 版本位钉 `[1-5]`，**会拒掉全部 UUIDv8** | v2 分支改用不钉版本位的正则（见下节） |
| 16 | `marketing_geo_knowledge_result_valid` | narrative/result 钉 v1 | 加 v2 分支；narrative v2 **不钉键数、只钉必需键存在**（见下节） |
| 17 | `marketing_geo_finish_generation` roles 分支 | `p_result->>'profileCopyHash' = input->>'profileCopyHash'` 两边都 NULL 时求值为 NULL → `invalid_result`，**roles 在 v3 一条也发不出** | 改 `is not distinct from` |
| 18 | 同上 questions 分支 | 必定插入候选、且要求 result 是候选 v1/v2 | 加 v3 分支：只校验提问集 result，**不插候选** |
| 19 | 发布 | `marketing_geo_freeze_prepared_kb` 对 v3 两条不成立 | 新增 `marketing_geo_publish_kb_v3` |
| 20 | `marketing_geo_freeze_kb` :403 | `payload ? 'profileCopy'` 闸门对 v3 是**开的**，一路跑到 INSERT 才因 CHECK 炸出不透明的 23514 | v3 草稿直接返回 `context_required` |

### 清单之外另外发现并处理的三处

- **`marketing_geo_freeze_kb_with_context` 有一模一样的洞**：它钉 context v1，但 `p_schema_version`
  取自草稿自己的 `schema_version`，所以 v3 草稿同样能一路跑到 INSERT，再死在
  `marketing_geo_snapshot_v2_requires_prepared` 上。已一并返回 `context_required`。
- **`marketing_geo_kb_snapshots` 也需要 v3 形状约束**：清单只要求给草稿加，但快照 payload 走的是
  另一条写入路径。已加 `marketing_geo_snapshot_v3_shape`（同样禁 `profileCopy`）。
- **发布 RPC 里我自己写出了一遍同类的 NULL 塌陷**：判断 questionSet 可用/不可用的两个布尔量最初用
  `=` 比较，遇到既不是 v2 契约、也不是 unavailable 标记的畸形提问集时两个量都是 NULL，
  `NULL = NULL` 还是 NULL，整条 OR 链求值为 NULL，plpgsql 的 IF 把它当假——畸形候选会被**发布**
  而不是被拒。集成测试当场抓到。现在两个量都用 `coalesce(...)` + `is not distinct from`，
  恒为布尔。`candidateId` 的正则同理加了 `coalesce`，否则缺字段会带着 NULL 主键走到 INSERT。

## 三个需要单独记住的判断

**`generation_input_locked`（新 outcome）。** `marketing_geo_save_kb_draft` 现在会拒绝这样一次保存：
既有草稿是 v3、既有 `runRef.runId` 非空（也就是有 run 正在进行）、而新 payload 的
`runRef.generationInputHash` 与既有不同。审阅期间 `generationInput` 只读——否则 Owner 的逐条决定
会被归因到它根本不是针对的那份输入上。review 与 knowledge 照常可写。S1 阶段 `runId` 恒为 null，
这道闸门是**休眠**的；S4 上 runs 表以后才真正生效。调用方要把这个新值加进 outcome 处理。

**UUIDv8 与 `[1-5]`。** input v1 的 receiptId 正则把 RFC 4122 版本位钉成 `[1-5]`。这个仓库里
website / profile / receipt 的标识符是 **UUIDv8**（版本位是 8），所以那条正则会拒掉每一个真实的
v3 receipt 引用，却能放过手写的 v4 测试 fixture——这正是这类 bug 长期不被发现的原因。
v2 分支只钉十六进制形状和短横线，不钉版本位。

**narrative v2 不钉键数。** v1 钉 narrative 恰好 6 键。narrative v2 多了 `canonicalQuestions`
（事实也改成带 qualifiers 的三元组），键数不是 6。在库里钉一个数字，等于把 TypeScript 契约冻结在
上线那天的样子；改成钉必需键存在（`schemaVersion,entity,facts,qa,comparisons,scope`），
这也正是那个数字原本想表达的东西。synthesis input v2 同理。

## `marketing_geo_publish_kb_v3` 为什么不复用冻结

`marketing_geo_freeze_prepared_kb` 有两条规矩对 v3 不成立：它把候选的 `questionSet` 原样写进
`question_set` 列（v3 可以没有提问集），并且对候选整体跑 `generation_input_current`（候选的形状
不是生成输入的形状）。所以 v3 走独立 RPC。

它绑定的是这些东西：候选自哈希（`candidateHash` 覆盖除自己以外的全部字节，且与调用方传入的一致）、
payload 哈希等于 `baseDraftHash`、context 自哈希、context 的 `payloadHash`/`kbId`/`candidateId`/
`targetHost` 与候选和本知识库一致、候选的 `generationInputHash` 等于**当前草稿** `runRef` 的值
（对不上是 `input_stale`，不是 `candidate_mismatch`——它不是伪造，是过期）。

**幂等键不是 context_hash。** 每次发布都铸一个新的 `candidateId`，这个 id 在 context 里，所以
context 哈希每次都不同——拿它当幂等键，等于让「连点两次发布」产出两个版本。真正定义一个 v3 版本的
是 payload 摘要 + 提问集摘要（审阅决定和生成输入都在 payload 里）。同内容二次发布返回既有版本、
`reused_existing=true`、不铸新候选行。

**重放是读，不回拨指针。** 和 `marketing_geo_freeze_prepared_kb` 一致：命中既有版本时不会把
`current_frozen_snapshot_id` 挪回旧版本。代价是「改回上一版内容再发布」会返回那个旧版本、但当前版本
指针不动——把某个历史版本重新设为当前，需要一个显式的动作，本切片没做。

**提问集三态是显式的。** `questionSet` 只接受两种形状：v2 契约本身，或
`{status:'unavailable', reason:...}`。两者都不是就是 `candidate_mismatch`。unavailable 时
`question_set` 与 `question_set_hash` 都写 null，而 context 的 `questionSetHash` 仍是那个
unavailable 标记的哈希（也就是哨兵值）——「没有提问集」和「没去看」必须能区分。

## 没做的事

- 发布**不回写草稿**。设计稿 §10 提到「发布 RPC（含幂等与写回草稿）」，本迁移的返回签名里没有草稿字段，
  也没有写回。发布后草稿与已发布版本的 review 一致这一条，目前靠调用方保证。
- 没有 `marketing_geo_kb_runs` / `run_operations`（S4）。
- 没有网站证据观察库（S2）。
- 消费者读取路径（`kb-complete-read` / `brief-facts` / `kb-versioned-read` 等）是 TypeScript 侧的事，
  不在这条迁移里。**在它们接受 payload v3 + context v3 + 空提问集之前，不要给任何生产站点升 v3**——
  否则 Brief 会静默断掉。

## 冒烟

```sql
-- 1. 六个约束都放开到 v3
select conname, pg_get_constraintdef(oid) from pg_constraint where conname in (
  'marketing_geo_kb_drafts_schema_version_check',
  'marketing_geo_kb_snapshots_schema_version_check',
  'marketing_geo_snapshot_v2_requires_prepared',
  'marketing_geo_snapshot_contexts_context_check',
  'marketing_geo_kb_prepared_candidates_candidate_check',
  'marketing_geo_kb_generations_result_check');
-- 期望：每条定义里都出现 .v3（result_check 里是两个新 schema 名）

-- 2. 三列已可空，候选的 generation_id 唯一约束已移除
select table_name, column_name, is_nullable from information_schema.columns
 where table_schema='public'
   and (table_name,column_name) in (
     ('marketing_geo_kb_snapshots','question_set'),
     ('marketing_geo_kb_snapshots','question_set_hash'),
     ('marketing_geo_kb_prepared_candidates','generation_id'));
-- 期望：三行都是 YES
select count(*) as leftover from pg_constraint
 where conname='marketing_geo_kb_prepared_candidates_generation_id_key';
-- 期望：0

-- 3. 历史行一行没动（跑迁移前后各跑一次，比对）
select schema_version, count(*), min(frozen_at), max(frozen_at)
  from public.marketing_geo_kb_snapshots group by schema_version order by 1;
select count(*) filter (where question_set is null) as null_question_sets
  from public.marketing_geo_kb_snapshots;
-- 期望：分组计数与时间边界不变；null_question_sets 在还没发布过 v3 时为 0

-- 4. 新函数只有 service_role 能执行，且是 SECURITY DEFINER + 空 search_path
select has_function_privilege('service_role','public.marketing_geo_publish_kb_v3(uuid,uuid,jsonb,text)','execute') as service_role,
       has_function_privilege('authenticated','public.marketing_geo_publish_kb_v3(uuid,uuid,jsonb,text)','execute') as authenticated,
       has_function_privilege('anon','public.marketing_geo_publish_kb_v3(uuid,uuid,jsonb,text)','execute') as anon;
-- 期望：t / f / f
select prosecdef, proconfig from pg_proc
 where oid='public.marketing_geo_publish_kb_v3(uuid,uuid,jsonb,text)'::regprocedure;
-- 期望：t / {"search_path=\"\"",TimeZone=UTC}

-- 5. 两个校验函数仍然谁都不能执行（含 service_role）——它们是纵深防御，只在 DEFINER 体内被调用
select has_function_privilege('service_role','public.marketing_geo_knowledge_input_valid(uuid,text,jsonb)','execute') as input_valid,
       has_function_privilege('service_role','public.marketing_geo_knowledge_result_valid(uuid,uuid,text,jsonb,jsonb)','execute') as result_valid;
-- 期望：f / f

-- 6. 没有留下重载（签名必须逐字不变）
select proname, count(*) from pg_proc
 where proname in ('marketing_geo_finish_generation','marketing_geo_generation_input_current',
                   'marketing_geo_knowledge_input_valid','marketing_geo_knowledge_result_valid',
                   'marketing_geo_save_kb_draft','marketing_geo_freeze_kb','marketing_geo_freeze_kb_with_context')
 group by proname order by 1;
-- 期望：每个都恰好 1
```

第 6 项值得单独盯：`create or replace` 保住签名就没事，一旦哪次改动动了参数类型，
旧签名会原地留下来，而调用哪一个由参数类型推断决定——库里两份逻辑并存，读代码看不出来。

## 回滚

**首选回滚代码，不动表。** 这条迁移全是放宽：多允许一个 schema 版本、多两个可空列、多一个函数、
多几个分支。把应用代码退回到不产出 v3 的版本，库端这些放宽就没有调用方，行为回到 v2。
这也是唯一安全的选择——只要生产上已经发布过一个 v3 版本，收紧约束就会让那些行连 `select` 都正常、
却在任何一次 `alter table ... validate` 或后续迁移里炸掉。

如果确认**从未产出过任何 v3 行**（下面这条查询三个计数全为 0），可以收回：

```sql
select
  (select count(*) from public.marketing_geo_kb_drafts where schema_version='marketing-geo-kb.v3') as drafts,
  (select count(*) from public.marketing_geo_kb_snapshots where schema_version='marketing-geo-kb.v3') as snapshots,
  (select count(*) from public.marketing_geo_kb_prepared_candidates
     where candidate->>'schemaVersion'='marketing-geo-prepared-candidate.v3') as candidates;
```

```sql
drop function if exists public.marketing_geo_publish_kb_v3(uuid,uuid,jsonb,text);
alter table public.marketing_geo_kb_drafts drop constraint if exists marketing_geo_draft_v3_shape;
alter table public.marketing_geo_kb_snapshots drop constraint if exists marketing_geo_snapshot_v3_shape;
alter table public.marketing_geo_kb_snapshots drop constraint if exists marketing_geo_snapshot_question_set_pairing;
-- 然后重放 20260831122810 与 20260905155607 这两个文件，把四个函数与其余约束恢复成 v2 形态。
```

`question_set` / `question_set_hash` 的 `not null` 与候选 `generation_id` 的 UNIQUE **不要**急着加回：
加回 NOT NULL 要全表扫描并持有 ACCESS EXCLUSIVE 锁，而且只要有过一行 v3 就会直接失败。
它们留着是无害的——v1/v2 的写入路径本来就永远填这些值，`marketing_geo_snapshot_question_set_pairing`
在没被 drop 之前也仍然替 v1/v2 强制非空。

---

# 网站证据观察库与 run 账本（迁移 20260907160000、20260907170000）

两份都是**纯新增**：新表、新函数、新权限，不改任何既有表、约束或函数。因此它们不像 v3 那份有
「放宽 / 收紧」的顺序问题，跑不跑都不影响已经上线的 v1/v2/v3 路径。顺序上放在 v3 之后即可，
两者之间没有依赖。

## 先决条件

- `20260907160000` 引用 `public.marketing_websites (id, user_id)`（0005）。
- `20260907170000` 引用 `public.marketing_geo_knowledge_bases (id, user_id)`（0006）。

外键在 `create table` 时就解析，所以先决条件缺失会**当场失败**，不会像 0006 那样留到第一次写入。

## 代码先上、SQL 后跑的窗口

同样安全，理由和上面一样：浏览器角色对这两组表没有任何权限，读写只走 service_role RPC，
表或函数不在 schema cache 里返回 `PGRST205` / `PGRST202`，两个仓储都把它归为 `unavailable`。
证据观察库 `unavailable` 的含义是「去抓一次」，不是「这个页面没有证据」；run 账本 `unavailable`
的含义是编排层不动手，不是「这个操作没花过钱」。两个方向都是 fail-closed。

## 回滚

**首选回滚代码。** 没有调用方时这两组表就是静止的。真要收回（且确认没有任何一行是需要留存的证据）：

```sql
-- 观察库：先确认没有已发布快照的 evidenceRefs 指向它，那是另一份设计要回答的问题。
select count(*) as observations from public.marketing_website_evidence_observations;
select count(*) as runs from public.marketing_geo_kb_runs;
```

```sql
drop table if exists public.marketing_geo_kb_run_operations;
drop table if exists public.marketing_geo_kb_runs;
drop table if exists public.marketing_website_evidence_observations;
-- 两份迁移里的函数与 record/valid 辅助函数随之无用，可一并 drop；它们不被任何既有路径引用。
```

注意观察库与 run operations 都是 append-only（行级挡 update/delete，语句级挡 truncate），
所以「清空但保留表」这件事做不到，也不该做：删掉旧观察等于删掉旧版本快照引用的证据，
删掉 operation 行等于把一次可能已经计费的调用从账上抹掉。

# 知识库与 Website 的外键（迁移 `20260907190000_geo_kb_website_link.sql`）

## 先决条件

`0005_account_websites.sql`（`marketing_websites`）与 `0006_geo_knowledge_base.sql`
（`marketing_geo_knowledge_bases`）都已应用。这两张表都是既有表，本迁移不新建表。

## 顺序

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f apps/marketing/supabase/migrations/20260907190000_geo_kb_website_link.sql
```

它做四件事：给 `marketing_websites` 加一个三列唯一约束当外键目标、给
`marketing_geo_knowledge_bases` 加 `website_id` 列、按 `(user_id, canonical_site_key)`
回填、再装一个 `on delete restrict` 的外键（`not valid` 装、单独 `validate`）。

## 两个必须知道的锁事实

- 文件开头 `set lock_timeout = '3s'`。`marketing_websites` 是登录后几乎每个页面都读的
  Profile 注册表，ACCESS EXCLUSIVE 排在一个未关闭的读事务后面时，**排在它后面的每一条
  查询也要一起等**。实测：一个 8 秒的读事务能让不带 timeout 的 ALTER 卡 7 秒；带上之后
  最多等到 `lock_timeout` 的 3 秒就干净失败，`ON_ERROR_STOP` 停住，重跑即可——按 3 秒
  算你愿意让这张注册表停多久，这是这份文件里唯一由代码定的那个数（两份迁移文件开头都写的
  `'3s'`）。校验扫描本身不是问题（21 万行的唯一约束 104ms，本产品实际量级是个位数毫秒）。
- `not valid` + `validate` 拆开只在**逐条提交**（`psql -f` 不带 `--single-transaction`）
  时才真的缩短独占窗口；整份贴进 Supabase SQL Editor 的话，文件里所有锁都会持有到最后。
  这份文件很小，两种方式都可以，但别把注释里的保证扩大解释。

## 重跑

可以。文件顶部先 drop 依赖它的外键，再 drop 唯一约束——顺序反了会撞
`dependent_objects_still_exist`，而 `if exists` **不会**抑制依赖错误。这是全仓 16 份
迁移里唯一一份曾经不能重放的，已经修好。

## 回滚

```sql
alter table public.marketing_geo_knowledge_bases drop constraint if exists marketing_geo_kb_website_fk;
drop index if exists public.marketing_geo_kb_website_idx;
alter table public.marketing_geo_knowledge_bases drop column if exists website_id;
alter table public.marketing_websites drop constraint if exists marketing_websites_id_user_site_key;
```

**然后必须重放 `0006_geo_knowledge_base.sql` 里的 `marketing_geo_upsert_kb`（:138），把它
还原成不认识 `website_id` 的那一版。** 这份迁移在 :97-153 把那个函数整个换掉了，新函数体
里 `v_existing.website_id`（:130）、`set website_id = v_website_id`（:132）和插入列表
`(user_id, canonical_site_key, origin, host, website_id)`（:144-148）都硬引用了这一列。
只跑上面那四行，列没了、函数还在，`marketing_geo_upsert_kb` 会以
`column "website_id" ... does not exist` 失败——而它正是产品注册知识库的入口
（`apps/marketing/src/lib/geo-tools/kb-store.ts:836`）。也就是说：漏掉这一步，用来恢复
服务的回滚本身会让 GEO 知识库建不出来。上面那份 v2 回滚（:558）已经写着同样形状的一句，
这里照它办。

`website_id` 是新增列，删掉它不损失任何原有数据；它承载的信息（哪个 Website）在
`(user_id, canonical_site_key)` 里本来就有，回填就是照着这一对做的。
