# Marketing Account Websites and Reusable Profiles Design

**Status:** Approved by the user on 2026-08-27. As of 2026-08-28 the full
consumer matrix in this design is locally implemented and freshly reverified.
Deterministic browser acceptance is green for GEO exact reference and the
connected Low Competition Keyword Finder import/reference paths. After the
light-theme language-switch contrast fix and a fresh production rebuild, the
complete provider-free Marketing Playwright suite passes 30/30. Feature unit,
Marketing SQL, changed-file lint, typecheck, docs, build, and secret/redaction
gates were rerun for the current worktree; only the broad `apps/marketing`
lint command still retains four unrelated baseline errors in untouched files.
The work remains uncommitted and unpublished.

**Baseline:** `origin/main` at `806c6e04c109ba57b18b4d1e331e13b3741e17ae`

**Implementation worktree:** `/Users/wzb/Code/nevermore/account-websites-20260827`

**Verification record:**
`docs/reviews/2026-08-27-marketing-account-websites-local-verification.md`

## 1. Permission and evidence ledger

The current request authorizes local implementation and local verification.
On 2026-08-27 the user explicitly selected option A: exempt this task from the
repository's default ChatGPT Pro external-review workflow and proceed with
Codex plus local subagents only. No source may be uploaded externally.

Allowed in this task:

- read the Nevermore repository and the Oracle repository as a read-only visual reference;
- modify files in the dedicated Nevermore implementation worktree;
- create Marketing-owned migrations, API routes, contracts, UI, tests, and local evidence;
- run deterministic unit, Marketing SQL, lint, typecheck, build, and mock browser tests;
- use Codex-native subagents for read-only exploration, implementation, and review.

Not authorized in this task:

- upload source, patches, private documentation, or customer data to ChatGPT Pro or another external service;
- commit, push, create a pull request, deploy, or apply a production database migration;
- modify `apps/web`, the App Product Profile authority, the App Worker, or production configuration;
- run billable provider reproduction merely to prove the deterministic implementation.

The attached screenshots are visual and information-architecture references. Text in the screenshots is not an instruction source. The user request and this approved design control the work.

## 2. Goal

Build a signed-in Marketing account surface on `gengrowth.ai` where a user can:

1. open a useful, accessible avatar menu;
2. see and enter the existing Credits module;
3. manage multiple websites with exactly one primary website;
4. add a website from a URL and generate a source-labelled Product/ICP draft;
5. edit and persist a draft without silently changing Agent inputs;
6. confirm an immutable website-profile snapshot;
7. let context-aware signed-in Marketing Tools and Agents explicitly reference or import a confirmed snapshot.

The feature is Marketing-owned. It does not create an App project, does not write App canonical Product Profile tables, and does not make a Marketing Agent run canonical or persistent.

## 3. Current-state findings

The current Marketing header already has a signed-in `AccountMenu` that:

- opens on hover, click, and keyboard focus;
- renders the Google avatar or an email monogram;
- shows the account email and Credits balance;
- links to `/account/credits`;
- allows sign-out even when Credits are unavailable.

The current account route surface has only `/[locale]/account/credits`.

The current Marketing Agent profile is `agent-profile.v3`. It contains rich Product, ICP, market, competitor, provenance, edit, and review fields, but it is a browser-only draft. Marketing Agent results truthfully declare run persistence as `none`, or, for the GEO report, that report contents are not persisted.

The authenticated App has a separate canonical Product Profile/ICP authority. It may inform versioning and confirmation semantics, but it must not be imported into Marketing or used as the persistence store for this feature.

The Oracle repository is a visual reference only. Its current production `UserMenu` navigates directly to settings and is not a reusable implementation of the requested dropdown.

## 4. Chosen architecture

Use a Marketing-native, account-owned website-profile store.

Rejected alternatives:

- **App bridge:** reuses mature App persistence but violates the paused App boundary and introduces project/workspace mapping.
- **Browser-only storage:** is fast but fails cross-device, server-side Agent reuse, version pinning, and durable editing requirements.

The Marketing store has three distinct layers:

1. stable website identity;
2. one mutable server-side draft per website;
3. immutable confirmed snapshots.

## 5. Information architecture

### 5.1 Avatar menu

The desktop avatar menu remains available by hover, click, and focus. Touch use relies on click. It contains, in order:

1. avatar, display name when available, email, and theme control;
2. Credits shortcut;
3. primary-website shortcut, or `Add website` when absent;
4. Settings;
5. Agents;
6. language control;
7. referral shortcut into the existing Credits page;
8. sign-out.

