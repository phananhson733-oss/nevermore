import { citabilityCheck, CITABILITY_TEXT_FLOOR_CHARS, type CitabilityCheck, type CitabilityInput } from "./citability-contract.ts";
import { CITABILITY_RAW_RENDER_RATIO_FLOOR } from "./citability-render-contract.ts";

/** The SSR row consumes a comparable measured pair; raw-only absence is not a ratio. */
export function citabilityRenderCheck(input: CitabilityInput): CitabilityCheck {
  if (!input.bodyComplete) return citabilityCheck("ssr", "readable", "deterministic", "counted", "fetchError", { key: "truncated", values: { chars: input.rawHtml.length } });
  const render = input.render;
  if (!render || render.status !== "measured" || !render.rendered) {
    return citabilityCheck("ssr", "readable", "deterministic", "counted", "fetchError", { key: "ssr.renderUnavailable", values: { reason: render?.reason ?? "not_configured" } });
  }
  if (render.rawToRenderedRatio === null) {
    return citabilityCheck("ssr", "readable", "deterministic", "counted", "fail", { key: "ssr.renderEmpty" }, { key: "ssr.renderEmpty" });
  }
  const ratioDetail = { key: "ssr.renderRatio", values: { raw: render.raw.textChars, rendered: render.rendered.textChars, ratio: Math.round(render.rawToRenderedRatio * 1000) / 10, threshold: CITABILITY_RAW_RENDER_RATIO_FLOOR * 100 } };
  if (render.rawToRenderedRatio < CITABILITY_RAW_RENDER_RATIO_FLOOR) {
    return citabilityCheck("ssr", "readable", "deterministic", "counted", "fail", ratioDetail, { key: "ssr.renderRatio" });
  }
  const chars = render.raw.textChars;
  return chars >= CITABILITY_TEXT_FLOOR_CHARS
    ? citabilityCheck("ssr", "readable", "deterministic", "counted", "pass", ratioDetail)
    : citabilityCheck("ssr", "readable", "deterministic", "counted", "fail", { key: "ssr.thin", values: { chars, floor: CITABILITY_TEXT_FLOOR_CHARS } }, { key: "ssr.thin" });
}
