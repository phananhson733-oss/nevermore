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
