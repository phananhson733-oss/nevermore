/**
 * Keyword and AI prompt templates (jsx:561-577) and the generic SERP domain
 * pool. Data only, split out of keywords.ts for file size; import it through
 * keywords.ts, which re-exports all of it.
 */
import type { Engine, Intent, PageType, Stage } from "../types.ts";

export interface KeywordPattern {
  readonly make: (seed: string) => string;
  readonly intent: Intent;
  readonly stage: Stage;
  readonly page: PageType;
  readonly engine: Engine;
  /** The `${seed} vs` template: buildRows replaces it with `${brand} vs ${competitor}` or skips it. */
  readonly vs?: true;
}

export const PATTERNS: readonly KeywordPattern[] = [
  {
    make: (s) => `best ${s} tools`,
    intent: "commercial",
    stage: "MOFU",
    page: "listicle",
    engine: "both",
  },
  {
    make: (s) => `${s} alternatives`,
    intent: "commercial",
    stage: "BOFU",
    page: "comparison",
    engine: "both",
  },
  {
    make: (s) => `free ${s} tool`,
    intent: "transactional",
    stage: "BOFU",
    page: "tool",
    engine: "seo",
  },
  {
    make: (s) => `${s} template`,
    intent: "informational",
    stage: "MOFU",
    page: "tool",
    engine: "seo",
  },
  {
    make: (s) => `how to ${s}`,
    intent: "informational",
    stage: "TOFU",
    page: "blog",
    engine: "both",
  },
  {
    make: (s) => `what is ${s}`,
    intent: "informational",
    stage: "TOFU",
    page: "glossary",
    engine: "geo",
  },
  {
    make: (s) => `${s} checklist`,
    intent: "informational",
    stage: "MOFU",
    page: "blog",
    engine: "seo",
  },
  {
    make: (s) => `${s} for startups`,
    intent: "commercial",
    stage: "MOFU",
    page: "landing",
    engine: "seo",
  },
  {
    make: (s) => `${s} pricing`,
    intent: "transactional",
    stage: "BOFU",
    page: "landing",
    engine: "seo",
  },
  {
    make: (s) => `${s} vs`,
    intent: "commercial",
    stage: "BOFU",
    page: "comparison",
    engine: "both",
    vs: true,
  },
];

export const AI_PATTERNS: readonly ((seed: string, brand: string) => string)[] =
  [
    (seed) => `which ${seed} tool works best for a small team?`,
    (seed) => `what should I look for in a ${seed} tool?`,
    (seed, brand) => `is ${brand} good for ${seed}?`,
  ];

/** Generic third-party domains only: competitor names are never turned into invented domains (R9). */
export const SERP_POOL: readonly string[] = [
  "g2.com",
  "reddit.com",
  "capterra.com",
  "medium.com",
  "producthunt.com",
];
