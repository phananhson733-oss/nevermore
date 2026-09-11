// Any postcss config file replaces Next's built-in chain (flexbugs fixes +
// preset-env/autoprefixer), which today prefixes the legacy CSS Modules
// (backdrop-filter, sticky, appearance, ...). Restate that chain first, using
// the copies Next ships and its own default browser targets
// (next/dist/shared/lib/modern-browserslist-target.js), so legacy output stays
// byte-identical; Tailwind runs last so its output is never re-processed.
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
