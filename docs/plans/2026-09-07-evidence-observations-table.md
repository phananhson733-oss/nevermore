# `marketing_website_evidence_observations` 建表建议

日期：2026-09-07
基线：`origin/main@4a3c4100`
依据：`docs/plans/2026-09-07-geo-kb-redesign-design.md` 第 1.3 第 3 条、第 3 节末尾「抓取复用」三条、第 6 节数据模型表
配套代码：`apps/marketing/src/lib/geo-tools/kb-evidence-observations.ts`（仓储与新鲜度）、`kb-evidence-reuse.ts`（复用计划与闸门）、`kb-competitor-identity-cache.ts`（竞品身份缓存）

**这份文档不是迁移文件。** 迁移由另一位 agent 统一落到
`apps/marketing/supabase/migrations/`，这里只提供建表 SQL、约束、权限、触发器与 RPC 签名的建议原文，
写法照 `20260831122810_geo_kb_prepared_generations.sql` 与 `0005_account_websites.sql` 的惯例。

---

## 1. 这张表要保证什么

一次真实抓取 = 一行。行写进去就不再改，也不再删。

- **复用判据只看时间。** 同 `(website_id, kind, url)` 的最近一条观察在 TTL 内就复用；TTL 外重抓，
  即使 `body_hash` 与上一条相同也要写一条新行（新的 `observed_at`）。
- **不能用 `body_hash` 当复用判据。** 用「哈希没变所以更新一下时间」的写法，会把两个月前那份快照的
  观察时间刷成今天，于是一份两个月前的证据在界面上、在导出里、在 Brief 里都显示成今天观察的。
  旧版本的证据时间必须永远保持它当时的值 —— 这正是这张表存在的理由（设计稿 R8、第 6 节
  「旧版本的证据时间永远不被刷新改写」）。
- **写入者不止一个。** GEO 采集与 Profile 扫描都写这里；两边的 `structured` 形状并不相同。
- **闸门语义不变。** 每目标 4 次/小时（`crawl-gate.ts` 的 `CRAWL_TARGET_MAX`）不动；
  一次「更新知识库」对同一目标只开一次闸（由 `kb-evidence-reuse.ts` 的计划保证，不由这张表保证）。

---

## 2. 建表 SQL

```sql
-- Immutable record of what we actually observed, one row per real fetch.
--
-- Reuse is decided on TIME, never on body_hash. Confirming "nothing changed"
-- by comparing hashes and then touching a row would move a two-month-old
-- snapshot's observation time to today, and every downstream surface -- the
-- version card, the export, the Brief -- would then date that evidence today.
-- An observation is a statement about a moment; it is never edited, so a
-- re-fetch after the TTL appends a new row even when the bytes are identical.
--
-- Two producers write here: GEO collection and the Profile scan. Their
-- `structured` shapes differ and will keep differing, which is why that column
-- is checked for type and budget rather than for a shape.
create table if not exists public.marketing_website_evidence_observations (
  id            uuid        primary key default gen_random_uuid(),
  website_id    uuid        not null,
  user_id       uuid        not null,
  kind          text        not null
                            check (kind in ('own_page','competitor_page','robots','sitemap','llms','gsc','third_party')),
  -- For kind='gsc' this holds `property + window`, not a URL. See the
  -- marketing_website_evidence_gsc_url constraint below.
  url           text        not null check (char_length(url) between 1 and 2048),
  observed_at   timestamptz not null,
  status        text        not null check (status in ('ok','unavailable')),
  -- `rate_limited` is deliberately absent. A gate refusal is an observation of
  -- OUR quota, not of the target; recording it would let one busy minute
  -- suppress a real fetch for the whole TTL and would put a row in the
  -- evidence ledger that says nothing about the site.
  status_reason text        check (status_reason in
                              ('not_found','not_published','fetch_failed','blocked','timeout',
                               'invalid_response','partial_body','insufficient_evidence')),
  body_hash     text        check (body_hash ~ '^[a-f0-9]{64}$'),
  excerpts      jsonb       not null default '[]'::jsonb
                            check (jsonb_typeof(excerpts)='array' and octet_length(excerpts::text) <= 65536),
  structured    jsonb       not null default '{}'::jsonb
                            check (jsonb_typeof(structured)='object' and octet_length(structured::text) <= 65536),
  independence  text        check (independence in ('independent','self_submitted','syndicated','undetermined')),
  created_at    timestamptz not null default now(),

  -- The natural key from the design. Re-running an update inside one second
  -- cannot produce two rows for the same observation, and an append that
  -- repeats it is idempotent rather than an error.
  constraint marketing_website_evidence_natural_key
    unique (website_id, kind, url, observed_at),

  -- An unavailable observation carries no body and no content. Without this
  -- constraint a failed fetch could be stored with the previous run's excerpts
  -- and would read downstream as a successful observation.
  constraint marketing_website_evidence_status_shape check (
    (status = 'ok' and status_reason is null and body_hash is not null)
    or (status = 'unavailable' and status_reason is not null and body_hash is null
        and excerpts = '[]'::jsonb and structured = '{}'::jsonb)
  ),

  -- Independence is a third-party judgement only (design R6 / L2). Setting it
  -- on an own_page row would let self-published material claim independence.
  constraint marketing_website_evidence_independence_scope check (
    (kind = 'third_party') = (independence is not null)
  ),

  -- GSC has no URL. Its identity is the property plus the exact window, so the
  -- freshness lookup keys on the window and a different window is a different
  -- observation rather than a refresh of the old one.
  -- Shape: `<property>#YYYY-MM-DD..YYYY-MM-DD` (see geoEvidenceGscKey()).
  constraint marketing_website_evidence_gsc_url check (
    kind <> 'gsc'
    or url ~ '^[^#]{1,1024}#[0-9]{4}-[0-9]{2}-[0-9]{2}\.\.[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ),

  foreign key (website_id, user_id)
    references public.marketing_websites (id, user_id) on delete restrict
);
```

`body_hash` 对 `kind='gsc'` 的取值：返回行集合的规范 JSON 的 sha256
（用已有的 `public.marketing_canonical_jsonb_text`），这样「这一窗口的数据变了没有」仍可回答。

### 索引

```sql
-- The only hot read: latest observation for one (website, kind, url).
create index if not exists marketing_website_evidence_latest_idx
  on public.marketing_website_evidence_observations (website_id, kind, url, observed_at desc, id desc);

