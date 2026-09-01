# Marketing UI primitives

Shared visual and interaction primitives for the Marketing site. Reuse these
controls rather than duplicating their border, sizing, hover, and focus recipes.

- `button.tsx`: native/slot Button and shared button variants.
- `input.tsx`: native Input with shared sizing, border and focus treatment.
- Both resolve `cn` relatively from Marketing's `lib/utils.ts`, so real controls
  can run under the root unit suite without its App-only `@/` alias leaking in.
  This does not change their rendered styling or runtime behaviour.
- Other primitives in this directory retain their existing contracts.
