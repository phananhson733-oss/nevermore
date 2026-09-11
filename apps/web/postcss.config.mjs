// A postcss config file changes both bundlers' CSS pipelines:
// - webpack (`next dev --webpack`, used by the mock e2e harness): it REPLACES Next's
//   built-in chain (flexbugs fixes + preset-env/autoprefixer) that prefixes the legacy
//   CSS Modules (backdrop-filter, sticky, appearance, ...), so that chain is restated
//   here first, with Next's own default browser targets
//   (next/dist/shared/lib/modern-browserslist-target.js), and Tailwind runs last.
// - Turbopack (`next dev` / `next build`, the shipping path): without a config no postcss
//   ran at all; with this one the same chain now runs there too. It is additive
//   (prefixes only), and e2e/legacy-style-parity.mock.spec.ts was run once against a
//   Turbopack dev server to confirm legacy computed styles do not move.
// Turbopack resolves the config from the repo root first: a postcss config at the
// monorepo root would silently shadow this file. Keep the root free of one.
export default {
  plugins: {
    "next/dist/compiled/postcss-flexbugs-fixes": {},
    "next/dist/compiled/postcss-preset-env": {
      browsers: ["chrome 111", "edge 111", "firefox 111", "safari 16.4"],
      autoprefixer: { flexbox: "no-2009" },
      stage: 3,
      features: { "custom-properties": false },
    },
    "@tailwindcss/postcss": {},
  },
};
