/**
 * Clean-room QA fixtures.
 *
 * Every draft below was written for SignalFrame's own B2B SaaS context. None of
 * it is copied from the sibling `gengrowth-flow-mvp` repository (Slice 2 red
 * line D covers runtime imports; this file extends the same discipline to test
 * text, so no unlicensed fixture prose enters this tree).
 *
 * They are TypeScript constants rather than `.md` files on purpose: the QA
 * suite must not read the filesystem, because a check that needs `node:fs` to
 * be testable is a check that could grow an IO dependency without anyone
 * noticing.
 */

/** Grounded in first-party framing, no external research, no citations. */
export const CLEAN_DRAFT = [
  "# Onboarding analytics for RevOps teams",
  "",
  "## What onboarding analytics covers",
  "",
  "**Onboarding analytics** is the practice of measuring how quickly a new",
  "account reaches its first successful outcome. RevOps leads use it to decide",
  "where to invest.",
  "",
  "- It tracks activation milestones.",
  "- It separates trial accounts from paid accounts.",
  "- It reports on time to first value.",
  "",
  "## How teams run onboarding analytics",
  "",
  "Teams start by naming the milestone that matters. They then instrument it.",
  "",
  "Once the milestone is instrumented, onboarding analytics becomes a weekly",
  "review rather than a quarterly project.",
  "",
  "## Audience for onboarding analytics",
  "",
  "RevOps leads evaluating onboarding tooling own this work.",
  "",
].join("\n");

/** A research assertion with no attribution at all. */
export const UNSUPPORTED_CLAIM_DRAFT = [
  "# Onboarding analytics",
  "",
  "## Why it matters",
  "",
  "Research shows teams cut onboarding time by 40% after instrumenting",
  "activation.",
  "",
].join("\n");

/**
 * The load-bearing fixture. The sentence is FORMALLY well attributed — a named
 * firm, a year, a report title — and every one of those signals is exactly what
 * the sibling repository's ALLOW list accepted. Nothing here resolves to the
 * frozen research pack, so it is a fabrication and must be blocked.
 */
export const PHANTOM_SOURCE_DRAFT = [
  "# Onboarding analytics",
  "",
  "## Why it matters",
  "",
  "According to the 2024 Forrester Digital Experience Report, teams cut",
  "onboarding time by 40%.",
  "",
].join("\n");

/** An honest disclaimer must not read as an unsupported assertion. */
export const NEGATED_CLAIM_DRAFT = [
  "# Onboarding analytics",
  "",
  "## What we can and cannot say",
  "",
  "**No study shows** that switching CMS platforms improves onboarding",
  "activation, so this draft does not claim it.",
  "",
].join("\n");

/** The same sentence as `UNSUPPORTED_CLAIM_DRAFT`, inside a fenced block. */
export const FENCED_CLAIM_DRAFT = [
  "# Onboarding analytics",
  "",
  "## Prompt we rejected",
  "",
  "```text",
  "Research shows teams cut onboarding time by 40% after instrumenting",
  "activation.",
  "```",
  "",
  "**We rejected that prompt** because nothing in the pack supports it.",
  "",
].join("\n");

/** A citation-shaped external link the pack cannot resolve. */
export const PHANTOM_CITATION_DRAFT = [
  "# Onboarding analytics",
  "",
  "## Why it matters",
  "",
  "**Activation** is the first milestone. Source:",
  "https://analyst.example/onboarding-benchmark-2024",
  "",
].join("\n");

/** A plain product link: not a citation, so it must not block. */
export const PRODUCT_LINK_DRAFT = [
  "# Onboarding analytics",
  "",
  "## What onboarding analytics covers",
  "",
  "**Onboarding analytics** measures time to first value for RevOps teams.",
  "",
  "- It tracks activation milestones.",
  "- It separates trials from paid accounts.",
  "- It reports weekly rather than quarterly.",
  "",
  "## Audience",
  "",
  "RevOps leads evaluating onboarding tooling own this work.",
  "",
  "## Next step",
  "",
  "[Book an onboarding analytics walkthrough](https://signalframe.example/demo)",
  "",
].join("\n");

/** A Sources section listing a reference that is not in the pack. */
export const PHANTOM_SOURCE_LIST_DRAFT = [
  "# Onboarding analytics",
  "",
  "## What onboarding analytics covers",
  "",
  "**Onboarding analytics** measures time to first value.",
  "",
  "## Sources",
  "",
  "- Forrester Digital Experience Report, 2024",
  "",
].join("\n");

/** Structurally weak but factually empty: never blocked, always reviewed. */
export const STRUCTURE_WEAK_DRAFT = [
  "# Onboarding analytics",
  "",
  "## What is onboarding analytics?",
  "",
  "Onboarding analytics is the practice of measuring how quickly a new account reaches its first successful outcome. RevOps leads use it to decide where to invest. It is not a dashboard. It is not a survey. It is not a quarterly project. It is a weekly operating habit that a single owner keeps. Teams that treat it as a habit find the milestone that matters faster than teams that treat it as a report.",
  "",
].join("\n");

/** Advisory-only defects: jargon, weak verbs, no FAQ, no table, no bullets. */
export const ADVISORY_ONLY_DRAFT = [
  "# Onboarding analytics",
  "",
  "## Onboarding analytics",
  "",
  "**Onboarding analytics** is about activation. It relates to the RevOps",
  "motion, and it lets teams delve into the funnel to unlock the recursive",
  "gains that a weekly review compounds.",
  "",
  "## Audience",
  "",
  "RevOps leads evaluating onboarding tooling own this work.",
  "",
].join("\n");
