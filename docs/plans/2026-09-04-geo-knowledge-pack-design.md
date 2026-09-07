# GEO Knowledge Pack Design

Date: 2026-09-04
Baseline: `origin/main@264068cf18cbdb8c6729562ba38c9660f49997e5`
Status: Approach A implemented; release operations are tracked separately

## Decision

The frozen GEO customer view will display a dedicated, evidence-bound
`marketing-geo-knowledge-pack.v1` companion object plus the existing complete
question set. It will not reveal the mutable Product Profile, Profile-copy
fields, competitor identity management, role-review records, receipt IDs,
generation IDs, schema IDs, version hashes, or other internal lineage panels.

The reference JSON supplied by the owner defines the desired information
coverage, not factual content. Example names, prices, dates, URLs, claims,
competitor attributes, and generated machine files in that attachment are
untrusted examples and must never be copied into a real customer's pack unless
the exact statement is supported by the frozen evidence selected for that pack.
The unrelated Internal Link Audit handoff is not an input or authority for this
feature.

## User outcome

After one GEO generation flow, the customer sees only the current frozen GEO
knowledge in a consistent visual system:

1. Entity definition
2. Reliable facts
3. Q&A knowledge
4. Competitor comparisons
5. Capabilities and boundaries
6. Evidence and trust
7. Machine-readable readiness
8. Coverage and gaps
9. Complete question set

An unavailable source is rendered as unavailable, never as an empty success or
zero. Internal identifiers remain stored for integrity but are never rendered
in the customer view, including inside disclosures.

## Why this is a companion object

`marketing-geo-kb.v2` is the editable GEO input and
`marketing-geo-snapshot-context.v2` is question-generation authority. Neither
contract contains customer Q&A answers, neutral comparison rows, scope
boundaries, or machine-readable observations. Expanding either strict schema in
place would reinterpret immutable v2 history.

The pack therefore has its own schema and hash. A prepared candidate v2 binds:

```text
saved GEO payload
+ selected evidence
+ complete question set
+ GEO knowledge pack
+ generator versions
```

The existing snapshot keeps its payload and question-set identity. Its
`prepared_id` points to the immutable candidate containing the pack. New reads
may load that exact companion; old candidates remain valid and return
`knowledgePack: null`.

This is compatible with the approved independent GEO v3 direction. The pack
consumes a normalized evidence bundle rather than reading current Product
Profile state. A future v3 writer can supply website-owned evidence receipt
references without changing the pack contract or customer renderer.

## Permissions and non-goals

This design approval does not itself authorize commit, push, PR, deployment,
production migration, production provider calls, production crawl, or credit
consumption. Each external release or billable operation requires its own
explicit instruction. Deploying the code and additive schema does not imply a
production crawl or a live provider generation.

It does not:

- recreate a Product Profile panel in GEO;
- expose competitor identity administration;
- publish or modify customer websites;
- generate `llms.txt`, JSON-LD, robots rules, sitemap entries, or comparison
  pages on behalf of the customer;
- claim that a proposed file exists;
- use attachment example claims as data;
- rewrite historical frozen snapshots;
- make Profile and GEO synchronize automatically.

## Contracts

### Evidence bundle

`marketing-geo-knowledge-evidence.v1` is a bounded, immutable input to pack
synthesis. Each item contains:

- a stable internal evidence ID;
- kind: own-site page, competitor page, robots, sitemap, llms.txt, or GSC;
- accepted exact GEO facts may also enter as `accepted_fact`; unlike a crawl
  source they may have no public URL, observation time, or body hash and must
  never be presented as observed public evidence;
- exact normalized public URL;
- observation time and body hash when available;
- availability and typed reason;
- bounded visible excerpts and bounded structured observations;
- no cookies, headers, credentials, or raw provider response metadata.

Limits:

- own-site HTML pages: at most 8;
- own-site machine resources: exactly the bounded set `/robots.txt`,
  `/sitemap.xml`, and `/llms.txt`;
- confirmed competitors: at most 5;
- competitor pages: at most 2 per competitor;
- body: at most 512 KiB per response;
- retained excerpt: at most 1,200 Unicode code points;
- total evidence sources: at most 32;
- total serialized bundle: at most 1 MiB;
- one page fetch: at most 8 seconds;
- whole evidence collection: at most 70 seconds.