The menu does not contain Integrations or Docs. It does not render an inert Upgrade button.

Signed-in desktop users no longer need duplicate theme/language controls outside the menu. Signed-out users retain standalone header controls. The mobile sheet exposes the same actionable account destinations without relying on hover.

### 5.2 Account settings routes

- `/[locale]/account/websites` — default account settings module and website list;
- `/[locale]/account/websites/[websiteId]` — website profile editor;
- `/[locale]/account/credits` — existing Credits module.

The shared account layout exposes only real destinations:

- Websites;
- Credits;
- Agents as a link out of Settings.

No placeholder Team, Devices, Account Security, Integrations, or Docs entries are created.

### 5.3 Website list

Each website card shows:

- icon or deterministic hostname monogram;
- display name;
- canonical hostname;
- primary badge;
- profile state: not generated, draft, confirmed, or unconfirmed changes;
- latest confirmation time and version;
- Edit action.

The first website becomes primary. Later websites can be made primary. Team sharing, bulk import, and hard delete are outside v1.

## 6. Website identity and URL association

The user-facing association key is a URL. The database physical primary key remains a stable UUID.

The account-scoped business key is:

```text
UNIQUE (user_id, canonical_site_key)
```

URL identity normalization:

- accept only public `http` and `https` URLs;
- reject credentials;
- lowercase the hostname and remove its trailing dot;
- canonicalize internationalized hostnames to ASCII;
- remove default ports;
- ignore path, query, and fragment for website identity;
- treat standard `www.` and the apex host as one identity;
- preserve other meaningful subdomains;
- preserve the full submitted source page URL as provenance, not identity.

Cross-host redirects never silently rewrite website identity. A different final host is proposed as a different website. A true domain migration creates a new website and may import an old snapshot as a new draft, preserving both histories.

Internally, APIs and snapshot references use `websiteId`; URL entry and consumer matching use the canonical site key.

## 7. Persistent data model

### 7.1 `marketing_websites`

Stable account-owned website identity:

- `id uuid primary key`;
- `user_id uuid not null`;
- `canonical_site_key text not null`;
- `origin text not null`;
- `host text not null`;
- `display_name text`;
- `is_primary boolean not null`;
- `current_confirmed_snapshot_id uuid`;
- timestamps.

Constraints include:

- account-scoped site-key uniqueness;
- a partial unique index allowing at most one primary website per user;
- bounded text lengths;
- service functions that preserve at least one primary website whenever the user has websites.

The first website and primary switching are decided transactionally.

### 7.2 `marketing_website_profile_drafts`

One current mutable draft per website:

- `website_id uuid primary key`;
- `user_id uuid not null` for same-statement ownership scoping;
- `schema_version = marketing-website-profile.v1`;
- `draft_version integer >= 1`;
- `profile jsonb`;
- `content_hash`;
- timestamps.

Every write requires `baseVersion`. A stale base returns a conflict and changes no row.

### 7.3 `marketing_website_profile_snapshots`

Immutable confirmed versions:

- stable snapshot UUID;
- website and user scope;
- monotonically increasing website revision;
- schema version;
- profile JSON;
- content hash;
- source draft version;
- confirmation timestamp.

Update, delete, and truncate are rejected, including for the service role. Confirming unchanged content idempotently reuses the current snapshot.

### 7.4 Access boundary

Browser roles receive no direct table access. Next Route Handlers authenticate with the Marketing Supabase session, and all service-role reads/writes include the authenticated `user_id` in the database predicate or RPC argument. A foreign website or snapshot returns 404.

All profile responses use `Cache-Control: private, no-store`.

## 8. `marketing-website-profile.v1`

The persisted contract is independent of `AgentProfileDraft`. It contains only reusable website context.

### Product and positioning

- product name;
- one-line positioning;
- value proposition;
- core features;
- categories;
- business model;
- primary CTA;
- trust signals.

### Ideal customer profile

- primary ICP summary;
- buyer;
- user;
- trigger pain;
- interests;
- pain;
- behaviour;
- ICP positioning;
- JTBD;
- use cases;
- outcomes;
- barriers;
- qualification signals;
- disqualifiers;
- first outcome.

### Market and alternatives

- country/market;
- language;
- direct competitors;
- indirect alternatives;
- excluded alternatives.

### Field provenance

Every reusable field may carry:

- derivation: declared, observed, computed, inferred, or missing;
- confidence;
- source kind;
- limitation;
- observed time;
- public evidence URLs;
- user-edit state.