-- Owner-scoped listing for the version card and the export.
create index if not exists marketing_website_evidence_owner_idx
  on public.marketing_website_evidence_observations (user_id, website_id, observed_at desc, id desc);
```

刻意不建按 `observed_at` 的清扫索引：这张表**不做 TTL 清扫**。TTL 只决定「要不要重抓」，
不决定「行还留不留」；删掉旧行等于删掉旧版本快照引用的证据。保留策略若将来要做，
必须先确认没有任何已发布快照的 `evidenceRefs` 指向它，那是另一份设计。

---

## 3. RLS 与权限

照 `20260831122810` 的做法：**RLS 开 + 零 policy + 权限收紧**才是边界，policy 不是。
浏览器角色一条也读不到；服务端路由先验证 Supabase 用户，再用 service-role 走下面的 RPC。

```sql
alter table public.marketing_website_evidence_observations enable row level security;
revoke all on public.marketing_website_evidence_observations
  from public, anon, authenticated, service_role;
grant select on public.marketing_website_evidence_observations to service_role;
```

写入不给 `service_role` 表级 `insert`：所有写只能走下面的 RPC，
这样「未来任何写入者都必须先证明这个 website 属于这个 user」是结构性成立的，不靠调用方自觉。

---

## 4. append-only 触发器（行级 + 语句级两个）

行级挡 `update` / `delete`，语句级挡 `truncate` —— `truncate` 不触发行级触发器，
只写一个行级触发器就是留了一扇没锁的门。

```sql
create or replace function public.marketing_website_evidence_observations_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Website evidence observations are append-only (attempted %)', tg_op;
end;
$$;

drop trigger if exists marketing_website_evidence_immutable_row
  on public.marketing_website_evidence_observations;
create trigger marketing_website_evidence_immutable_row
  before update or delete on public.marketing_website_evidence_observations
  for each row execute function public.marketing_website_evidence_observations_immutable();

drop trigger if exists marketing_website_evidence_immutable_truncate
  on public.marketing_website_evidence_observations;
create trigger marketing_website_evidence_immutable_truncate
  before truncate on public.marketing_website_evidence_observations
  for each statement execute function public.marketing_website_evidence_observations_immutable();

revoke all on function public.marketing_website_evidence_observations_immutable()
  from public, anon, authenticated, service_role;