Only same-host HTTPS-preserving redirects are accepted. HTML pages retain the
normalized final URL. The standard machine endpoints retain their fixed
identity, so a redirect is accepted only when its normalized final URL is still
that exact `/robots.txt`, `/sitemap.xml`, or `/llms.txt` endpoint. Existing
SSRF-safe, DNS/IP-pinned public transport and crawl gates remain the network
boundary.

### Narrative synthesis

`marketing-geo-knowledge-narrative.v1` is the single evidence-bound model
output. It may produce only:

- three entity definition lengths;
- audience, evidence-supported founding metadata, and disambiguation wording;
- typed atomic-fact statements based on selected evidence;
- direct Q&A answers and optional expansion text;
- neutral competitor comparison rows and a short verdict;
- capabilities, non-capabilities, human-required steps, and misconceptions.

Every generated item carries one or more evidence references. References must
exist in the exact input bundle. Numeric literals in generated text must appear
verbatim in at least one referenced evidence excerpt or an accepted exact GEO
fact. Competitor output is limited to already confirmed competitors. A model
may classify or summarize evidence; it cannot upgrade inferred text into
observed evidence.

The model is called once. The durable attempt ledger retains the existing
states: not dispatched, response received, and `outcome_unknown`. An unknown
delivery is never retried automatically.

### Customer knowledge pack

The final `marketing-geo-knowledge-pack.v1` contains:

```text
meta
entity
facts[]
qa[]
comparisons[]
scope
evidence
machine
coverage[]
sourceCatalogue[]
contentHash
```

Every content module is a discriminated `available | partial | unavailable`
state. `partial` must include a customer-readable limitation. `unavailable`
must include a typed reason and carries no fabricated value.

`meta` stores generation time for temporal integrity plus scan time, market,
language, and content counts. Following the explicit customer requirement to
remove source/version/measurement summaries, the customer renderer does not
display this metadata; it also does not display generation time,
schema versions, hashes, receipts, generators, or phase IDs.

The pack's internal source catalogue is available to the renderer only through
customer-safe source labels, public URLs, and observation dates. Internal IDs
are used to resolve links but are not displayed.

## Collection

### Own site

The collector starts with the exact saved GEO target URL. From that page it
selects same-host links deterministically using these content intents:

- about/company;
- pricing/plans;
- product/features;
- integrations;
- documentation/help;
- FAQ;
- changelog/releases.

Selection is stable: canonical URL, intent priority, then lexical URL order.
Unknown pages do not displace known intents. Duplicate canonical URLs are
removed. The target page is always first.

For each accepted HTML page the collector retains bounded visible segments,
link intent, title, description, language, canonical URL, and supported JSON-LD
types. Scripts, styles, hidden content, embedded frames, and instructions in
page copy are data only and cannot control the agent.

Machine resources are observed separately. The pack reports what is present:

- JSON-LD types and source pages;
- whether an accessible `/llms.txt` exists and its public URL;
- robots rules relevant to common AI crawlers plus sitemap declarations;
- sitemap URL count and whether observed knowledge pages are listed;
- observed hreflang locale mappings.

The UI never displays a generated replacement file as though it were live.

### Confirmed competitors

Only competitors explicitly confirmed in the saved GEO payload are eligible.
The collector fetches the homepage and at most one same-host pricing/product
page. It retains exact public excerpts and observation time. The model may
normalize comparable rows only when both sides have support. A missing rival
price is `unavailable`, not `0`, `free`, or an estimate. The comparison uses
neutral language and includes the check date and source links.

### Existing evidence reuse

The adapter reuses accepted GEO facts, the exact source receipt catalogue,
confirmed competitor captures, and frozen question-generation evidence. It
does not refetch a URL already present in the current collection. When the
website-owned shared-evidence runtime is cut over, the same adapter consumes
its selected receipt refs so Profile and GEO do not duplicate collection or
credits.

## Assembly and freeze flow