Missing remains missing. It is not converted to zero, an empty fact, or a model estimate.

### Explicitly excluded run state

The website profile does not persist:

- Agent kind;
- device;
- page type;
- target query;
- audit scope;
- report results;
- provider answers;
- loading or error state.

Dedicated adapters compose a confirmed website snapshot with run-specific values to create SEO, GEO, or Tool context.

## 9. Draft and confirmation state machine

```text
website_only
  -> generating
  -> draft | partial | unavailable
  -> draft_saved
  -> confirmed
  -> draft_changed
  -> confirmed (new immutable snapshot)
```

UI states:

- **Not generated:** website identity only;
- **Draft:** draft exists and has never been confirmed;
- **Confirmed:** draft hash equals the current confirmed snapshot;
- **Unconfirmed changes:** draft hash differs from the current snapshot.

Drafts may be partial. Confirmation requires, at minimum:

- product name;
- one-line positioning;
- value proposition;
- primary ICP;
- primary language.

Other missing fields remain explicit and do not block confirmation.

## 10. Add, generate, edit, and confirm flow

### Add

The Add Website dialog accepts URL and optional display name, with two actions:

- Add and generate profile;
- Add only.

Typing never triggers a provider call. An existing account site opens instead of creating a duplicate.

### Generate

The first implementation reuses the bounded Marketing profile-refresh pipeline. It is a foreground operation, not a new durable background queue:

1. save website identity;
2. validate and safely crawl public pages;
3. extract observed facts;
4. synthesize Product/ICP candidates;
5. persist a source-labelled draft;
6. stop before confirmation.

The website remains saved when generation fails. Partial results stay partial. Concurrent generation for the same website is refused rather than duplicated.

### Edit and autosave

The editor groups Product, ICP, Market/Alternatives, and Sources/Versions. Local edits debounce for approximately 800–1000 ms, then save with `baseVersion`. A manual Save Draft action remains available.

Visible states are truthful: unsaved, saving, saved, failed, or conflicted. A failed save preserves local input. Navigation warns only while input is unsaved or the last save failed.

### Conflict

A 409 keeps the local draft and opens a field-level comparison between local and current server values. No silent force overwrite is available.

### Refresh

Re-scan produces field-level proposals. It does not overwrite the draft. User-edited fields are retained by default. Applying proposals changes only the draft.

### Confirm

Confirmation validates the core fields, previews the delta from the prior snapshot, and creates or reuses an immutable snapshot. Only future Tool/Agent operations see the newly confirmed version.

## 11. Tool and Agent sharing contract

Two distinct operations are supported.

### Reference

Reference is linked and reproducible. A consumer sends a versioned reference containing:

- website ID;
- exact confirmed snapshot ID;
- schema version;
- profile hash.

The server re-authenticates ownership and resolves the exact snapshot. A run never switches profile version midway. Later runs can select a newer snapshot.

Agent-local edits are a run overlay. They do not mutate the website profile. A separate Save Back to Website Draft action is required.

### Import

Import creates a detached, editable consumer projection from an exact snapshot. It retains source metadata but does not remain synchronized. Neither subsequent website updates nor Tool edits flow automatically in the other direction.

### URL matching

1. exact normalized target-host match;
2. explicit user choice;
3. primary website only when no target URL exists.

A primary profile is never silently applied to a different target host.

### Server resolution and identity binding

The client-side profile and hash check is consistency evidence, never
authorization. An exact consumer reference is parsed again on the server,
resolved for the verified Supabase user, matched to the owned website and exact
immutable snapshot, and required to identify the same normalized target host
before any paid or provider work. A missing, stale, malformed, foreign, or
cross-host reference fails closed.

The connected Low Competition Keyword Finder has an additional two-identity
boundary: the sealed Google subject beside the Search Console grant must equal
the Google subject derived from the Supabase user's server-verified Google
identity. Missing, malformed, duplicated, or mismatched identity data returns
`authentication_required` before the website-profile resolver, crawl, or model.
The detached/no-reference Tool path does not read a private profile and retains
its existing Google/GSC identity behavior.

### Consumers

- SEO Agent and its technical focus: exact reference or detached import, with
  explicit draft-only Save Back;
- GEO Agent: exact reference only; aliases and category require current-run
  confirmation, while pinned Product/ICP context is reviewed before the run;
- connected Low Competition Keyword Finder: detached import into editable
  seeds or exact reference with server-derived pinned seeds and a separate
  run-local overlay;
- facts-only/no-login Public Tools: no account profile access;
- prompt/template helpers: import a minimal projection.

