/**
 * The pinned Flow adapter version for the SEO/GEO Content Shadow capability.
 *
 * This is a SERVER-FIXED constant (Slice 2 decision R3): an operator may never
 * choose which adapter revision a shadow run pins. It participates in the frozen
 * input tuple that produces `flow_shadow_runs.content_hash`, so advancing this
 * constant makes every previously frozen run non-replayable by construction —
 * the worker recomputes the tuple and fails the run with an input-drift error
 * rather than silently re-rendering under a different adapter.
 *
 * The adapter is an EXTRACTION, never a runtime import: nothing in this package
 * may reach into the sibling `gengrowth-flow-mvp` repository at runtime
 * (Slice 2 red line D). Ported logic is rewritten here as dependency-free
 * TypeScript.
 */
export const CONTENT_SHADOW_ADAPTER_VERSION = "content-shadow-adapter.0.3.0";