```text
saved GEO draft
    |
    +-- selected current evidence receipt
    |
    +-- bounded customer knowledge evidence collection
            |
            +-- exact model evidence projection persisted in generation input
                + full collection committed by its content hash
            |
            +-- one knowledge narrative model attempt
                    |
                    +-- strict parser and evidence gates
                            |
question generation -------+-- pack assembler
                                    |
                                    +-- prepared candidate v2
                                            |
                                            +-- explicit freeze
```

The order in the one-click flow becomes:

```text
save → collect sources → propose/review roles → generate knowledge narrative
→ prepare questions + pack → explicit freeze
```

Save, evidence reuse, deterministic assembly, read, and freeze do not invoke a
model. A fresh one-click v2 run makes three separately accounted, potentially
billable model attempts: role proposal, knowledge narrative, and question
generation. Each uses the existing durable ledger; the knowledge attempt is
not folded into either existing charge and a recovered successful attempt is
not dispatched again.

## Error and availability semantics

- `unsupported_language` blocks a new one-click generation before collection or
  billing because the same run still requires role/question synthesis. It does
  not hide or reinterpret an existing frozen pack or question set. A future
  pack-only refresh would need its own versioned candidate contract rather than
  persisting an orphan knowledge result that the customer cannot freeze or see.
- `evidence_unavailable` means the collector could not provide the minimum own
  site basis before dispatch; no model call occurs.
- `evidence_partial` permits a partial pack when at least one own-site source is
  available; missing modules carry explicit limitations.
- `generation_unavailable` is a valid pack-contract state for an explicitly
  assembled partial result. The current one-click flow requires an owned,
  succeeded durable knowledge generation before it can prepare and freeze a
  new candidate, so a refused or failed narrative stops that new run before
  questions/freeze and leaves the previously frozen customer content intact.
  A future partial-generation flow would need an explicit versioned candidate
  path rather than treating a failed or unknown attempt as a successful pack.
- `outcome_unknown` preserves the attempt and blocks silent retry. If this
  prevents a narrative module from being assembled, that module may retain the
  same typed reason, rendered in customer language as an uncertain generation
  outcome rather than as a source observation.
- stale draft hash, evidence selection, competitor confirmation, or narrative
  input makes preparation fail closed with `context_stale`.
- malformed or oversized persisted pack data makes the complete read
  unavailable; it never falls back to current mutable Profile data.

### Recovery and resume

The client persists the exact request identity before dispatch. If the browser
loses the knowledge response, reload restores a customer-safe recovery state;
the read action uses the original idempotency key instead of creating another
model call. A recovered succeeded knowledge generation resumes at questions
and freeze; it does not repeat roles or knowledge. A current frozen version is
not a resume and an explicit regeneration intentionally starts a new run.

An `outcome_unknown` attempt remains read-only and inspectable. Pressing the
main action or reloading never retries it. New provider work requires changed,
saved input or explicitly changed persisted source evidence. Recovery panels
show only the operation and customer-readable state; request keys, generation
IDs, draft versions, hashes, and raw provider reasons stay out of the DOM.

## UI and visual language

The renderer reuses `GeoKbSection` for eight pack modules plus the complete
question set, nine top-level panels in total, and the existing inner-card
recipe:

```text
rounded-[10px]
border border-brand-border-card
bg-brand-bg
p-4 sm:p-5
```

Typography remains on the existing scale:

- section heading: owned by `GeoKbSection`;
- item heading: 15px semibold;
- body/readout: 14px, relaxed line height;
- table body: 13px, relaxed line height;
- metadata/source labels: 12px, secondary color.

No bare paragraph element may rely on a smaller parent font because Marketing's
global `p` rule overrides inherited table typography. Table sublines use block
`span` elements or an explicit local text size.

Entity and scope use field/readout rows. Facts and evidence use item cards. Q&A
and comparisons use desktop tables that become labelled cards below `sm`.
Machine coverage and knowledge gaps use compact status rows, not raw JSON.
Long URLs wrap and open safely in a new tab. Focus states, semantic heading
depth, captions, lists, and table headers remain accessible.

Customer-facing labels are Chinese-first. Necessary English content, URLs,
proper nouns, locale tags, schema.org types, and question text remain in their
original language.

## Customer rendering rules

Allowed:

- current pack content;
- customer-readable source label, URL, and observation date;
- available/partial/unavailable state and limitation;
- complete questions, their mode, and calibration state.

