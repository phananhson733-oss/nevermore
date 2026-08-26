# GSC Daily Briefing SPEC-Aligned Layout Design

**Status:** Approved by Owner on 2026-08-26

**Decision:** Refine the Daily Briefing query/page review table by reusing the
Claude Design Artifact table and section-heading primitives, remove the visible
duplicate site-wide trend card, and add a formal GSC-only visualization token
family. The deterministic report, property evidence and action dispatch remain
unchanged.

## 1. Authority and scope

This presentation change is controlled by the following repository-owned
authorities:

1. `docs/artifact-src/styles.css`:
   - `.client-table.v14-page-table` provides the fixed-layout and local-width
     model;
   - `.v14-page-table th` provides the 50px header, 13px vertical padding,
     14px horizontal padding, 12px label and normal-case treatment;
   - `.detail-section-heading` provides a 15px title and 13px secondary count;
   - the v17 readability guard requires local table width/scroll rather than
     crushing Chinese labels into narrow columns.
2. `apps/marketing/src/app/globals.css` provides Signal Console typography,
   theme surfaces, borders, text roles, focus states and responsive behavior.
3. `docs/plans/2026-08-24-gsc-daily-briefing-artifact-sections-design.md`
   controls the five Artifact-aligned columns, responsive single-DOM records,
   honest empty states and the query/page work-list hierarchy.
4. `docs/plans/2026-08-25-gsc-daily-briefing-observation-watchlist-design.md`
   remains authoritative for query/page observation semantics and property
   evidence. This design supersedes only its instruction to render the
   property trend as a separate visible card.

The change is limited to `apps/marketing`. There is no GSC transport, report
calculation, evidence threshold, action ordering, handoff, OAuth, database,
Worker or authenticated App change.

## 2. Review-table hierarchy

The existing responsive table-like panel remains one semantic table and one
DOM representation of each record.

### 2.1 Desktop column header

The desktop header adopts the Artifact `v14-page-table` role:

- minimum height: 50px;
- padding: 13px vertical and 14px horizontal;
- font: Signal Console reading Sans, 12px, semibold;
- letter spacing: 0.02em;
- normal case; no mono uppercase eyebrow styling;
- theme roles: `bg-brand-panel`, `text-text-dark-secondary`, and
  `border-brand-border-card`.

Header and data rows use one shared column-template constant. The query/page
primary-object column must be the widest object column; status remains wide
enough for a two-line signal title; click and position remain compact metric
columns; interpretation receives the remaining flexible space.

The table follows the Artifact readability model: a desktop-local minimum
width of 860px and local overflow if the report container is narrower. It must
not squeeze Chinese column labels or record text. Below the desktop breakpoint,
the existing stacked record layout remains authoritative and the desktop header
remains screen-reader-only.

### 2.2 Query and page population headings

`查询词记录` and `页面维度记录` stop using the global `EYEBROW` micro-label.
Each populated group renders one full-width section-heading row that reuses the
Artifact `detail-section-heading` hierarchy:

- title: 15px, semibold, `text-text-dark-primary`;
- count: 13px, `text-text-dark-secondary`;
- surface: `bg-brand-panel-raised`;
- boundary: standard card border only;
- no new gradient, glow, shadow, decorative icon or custom accent strip.

The query heading renders whenever at least one query, provisional or query
observation row is displayed. The page heading renders whenever at least one
page-dimension row is displayed. Neither heading depends on the other group
being present. The count is the number of displayed records in that population,
not the number of candidates before the display cap.

## 3. Remove the duplicate visible site-wide trend

The visible `站点整体趋势` / `Site-wide trend` section is removed because the
new GSC trend chart already provides whole-property clicks, impressions, CTR
and average-position history.

The removal is presentation-only:

- `DailyBriefingPropertyTrend`, its noise floor and action derivation remain in
  the report contract;
- an evidence-backed property action still appears in `今日建议动作`;
- property comparisons required by that action remain available;
- the evidence/details fold no longer advertises a hidden site-trend
  observation count;
- a below-action property movement is visible in the top chart and is not
  repeated as a second card.

This Owner decision supersedes the separate-card presentation rule in
`2026-08-25-gsc-daily-briefing-observation-watchlist-design.md`. It does not
supersede the calculation or evidence boundary.

## 4. Formal GSC visualization tokens

Google hues are introduced as a third-party data-visualization token family,
not as GenGrowth brand colors or status colors:

```css
--gsc-clicks: #4285f4;
--gsc-impressions: #5e35b1;
--gsc-ctr: #00897b;
--gsc-position: #ef6c00;
```

Rules:

- literal Google colors live only in `globals.css`;
- the trend component reads only `var(--gsc-*)`;
- lines use the token color directly;
- the matching KPI tile uses the same token through the existing `color-mix`
  treatment with `panel`, `panel-raised` and `border-card`;
- text, focus indicators, empty states, borders and controls continue using
  Signal Console tokens;
- the four line styles remain distinct, so color is not the sole encoding;
- `--chart-*`, brand accent, semantic success/warning/error and the global
  gradient are unchanged.

The GSC tokens are valid in both themes because they are data-series colors.
Theme surfaces and text contrast continue to be supplied by the existing
Claude Design roles.

## 5. Accessibility and responsive behavior

- The table retains `table`, `row`, `columnheader` and `cell` semantics.
- Group headings expose a readable title and record count without duplicating
  row data.
- The desktop header and rows share an identical grid template.
- Mobile labels remain `aria-hidden` visual labels for the same semantic cells.
- The local table boundary cannot create page-level horizontal overflow.
- Existing focus-visible behavior is retained.
- EN/ZH, light/dark and 390px behavior remain acceptance gates.

## 6. Acceptance criteria

1. The desktop column header matches the Artifact v14 header role: 50px,
   13px/14px padding, 12px semibold Sans, normal case.
2. Header and all five-column record types use one shared template.
3. `查询词记录` and `页面维度记录` render as 15px section titles with actual
   displayed counts whenever their own population is present.
4. The table uses a desktop-local 860px minimum width and never squeezes or
   overflows the page at 390px.
5. No visible `data-site-trend` section remains.
6. An evidence-backed property action still renders in `今日建议动作`.
7. The evidence fold does not refer to a hidden site-trend observation.
8. KPI cards and lines share the four `--gsc-*` tokens.
9. No Google literal is present in the component.
10. Report schema, GSC reads, thresholds, ordering and private handoff remain
    unchanged.