```

---

## 5. 投影函数

RPC 返回的 JSON 由一个函数统一构造，避免两个 RPC 各写一份、之后各自漂移。

```sql
create or replace function public.marketing_website_evidence_observation_record(
  p_row public.marketing_website_evidence_observations
) returns jsonb language sql stable set search_path = '' set timezone = 'UTC' as $$
  select jsonb_build_object(
    'schemaVersion','marketing-website-evidence-observation.v1',
    'observationId', p_row.id,
    'websiteId',     p_row.website_id,
    'kind',          p_row.kind,
    'url',           p_row.url,
    -- Rendered in exactly the spelling JS `toISOString()` produces.
    -- PostgreSQL's own timestamptz text is microsecond precision with a
    -- numeric offset (`2026-09-07T06:50:55.033741+00:00`); readers that
    -- compare against `new Date(v).toISOString()` reject that spelling, and
    -- this repo has already lost a whole cache to exactly that seam
    -- (crawl-cache.ts canonicalCapturedAt).
    'observedAt',    to_char(p_row.observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status',        p_row.status,
    'statusReason',  p_row.status_reason,
    'bodyHash',      p_row.body_hash,
    'excerpts',      p_row.excerpts,
    'structured',    p_row.structured,
    'independence',  p_row.independence
  )
$$;
```

---

## 6. 读 RPC

```sql
create or replace function public.marketing_website_read_latest_evidence_observation(
  p_user_id uuid, p_website_id uuid, p_kind text, p_url text
) returns table (outcome text, observation jsonb)
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_row public.marketing_website_evidence_observations;
begin
  perform 1 from public.marketing_websites w where w.id = p_website_id and w.user_id = p_user_id;
  if not found then outcome := 'not_found'; return next; return; end if;
  select o.* into v_row from public.marketing_website_evidence_observations o
    where o.website_id = p_website_id and o.user_id = p_user_id
      and o.kind = p_kind and o.url = p_url
    order by o.observed_at desc, o.id desc limit 1;
  if not found then outcome := 'none'; return next; return; end if;
  outcome := 'found';
  observation := public.marketing_website_evidence_observation_record(v_row);
  return next;
end;
$$;
```

| 分支 | 条件 | `outcome` | `observation` | TS 侧 |
|---|---|---|---|---|
| 站点不属于该用户或不存在 | `marketing_websites` 无匹配行 | `not_found` | null | `{ kind: "missing" }` |
| 该 `(kind, url)` 从未观察过 | 无匹配观察行 | `none` | null | `{ kind: "ok", value: null }` |
| 有观察 | 取 `observed_at desc, id desc` 第一条 | `found` | 投影 | `{ kind: "ok", value: observation }` |
| 其他（RPC 报错、行数不为 1、投影解析失败） | — | — | — | `{ kind: "unavailable" }` |

**新鲜度不在这里判。** 这个 RPC 只回答「最近一条是什么」；
TTL 判定在 `isObservationFresh()`，因为调用方在同一次更新里会用同一个 `now` 判很多个目标，
而且新鲜度是产品口径（设计稿第 3 节），会随 S2 调整，不该埋进 DDL。
（对照：`read_public_tool_crawl_cache` 把新鲜度放在库里，那是因为它跨用户共享、
必须防单台 serverless 的时钟漂移把过期项复活；这张表是 owner-scoped 的，
同一次更新用同一个时钟判断，两种取舍都成立但理由不同。）

---

## 7. 写 RPC

```sql
create or replace function public.marketing_website_record_evidence_observation(
  p_user_id uuid, p_website_id uuid, p_kind text, p_url text, p_observed_at timestamptz,
  p_status text, p_status_reason text, p_body_hash text,
  p_excerpts jsonb, p_structured jsonb, p_independence text
) returns table (outcome text, observation jsonb)
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_row public.marketing_website_evidence_observations;
begin
  perform 1 from public.marketing_websites w where w.id = p_website_id and w.user_id = p_user_id;
  if not found then outcome := 'not_found'; return next; return; end if;

  -- An observation time is when we looked. A caller that hands us a future
  -- timestamp would suppress every re-fetch until that time arrives, and one
  -- from the distant past would be appended below rows that are already
  -- there and never be read again.
  if p_observed_at > now() + interval '2 minutes'
     or p_observed_at < now() - interval '30 days' then
    outcome := 'invalid'; return next; return;
  end if;

  insert into public.marketing_website_evidence_observations (
      website_id, user_id, kind, url, observed_at, status, status_reason,
      body_hash, excerpts, structured, independence)
    values (p_website_id, p_user_id, p_kind, p_url, p_observed_at, p_status, p_status_reason,
      p_body_hash, coalesce(p_excerpts,'[]'::jsonb), coalesce(p_structured,'{}'::jsonb), p_independence)
    on conflict (website_id, kind, url, observed_at) do nothing
    returning * into v_row;
  if found then
    outcome := 'recorded';
    observation := public.marketing_website_evidence_observation_record(v_row);
    return next; return;
  end if;

  -- Same natural key already present: the append is idempotent, and the caller
  -- gets the row that is actually stored rather than the one it tried to write.
  select o.* into v_row from public.marketing_website_evidence_observations o
    where o.website_id = p_website_id and o.kind = p_kind
      and o.url = p_url and o.observed_at = p_observed_at;
  outcome := 'duplicate';
  observation := public.marketing_website_evidence_observation_record(v_row);
  return next;
exception when check_violation or invalid_text_representation or not_null_violation then
  outcome := 'invalid'; return next;
end;
$$;
```

| 分支 | 条件 | `outcome` | TS 侧 |
|---|---|---|---|
| 站点不属于该用户 | `marketing_websites` 无匹配行 | `not_found` | `{ kind: "missing" }` |
| 观察时间不合理 | 超前 > 2 min 或落后 > 30 天 | `invalid` | `{ kind: "invalid", code: "invalid_observed_at" }` |
| 列约束不通过 | kind / status 配对 / independence 作用域 / GSC url 形式 / 预算 | `invalid` | `{ kind: "invalid", code: "invalid_observation" }` |
| 追加成功 | 自然键此前不存在 | `recorded` | `{ kind: "ok", value: observation }` |
| 自然键重复 | 同 `(website_id, kind, url, observed_at)` 已存在 | `duplicate` | `{ kind: "ok", value: 已存在的那行 }` |
| RPC 报错 / 返回行数不为 1 / 投影解析失败 | — | — | `{ kind: "unavailable" }` |

`duplicate` 与 `recorded` 在 TS 侧都是成功：调用方要的是「库里现在有这条观察」，
而不是「这次插入是不是我干的」。两者的区分留在 `outcome` 里供日志使用。

### 授权

```sql
revoke all on function
  public.marketing_website_evidence_observation_record(public.marketing_website_evidence_observations),
  public.marketing_website_read_latest_evidence_observation(uuid, uuid, text, text),
  public.marketing_website_record_evidence_observation(uuid, uuid, text, text, timestamptz, text, text, text, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function
  public.marketing_website_read_latest_evidence_observation(uuid, uuid, text, text),
  public.marketing_website_record_evidence_observation(uuid, uuid, text, text, timestamptz, text, text, text, jsonb, jsonb, text)
  to service_role;
notify pgrst, 'reload schema';
```

---

## 8. `structured` 里放什么

设计稿第 6 节列的是：JSON-LD 类型、FAQ 对、hreflang、robots 规则、noindex / nosnippet、署名。
库里只检查 `jsonb_typeof = 'object'` 与 64 KiB 预算，**不检查形状**，原因有两个：
两个写入者（GEO 采集、Profile 扫描）的形状本来就不同；表是 append-only 的，
今天钉死的形状会让明天的行与今天的行不能共存于同一个解析器。

形状约束放在 TS 侧 `kb-evidence-observations.ts`：已知键逐个校验，未知键原样保留
（zod `.catchall(z.unknown())`）。已知键：

| 键 | 类型 | 说明 |
|---|---|---|
| `jsonLdTypes` | `string[]` | 页面上出现的 JSON-LD `@type` |
| `faqPairs` | `{ question, answer }[]` | FAQPage 的问答对 |
| `hreflangLocales` | `string[]` | hreflang 声明的 locale |
| `robotsRules` | `string[]` | robots.txt 的原文规则行（含 AI 爬虫段） |
| `noindex` / `nosnippet` | `boolean` | meta robots / X-Robots-Tag 观察结果 |
| `maxSnippet` | `string` | 刻意是字符串：这一列的 JSON 里不放 number（与 GEO payload 同口径） |
| `authorship` | `{ authors[], reviewers[], datePublished }` | R11 的署名观察，只记「有没有」，不判真伪 |

---

## 9. 这份建议刻意不做的事

1. **不做 TTL 清扫。** 见第 2 节索引小节。
2. **不给 `service_role` 表级写权限。** 写只能走 RPC。
3. **不在库里判新鲜度。** 见第 6 节。
4. **不接受 `rate_limited` 作为 `status_reason`。** 见第 2 节 SQL 注释。
5. **不与 `marketing_geo_knowledge_bases` 建关联。** 观察属于 website，不属于某一个知识库；
   快照上下文用 `observationId` 引用它。
6. **不改 `public_tool_crawl_cache`。** 竞品身份与站外 SERP 继续用那张表的既有接口
   （命名空间 `geo-competitor-identity`，TTL 24 h，跨用户共享），见 `kb-competitor-identity-cache.ts`。