Forbidden, even under `<details>`:

- Product Profile fields or Profile-copy explanation;
- competitor identity and alias administration;
- role review/proposal records;
- raw receipt, generation, candidate, snapshot, or evidence IDs;
- hashes, schema versions, internal phase numbers, review implementation state;
- raw model prompts/responses;
- hidden legacy source/version panels.

The same rule applies outside the frozen content subtree: recovery controls may
name the operation and its customer-readable state, but never render request
keys, generation IDs, draft versions, or those values in `data-*` attributes.
Historical V1 freezes may show their stored GEO questions, but the old
expandable Product/Profile archive and revision identity are not mounted in the
customer page.

## Compatibility

- Prepared candidate v1 remains readable and freezes exactly as before.
- Prepared candidate v2 adds `knowledgePack` and its hash to candidate identity.
- Historical snapshots whose prepared candidate is v1 return `knowledgePack:
  null` and continue showing the complete question set.
- New customer packs never read today's Product Profile.
- Visibility and the Brief/Draft handoff accept the exact frozen v1/v2
  question-set union. V2 is validated with its full stored provenance before a
  public consumer projection removes v2-only provenance fields; frozen data is
  never rewritten to that projection.
- V2 question readiness uses the English `questionLabel` rather than the
  localized display label, preserving the supported English question contract.
- The browser acceptance path covers frozen v2 → Visibility → Brief → Draft;
  the knowledge pack is additive and those consumers continue using the exact
  frozen questions and context.
- No existing v1/v2 snapshot is rewritten or backfilled with inferred content.

## Production migration

The forward-only companion migration is
`apps/marketing/supabase/migrations/20260905155607_geo_knowledge_pack_companion.sql`.
It adds `knowledge_pack` to the durable generation kinds, accepts prepared
candidate v2 alongside v1, and installs strict input/result/candidate validators
and size caps. Owner-scoped security-definer RPCs perform claim, finish, and
freeze operations. Generation/key/candidate tables keep RLS enabled with no
browser policies; `anon` and `authenticated` have no table or RPC access, while
`service_role` receives only the required reads and RPC execution, not direct
writes. Reapplying the migration is idempotent and never rewrites existing
generation, candidate, snapshot, or context bytes.

## Verification

Contract/unit:

- strict schema, byte/count/depth limits, unique IDs, valid URLs and times;
- source references and confirmed competitor membership;
- numeric-claim support;
- deterministic hashes and stable page selection;
- partial/unavailable states and no zero fabrication;
- machine observations distinguish absent, unreachable, and present;
- old prepared candidates remain readable.

Generation:

- exact persisted input precedes the model attempt;
- one dispatch at most;
- `outcome_unknown` is not retried;
- stale input cannot be assembled or frozen;
- attachment/example claims are absent from fixtures unless supplied as exact
  evidence.

Component:

- all eight pack modules plus the complete question set render from an
  available fixture;
- a partial fixture renders limitations without empty-success copy;
- Product Profile, competitor identity, roles/review, raw sources, versions,
  hashes, and internal IDs are absent from the entire DOM;
- question-policy text is 13px and does not use globally styled bare `p` tags;
- desktop and mobile table/card structures retain labels and source links;
- English and Chinese labels both work.

Integration/build:

- focused Vitest tests;
- restored production-backup SQL rehearsal, including repeat application,
  validator/constraint checks, preserved row counts, RLS, and grants;
- browser coverage for a lost successful response, durable resume without a
  duplicate charge, and a true `outcome_unknown` that is never retried;
- browser coverage for the v2 Visibility → Brief → Draft downstream chain;
- Marketing typecheck and lint;
- Marketing production build;
- repository secret scan;
- no database or production operation without separate authorization.

## Acceptance criteria

- The frozen customer view shows the current evidence-backed GEO Knowledge Pack
  and complete question set in one consistent visual language.
- It never shows the original Product Profile or previously hidden internal
  identity/provenance panels, including in collapsed content.
- Unsupported or missing evidence is explicit; no factual claim is fabricated.
- The knowledge narrative uses one exact, durable, evidence-bound model attempt.
- New pack identity is immutable and historical v1/v2 reads remain exact.
- The typography defect in the question policy column is regression-tested.
