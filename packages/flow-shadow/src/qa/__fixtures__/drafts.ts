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
export const REFERENCE_FORMAT_DRAFTS: ReadonlyArray<readonly [string, string]> =
  [
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
export const ALL_FENCED_DRAFT = [
  "```text",
  "just a transcript",
  "```",
  "",
].join("\n");

/**
 * The acceptance fixture for Task 6b: a clean draft that follows the drafting
 * scaffold, INCLUDING the scaffold's own call to action.
 *
 * Before the frozen tuple carried a first-party identity, this draft could not
 * reach `passed`: the pack held no URL at all, so RL12b (review severity) failed
 * on the call-to-action link and pinned the verdict at `needs_review`. `passed`
 * was therefore reachable only by a draft that linked nowhere — a draft written
 * CORRECTLY scored worse than an incomplete one, and the verdict had two usable
 * values instead of three.
 */
export const SCAFFOLD_CTA_DRAFT = [
  "# Onboarding analytics for RevOps teams",
  "",
  "## Summary",
  "",
  "**Onboarding analytics** is the practice of measuring how quickly a new",
  "account reaches its first successful outcome. RevOps leads use it to decide",
  "where to invest.",
  "",
  "- It tracks activation milestones.",
  "- It separates trial accounts from paid accounts.",
  "- It reports on time to first value.",
  "",
  "## Problem",
  "",
  "Most teams ship an onboarding analytics dashboard that nobody opens. The",
  "weekly question goes unanswered, so the milestone quietly drifts.",
  "",
  "## Approach",
  "",
  "Teams start by naming the onboarding analytics milestone that matters. They",
  "instrument it once and then review it every week.",
  "",
  "## FAQ",
  "",
  "### What does it measure?",
  "",
  "Onboarding analytics measures the time a new account takes to reach its",
  "first successful outcome.",
  "",
  "### Who owns it?",
  "",
  "The RevOps lead who owns activation.",
  "",
  "### How often should the team review it?",
  "",
  "Weekly, in the same meeting that reviews pipeline.",
  "",
  "## Call To Action",
  "",
  "[Book an onboarding walkthrough](https://signalframe.example/demo)",
  "",
].join("\n");

/**
 * The same draft, linking to a SUBDOMAIN of the frozen site origin. B2B sites
 * routinely serve their blog, docs and app from `blog.`/`docs.`/`app.`, and
 * treating those as unverifiable would put every correct internal link back in
 * front of a human.
 */
export const FIRST_PARTY_SUBDOMAIN_DRAFT = SCAFFOLD_CTA_DRAFT.replace(
  "https://signalframe.example/demo",
  "https://docs.signalframe.example/onboarding",
);

/**
 * A look-alike host that merely ENDS WITH the frozen origin's text. It must not
 * resolve: `signalframe.example.attacker.test` is not the customer's property.
 */
export const LOOKALIKE_HOST_DRAFT = SCAFFOLD_CTA_DRAFT.replace(
  "https://signalframe.example/demo",
  "https://signalframe.example.attacker.test/demo",
);

/** The same draft, linking somewhere the frozen identity does not cover. */
export const OUTSIDE_LINK_DRAFT = SCAFFOLD_CTA_DRAFT.replace(
  "https://signalframe.example/demo",
  "https://analyst.example/onboarding-benchmark",
);

/** A bare first-party URL in prose: RL12 treats any bare URL as a citation. */
export const FIRST_PARTY_BARE_URL_DRAFT = SCAFFOLD_CTA_DRAFT.replace(
  "[Book an onboarding walkthrough](https://signalframe.example/demo)",
  "Start here: https://signalframe.example/demo",
);

/** A Sources section that lists only the customer's own site. */
export const FIRST_PARTY_SOURCES_DRAFT = [
  SCAFFOLD_CTA_DRAFT,
  "## Sources",
  "",
  "- SignalFrame product site, https://signalframe.example/product",
  "",
].join("\n");

/**
 * The laundering corpus.
 *
 * Freezing the customer's own web identity put URLs into a pack that had never
 * held any, and the three blocking rules asked only "did anything resolve?".
 * So one link to the customer's own site — a call to action, a demo booking,
 * anything — vouched for whatever invented reference shared its line. Each
 * draft below returned `passed`, and each carries its own counterfactual: the
 * identical draft WITHOUT the first-party link was blocked, which is the proof
 * that the link, not the content, was doing the work.
 */
const LAUNDERING_BODY = [
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

/** RL8: a fabricated research assertion with the CTA link on its line. */
export const LAUNDERED_CLAIM_DRAFT = [
  ...LAUNDERING_BODY,
  "## Why it matters",
  "",
  "According to a 2024 Forrester study, 73% of teams abandon activation",
  "tracking in week one. [Book a demo](https://signalframe.example/demo)",
  "",
].join("\n");

/** The counterfactual: the same sentence, no first-party link. */
export const LAUNDERED_CLAIM_CONTROL_DRAFT = [
  ...LAUNDERING_BODY,
  "## Why it matters",
  "",
  "According to a 2024 Forrester study, 73% of teams abandon activation",
  "tracking in week one.",
  "",
].join("\n");

/** SC9b: an invented bibliography with a first-party URL on every entry. */
export const LAUNDERED_REFERENCE_LIST_DRAFT = [
  ...LAUNDERING_BODY,
  "## Sources",
  "",
  "- Forrester Digital Experience Report, 2024. https://signalframe.example/product",
  "- Gartner Onboarding Benchmark, 2023. https://signalframe.example/pricing",
  "",
].join("\n");

/** RL12: an `et al.` citation with the frozen conversion target on its line. */
export const LAUNDERED_CITATION_DRAFT = [
  ...LAUNDERING_BODY,
  "## Evidence",
  "",
  "Smith et al. (2023) measured a 42% lift.",
  "[Book a demo](https://book.signalframe-demo.example/onboarding)",
  "",
].join("\n");

/**
 * A domain harvested out of ANOTHER url's query string.
 *
 * `extractAttributions` scanned the whole line for bare domain literals, so
 * `https://attacker.test/?u=https://signalframe.example/` yielded
 * `signalframe.example` as a fourth candidate — and "the first attribution that
 * resolves wins" then let a link the customer does not control support the
 * sentence.
 */
export const QUERY_STRING_HARVEST_DRAFT = [
  ...LAUNDERING_BODY,
  "## Why it matters",
  "",
  "According to a 2024 Forrester study, 73% of teams churn. See",
  "https://attacker.test/?u=https://signalframe.example/ for the chart.",
  "",
].join("\n");

/**
 * Reference lists under headings, and in shapes, the recogniser could not see.
 *
 * Every one of these returned `passed` with `partitionDraft().reference` empty
 * and SC9b persisting the sentence that no section of the draft was headed as a
 * reference list — a falsifiable claim about a draft whose fabricated
 * bibliography is right there.
 */
export const UNRECOGNISED_REFERENCE_DRAFTS: ReadonlyArray<
  readonly [string, string]
> = [
  [
    "ASCII colon",
    [
      ...LAUNDERING_BODY,
      "## Sources:",
      "",
      "- Forrester Digital Experience Report, 2024",
      "",
    ].join("\n"),
  ],
  [
    "full-width colon",
    [
      ...LAUNDERING_BODY,
      "## Sources：",
      "",
      "- Forrester Digital Experience Report, 2024",
      "",
    ].join("\n"),
  ],
  [
    "parenthesised qualifier",
    [
      ...LAUNDERING_BODY,
      "## References (external)",
      "",
      "- Forrester Digital Experience Report, 2024",
      "",
    ].join("\n"),
  ],
  [
    "see also",
    [
      ...LAUNDERING_BODY,
      "## See Also",
      "",
      "- Forrester Digital Experience Report, 2024",
      "",
    ].join("\n"),
  ],
  [
    "non-English heading",
    [
      ...LAUNDERING_BODY,
      "## 参考文献",
      "",
      "- Forrester Digital Experience Report, 2024",
      "",
    ].join("\n"),
  ],
  [
    "setext heading",
    [
      ...LAUNDERING_BODY,
      "Sources",
      "-------",
      "",
      "- Forrester Digital Experience Report, 2024",
      "",
    ].join("\n"),
  ],
  [
    "bold line as heading",
    [
      ...LAUNDERING_BODY,
      "**Sources**",
      "",
      "- Forrester Digital Experience Report, 2024",
      "",
    ].join("\n"),
  ],
];

/**
 * A reference list under a heading the recogniser deliberately does NOT claim.
 *
 * `## Related links` under a B2B post is usually the customer's own pages, and
 * pulling it out of the body would report every one of them as an unresolvable
 * reference — so it stays in the body on purpose. That conservative bias is
 * only safe because the body is genuinely scanned: this draft must still be
 * caught, by RL12's bibliographic-entry shape rather than by SC9b.
 */
export const BODY_RESIDENT_REFERENCE_DRAFT = [
  ...LAUNDERING_BODY,
  "## Related links",
  "",
  "- Forrester Digital Experience Report, 2024",
  "- Gartner Onboarding Benchmark, 2023",
  "",
].join("\n");

/**
 * A leading `---` used as a thematic break, with a SECOND `---` further down.
 *
 * Taking "the next `---`" as the closing frontmatter delimiter masked the whole
 * first content block, so both fabricated attributions inside it were never
 * scanned. The all-lines-empty backstop did not fire, because the tail of the
 * draft survived.
 */
export const THEMATIC_BREAK_FRONTMATTER_DRAFT = [
  "---",
  "",
  "# Onboarding analytics",
  "",
  "## Why onboarding analytics matters",
  "",
  "According to the 2024 Forrester Digital Experience Report, teams cut",
  "onboarding time by 40%.",
  "",
  "Gartner found that 73% of teams abandon activation tracking in week one.",
  "",
  "---",
  "",
  "## Audience",
  "",
  "RevOps leads evaluating onboarding tooling own this work.",
  "",
].join("\n");

/**
 * The ENTRY-SHAPE escape corpus.
 *
 * One fabricated reference, written ten ways. The detector asked "does this
 * match a bibliographic FORM?", so nine of these ten walked through with a
 * clean `passed` — each one token away from the tenth, which was blocked. This
 * is the same failure mode as the heading corpus above, one layer down: a
 * recognition rule made of forms is a rule made of holes, and the escapes are
 * enumerated here so a future rework cannot repair them one row at a time.
 *
 * The assertion these carry is deliberately weak — NOT `passed` rather than
 * `blocked`. Four of them carry a year, a quotation or an `et al.` alongside
 * the name and are blocked; the rest carry a name and nothing else, which is
 * enough to send a draft to a human and not enough to call it unsupported.
 */
export const REFERENCE_ENTRY_SHAPE_DRAFTS: ReadonlyArray<
  readonly [string, string]
> = (
  [
    ["no year", ["- Forrester Digital Experience Report"]],
    ["comma inside the name", ["- Forrester, Digital Experience Report"]],
    [
      "table row",
      [
        "| Source | Year |",
        "| --- | --- |",
        "| Forrester Digital Experience Report | 2024 |",
      ],
    ],
    [
      "definition list",
      ["Forrester Digital Experience Report", ": 2024 analyst report"],
    ],
    [
      "html list",
      ["<ul>", "<li>Forrester Digital Experience Report, 2024</li>", "</ul>"],
    ],
    ["two-digit year", ["- Forrester Digital Experience Report, '24"]],
    ["roman numeral year", ["- Forrester Digital Experience Report, MMXXIV"]],
    ["year first", ["- 2024. Forrester Digital Experience Report"]],
    ["quoted title", ['- Forrester. "Digital Experience Report." 2024.']],
    ["comma and year", ["- Forrester Digital Experience Report, 2024"]],
  ] as const
).flatMap(([shape, entries]) => [
  // Under a heading the recogniser does not claim, and with no heading at all.
  // Both regions are the BODY, which is where the conservative partition sends
  // everything it is unsure of — so both have to be scanned.
  [
    `${shape} under an unrecognised heading`,
    [...LAUNDERING_BODY, "## Resources", "", ...entries, ""].join("\n"),
  ] as const,
  [
    `${shape} with no heading`,
    [...LAUNDERING_BODY, ...entries, ""].join("\n"),
  ] as const,
]);

/**
 * A navigation section listing the CUSTOMER'S OWN pages.
 *
 * `## Further reading`, `## See Also` and `## Related links` are the same
 * section to a reader, and they came back blocked, blocked and passed. The two
 * blocked ones carried the gate's strongest verdict with a detail calling a B2B
 * post's internal navigation an unresolvable source at authority D — the
 * false-accusation failure, arriving through heading recognition this time.
 */
export const NAVIGATION_SECTION_DRAFTS: ReadonlyArray<
  readonly [string, string]
> = ["Further reading", "See Also", "Related links", "Resources"].map(
  (title) =>
    [
      title,
      [
        SCAFFOLD_CTA_DRAFT,
        `## ${title}`,
        "",
        "- [Onboarding analytics guide](https://signalframe.example/guides/onboarding)",
        "- [Activation metrics glossary](https://signalframe.example/glossary/activation)",
        "",
      ].join("\n"),
    ] as const,
);

/**
 * A bold pseudo-heading followed by ORDINARY PROSE.
 *
 * The heading text had a guard; what followed it had none. So this claimed the
 * next two sentences as a reference list and reported both of them —
 * unremarkable B2B prose — as reference entries resolving to nothing at
 * authority D.
 */
export const PSEUDO_HEADING_PROSE_DRAFT = [
  ...LAUNDERING_BODY,
  "**Further reading**",
  "",
  "Teams that instrument activation once tend to keep the weekly review going.",
  "The same habit keeps the milestone from drifting quarter over quarter.",
  "",
].join("\n");

/** `(Author, Year)` — the commonest inline academic citation there is. */
export const PARENTHETICAL_CITATION_DRAFTS: ReadonlyArray<
  readonly [string, string]
> = [
  "73% of teams abandon activation tracking (Forrester, 2024).",
  "73% of teams abandon activation tracking (Forrester 2024).",
  "73% of teams abandon activation tracking [Forrester 2024].",
  "Activation tracking cut churn 42% (Smith et al., 2023).",
].map(
  (sentence) =>
    [
      sentence,
      [...LAUNDERING_BODY, "## Evidence", "", sentence, ""].join("\n"),
    ] as const,
);

/**
 * Honest drafts whose shapes sit closest to the predicates above.
 *
 * A dated parenthetical is the same shape as a citation, and a metric table is
 * the same shape as a bibliography table. Each of these must still reach
 * `passed`: the top verdict has to stay reachable by correct work, which is the
 * acceptance criterion Task 6b exists for.
 */
export const NEAR_MISS_HONEST_DRAFTS: ReadonlyArray<readonly [string, string]> =
  [
    [
      "dated parenthetical",
      [
        ...LAUNDERING_BODY,
        "## Timeline",
        "",
        "Revenue from activated accounts grew 12% (March 2024).",
        "",
      ].join("\n"),
    ],
    [
      "metric table",
      [
        ...LAUNDERING_BODY,
        "## Metrics",
        "",
        "| Metric | Definition |",
        "| --- | --- |",
        "| Activation Rate | Share of accounts reaching the milestone |",
        "| Time To Value | Median days to that milestone |",
        "",
      ].join("\n"),
    ],
    [
      "first-party bullets",
      [
        ...LAUNDERING_BODY,
        "## What it tracks",
        "",
        "- It tracks activation milestones.",
        "- It separates trial accounts from paid accounts.",
        "",
      ].join("\n"),
    ],
  ];

/** Attribution shapes that reached no rule at all and scored `passed`. */
export const ESCAPED_ATTRIBUTION_DRAFTS: ReadonlyArray<
  readonly [string, string]
> = [
  [
    "link as the attributed name",
    [
      ...LAUNDERING_BODY,
      "## Evidence",
      "",
      "[Forrester](https://analyst.example/x) reports that 73% of teams churn.",
      "",
    ].join("\n"),
  ],
  [
    "em-dash endnote",
    [
      ...LAUNDERING_BODY,
      "## Evidence",
      "",
      "Activation tracking cuts churn by 42% — [Forrester, 2024](https://analyst.example/x)",
      "",
    ].join("\n"),
  ],
  [
    "footnote marker",
    [
      ...LAUNDERING_BODY,
      "## Evidence",
      "",
      "Activation tracking cuts churn by 42%.[^1]",
      "",
      "[^1]: Forrester Digital Experience Report, 2024",
      "",
    ].join("\n"),
  ],
];
