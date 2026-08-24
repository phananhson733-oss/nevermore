# GSC Daily Briefing Artifact Sections Design

**Status:** Approved on 2026-08-24

**Decision:** Use the supplied “每日搜索简报” Artifact as the visual and
interaction authority for the two primary result sections while retaining the
current production data, privacy, evidence, and localization contracts.

## 1. Problem

The shipped report already returns bounded `changes` and matching `actions`, but
the result surface weakens both parts of the daily workflow:

- “超出噪声阈值的变化” was renamed to a generic “值得继续检查” heading;
- desktop comparisons became separate evidence cards instead of one scannable
  comparison table;
- “今日建议动作” was framed as a group of tool links instead of the ranked work
  list the visitor should act on;
- before the first run, neither major section is visible;
- zero-result states collapse to one line and look like missing implementation.

The correction is presentation-only. The deterministic report envelope,
evidence thresholds, maximum-three ordering, private same-tab handoff, GSC read
plan, and no-persistence boundary remain unchanged.

## 2. Approved pre-run behavior

The visitor chose option A.

Before the first successful run, the connected form shows two structural preview
sections below the run controls:

1. “超出噪声阈值的变化”;
2. “今日建议动作”.

Each preview contains the real section title, a short explanation, and an honest
“run the briefing to generate this section” empty panel. It contains no example
metrics, query, page, count, ranking, or action. The preview disappears when a
successful real envelope replaces it.

Errors do not fabricate or retain stale results. Changing the property, brand
terms, or brand confirmation returns the page to the same honest pre-run
preview.

## 3. Result information architecture

After a successful run, the primary result order is:

1. data-through, time-basis, cadence, and shared-run facts;
2. four KPI cards;
3. compact noise-filter summary;
4. “超出噪声阈值的变化”;
5. “今日建议动作”;
6. the two page-local GSC self-checks;
7. detailed coverage, anonymization, limitations, and methodology.

Coverage and anonymization remain visible, but move below the primary daily
workflow so technical evidence disclosure does not separate KPIs from the two
decisions the page exists to support.

## 4. Noise-filter summary

The summary sits directly below the KPI cards and immediately above the changes
section. It has a small accent label (“噪声过滤已开启”) plus one sentence.

- When `countComplete` is true, it reports the complete number of observed query
  rows that did not clear a signal threshold and the number of displayed
  changes.
- When `countComplete` is false, it explicitly says the number covers only the
  observed prefix and is not property-wide.
- It never turns unavailable or unconfirmed evidence into zero.
- It uses the production evidence floor, not the Artifact’s illustrative
  “significance test” wording.

## 5. Changes section

The section title is exactly “超出噪声阈值的变化” in Chinese and “Changes above
the noise threshold” in English. Its subtitle states that the comparison is the
latest complete seven days versus the preceding seven days and that at most
three evidence-backed rows are shown.

One responsive table-like panel contains one DOM row per change:

| Column | Content |
| --- | --- |
| Change | Localized signal label and evidence state |
| Query / Page | Query on the first line, page on the second |
| Clicks | Previous → current |
| Position | Previous → current, exposure weighted |
| Interpretation | Localized, kind-specific evidence statement |

The row must preserve honest null semantics. A `first_observed` previous value
is “not observed in the comparison window”, never `0`. An unavailable position
is a dash/unavailable label, never a fabricated rank.

On desktop, the rows align under one header like the Artifact. On narrow screens,
the same rows become stacked labeled records with no duplicate DOM data and no
horizontal page overflow.

If no change clears the gates, the complete bordered section remains visible and
shows an explicit zero-result explanation. It does not pad the report with mock
rows.

## 6. Actions section

The section title is exactly “今日建议动作” in Chinese and “Today’s recommended
actions” in English. Its subtitle explains the maximum-three, deterministic
evidence order and private handoff.

Actions render as vertically stacked rows:

- a numbered accent marker (`1`–`3`);
- action title and concise reason;
- the matched query/page evidence in a compact secondary line;
- one destination CTA aligned right on desktop and full-width below on mobile.

The existing action-to-change exact matching, maximum-three cap, localized
destination, bounded evidence ID, and fail-closed `sessionStorage` handoff remain
unchanged.

If no action is supported, the complete bordered section remains visible with an
explicit zero-action explanation and no CTA.

## 7. Visual direction

Use the Artifact’s editorial hierarchy, comparison density, numbered work list,
bordered table panel, and calm vertical rhythm. Keep the current GenGrowth theme
tokens, navigation shell, typography system, dark/light behavior, focus styles,
and responsive breakpoints. Do not copy the Artifact’s MOCK banner, sample
values, review notes, or light-only palette.

The memorable interaction is a single downward work path:

`KPI context → noise summary → material changes → today’s actions`.

## 8. Accessibility and privacy

- Sections use stable `aria-labelledby` relationships.
- The table-like structure exposes row, columnheader, and cell semantics.
- Mobile labels do not duplicate content for assistive technology.
- Empty states remain explanatory, not decorative skeletons.
- Private property/query/page values never enter URLs.
- No pre-run preview contains user data or illustrative data.
- Existing keyboard focus and 390px no-overflow requirements remain acceptance
  gates.

## 9. Acceptance criteria

1. Before the first run, both approved section titles and honest preview panels
   are visible with no mock evidence.
2. A successful run replaces previews with the real sections.
3. The changes section exposes the five Artifact-aligned columns on desktop and
   a no-overflow stacked layout on mobile.
4. Zero changes still render a complete, bordered changes section.
5. Actions render as one ranked vertical list, not a three-column card grid.
6. Zero actions still render a complete, bordered actions section.
7. At most three changes and three matched actions render.
8. `not_observed`, `partial`, `unavailable`, and observed zero remain distinct.
9. EN/ZH, dark/light, keyboard focus, 390px layout, handoff privacy, and existing
   backend contracts continue to pass.
10. No `apps/web`, Worker, database, migration, OAuth, or GSC transport behavior
    changes.