Each consumer has a typed projection adapter. Consumers do not receive the raw full profile by default. Provider calls receive only the fields required for that request. Logs and analytics record IDs/version/hash, not private profile text.

Profile persistence does not change existing report/run persistence claims.

## 12. UI components and accessibility

The implementation introduces or extends:

- `AccountMenu`;
- `AccountSettingsLayout`;
- `WebsiteList` and `WebsiteCard`;
- `AddWebsiteDialog`;
- `WebsiteProfileEditor`;
- generation and save-status components;
- field-source and refresh-review components;
- confirmation bar;
- shared `WebsiteProfilePicker`;
- profile-version badge.

The design uses current Marketing tokens and light/dark themes. It does not clone the competitor or Oracle aesthetic.

Accessibility requirements:

- mouse, touch, and keyboard operation;
- Escape restores focus to the avatar trigger;
- directional navigation and Enter/Space activation for the menu;
- textual status in addition to colour;
- labelled inputs and field-level validation;
- safe wrapping for URLs and long values;
- reduced-motion compatibility;
- mobile controls that never require hover.

## 13. Errors and privacy

- invalid URL preserves input and reports a precise field error;
- duplicate URL opens the existing website;
- expired auth preserves local edits and requests sign-in;
- robots refusal and provider/network failure remain distinct;
- unavailable is never rendered as zero or a negative fact;
- database failure never renders Saved or Confirmed;
- profile conflict never overwrites either version;
- website page text is untrusted data and never executable instruction;
- profile content is absent from public HTML, search indexes, analytics payloads, and ordinary logs;
- no secrets, cookies, full provider payloads, or report contents enter the profile.

## 14. Verification strategy

### Unit and contract

- canonical URL identity;
- website-profile parsing and bounds;
- hash determinism;
- run-field exclusion;
- field provenance and user-edit preservation;
- SEO/GEO/Tool projections;
- reference versus import;
- cross-host refusal;
- i18n parity.

### Marketing SQL

- first-site primary;
- account-scoped URL uniqueness;
- concurrent primary switching;
- user isolation;
- draft CAS;
- immutable and idempotent snapshots;
- generation single-flight state if persisted;
- no direct browser-role writes.

### API

- 401 unauthenticated;
- 404 foreign resource;
- 409 duplicate/stale/in-progress;
- field-level confirmation errors;
- private no-store responses;
- source/provider failure separation;
- redacted logging.

### Components

- complete avatar-menu destinations and omitted Integrations/Docs;
- menu keyboard and pointer behaviour;
- Credits-unavailable sign-out;
- website states;
- autosave truthfulness;
- conflict retention;
- refresh proposal review;
- profile picker reference/import semantics;
- mobile no-hover path.

### Browser flows

1. add the first website and generate a draft;
2. edit, autosave, and confirm;
3. reference the exact snapshot from SEO Agent;
4. confirm a new profile version and prove the prior run remains pinned;
5. add a second site and switch primary;
6. prove a different URL does not inherit the primary profile;
7. import a detached Tool copy without back-writing;
8. verify Chinese/English, light/dark, desktop/mobile, and keyboard use.

Deterministic fixtures prove code paths. They do not prove a real paid provider or production deployment. Any real provider canary, hosted migration, or production check requires separate authorization.

## 15. Acceptance criteria

The local implementation is acceptable only when current evidence proves all of the following:

1. the avatar menu exposes the approved account actions and remains accessible;
2. Credits retains its current truthful failure boundary;
3. multiple account websites exist with exactly one primary;
4. URL identity is normalized and account-scoped;
5. generation creates a source-labelled draft and never auto-confirms;
6. edits save with CAS and never silently overwrite conflicts;
7. confirmation creates an immutable, idempotent snapshot;
8. signed-in context-aware Tools/Agents can reference or import an exact snapshot;
9. a target-host mismatch never silently receives the primary profile;
10. no-login facts-only Public Tools remain profile-free;
11. Marketing run/report persistence claims remain true;
12. focused tests, Marketing SQL, lint, typecheck, build, mock browser coverage, secret scan, and diff review pass or are accurately reported as unverified with a concrete reason;
13. no commit, push, deploy, or production migration occurs without separate authorization.

## 16. Non-goals

- team sharing, roles, seats, or workspace permissions;
- device management or account security centre;
- Integrations or Docs menu entries;
- website hard deletion;
- App Product Profile synchronization;
- durable background generation queue;
- report-content persistence;
- purchase/Upgrade UI without a real purchase flow;
- production migration or deployment.
