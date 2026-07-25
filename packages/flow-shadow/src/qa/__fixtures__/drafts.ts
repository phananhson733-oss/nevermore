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

/**
 * The load-bearing regression corpus for the reference-list blind spots.
 *
 * Every one of these carried a fabricated bibliography and returned `passed`,
 * with three blocking claims persisted asserting the draft made no external
 * assertion, carried no citation and listed no source entry. They differ from
 * each other only in the heading word or the markdown the model chose.
 */
const FABRICATED_REFERENCE_BODY = [
  "# Onboarding analytics for RevOps teams",
  "",
  "## What onboarding analytics covers",
  "",
  "**Onboarding analytics** measures time to first value for RevOps teams.",
  "",
  "## Audience",
  "",
  "RevOps leads evaluating onboarding tooling own this work.",
  "",
];

function draftWithReferenceSection(
  title: string,
  entries: readonly string[],
): string {
  return [...FABRICATED_REFERENCE_BODY, `## ${title}`, "", ...entries, ""].join(
    "\n",
  );
}

/** A reference list under each heading the exact-title set could not see. */
export const REFERENCE_HEADING_DRAFTS: ReadonlyArray<
  readonly [string, string]
> = [
  [
    "Further Reading",
    draftWithReferenceSection("Further Reading", [
      "- Forrester Digital Experience Report, 2024",
      "- Gartner Onboarding Benchmark, 2023",
    ]),
  ],
  [
    "Related Reading",
    draftWithReferenceSection("Related Reading", [
      "- McKinsey Activation Study, 2024",
    ]),
  ],
  [
    "Works Cited",
    draftWithReferenceSection("Works Cited", [
      "- Forrester Digital Experience Report, 2024",
    ]),
  ],
  [
    "Bibliography",
    draftWithReferenceSection("Bibliography", [
      "- Gartner Onboarding Benchmark, 2023",
    ]),
  ],
  [
    "Citations",
    draftWithReferenceSection("Citations", [
      "- Nielsen Norman Group, Onboarding Usability, 2022",
    ]),
  ],
  [
    "Sources and further reading",
    draftWithReferenceSection("Sources and further reading", [
      "- Forrester Digital Experience Report, 2024",
    ]),
  ],
];

/** The same reference, in each markdown shape the list-item filter missed. */
export const REFERENCE_FORMAT_DRAFTS: ReadonlyArray<
  readonly [string, string]
> = [
  [
    "paragraph",
    draftWithReferenceSection("Sources", [
      "Forrester Digital Experience Report, 2024",
    ]),
  ],
  [
    "table",
    draftWithReferenceSection("Sources", [
      "| Source | Year |",
      "| --- | --- |",
      "| Forrester Digital Experience Report | 2024 |",
    ]),
  ],
  [
    "blockquote",
    draftWithReferenceSection("Sources", [
      "> Forrester Digital Experience Report, 2024",
    ]),
  ],
  [
    "list item",
    draftWithReferenceSection("Sources", [
      "- Forrester Digital Experience Report, 2024",
    ]),
  ],
];

/**
 * A first-party product link on a line that happens to contain the word
 * `report`. This was `blocked`, with the detail calling the customer's own URL
 * a fabricated source at authority D.
 */
export const FIRST_PARTY_LINK_DRAFT = [
  ...FABRICATED_REFERENCE_BODY,
  "## Next step",
  "",
  "Read our onboarding analytics report at [the product report page](https://signalframe.example/reports/onboarding).",
  "",
].join("\n");

/** A genuinely attributed external link: still a citation, still blocked. */
export const ATTRIBUTED_LINK_DRAFT = [
  ...FABRICATED_REFERENCE_BODY,
  "## Evidence",
  "",
  "According to [the 2024 analyst benchmark](https://analyst.example/benchmark), activation tracking cuts churn.",
  "",
].join("\n");

/**
 * A draft whose first line is a lone `---`. This masked the entire document as
 * unterminated frontmatter, and the fabricated citation inside it was judged
 * clean by rules that had read nothing.
 */
export const UNCLOSED_FRONTMATTER_DRAFT = [
  "---",
  "",
  "# Onboarding analytics",
  "",
  "## Why onboarding analytics matters",
  "",
  "According to the 2024 Forrester Digital Experience Report, teams cut",
  "onboarding time by 40%.",
  "",
].join("\n");

/** Nothing but a fenced block: readable bytes, no prose to judge. */
export const ALL_FENCED_DRAFT = ["```text", "just a transcript", "```", ""].join(
  "\n",
);
