/** Shared inputs for demo.test.ts and demo-honesty.test.ts (not a test file itself). */
import type { DemoPayload, Profile } from "../types.ts";
import type { DemoDeps } from "./demo.ts";

/** A brand and nothing else: every placeholder path. Must never be GenGrowth, or the leak scan passes vacuously. */
export const EMPTY_PROFILE: Profile = {
  url: "acme.io",
  brand: "Acme",
  positioning: "",
  features: "",
  competitors: "",
  market: "US",
};

/** Every field filled, more competitors than any module compares. */
export const FULL_PROFILE: Profile = {
  url: "https://www.widgets.co.uk",
  brand: "Widgets",
  positioning: "inventory software for small warehouses",
  features: "barcode scanning, stock alerts, supplier portal",
  competitors: "Sortly, inFlow, Zoho Inventory, Fishbowl, Cin7, Katana, Odoo, Unleashed",
  market: "GB",
};

export const PROFILES: readonly (readonly [name: string, profile: Profile])[] = [
  ["EMPTY", EMPTY_PROFILE],
  ["FULL", FULL_PROFILE],
];

export const DEMO_PAYLOAD_KEYS: readonly (keyof DemoPayload)[] = [
  "artifacts",
  "audit",
  "auditHistory",
  "built",
  "compData",
  "conns",
  "gscRows",
  "kb",
  "lastAudit",
  "lastVis",
  "plans",
  "profileDoc",
  "saved",
  "seeds",
  "targets",
  "visHistory",
  "visResults",
];

export const LOCAL_STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
export const SAMPLE_FILL_EVIDENCE = "示例，未核对";

export function provenanceLine(at: string): string {
  return `PROVENANCE ${at}`;
}

/** Create the Date inside the test when the timezone matters: `new Date(y, m, d)` reads TZ at call time. */
export function testDeps(now: Date = new Date(2026, 8, 13, 12, 0)): DemoDeps {
  return { now, provenanceLine };
}

/** Every stamp field of a payload, labelled for failure messages. */
export function payloadStamps(payload: DemoPayload): readonly (readonly [label: string, at: string])[] {
  return [
    ...(payload.audit === null ? [] : [["audit.at", payload.audit.at] as const]),
    ...(payload.lastAudit === null ? [] : [["lastAudit.at", payload.lastAudit.at] as const]),
    ...payload.auditHistory.map((report, i) => [`auditHistory[${i}].at`, report.at] as const),
    ...(payload.lastVis === null ? [] : [["lastVis.at", payload.lastVis.at] as const]),
    ...payload.visHistory.map((snapshot, i) => [`visHistory[${i}].at`, snapshot.at] as const),
    ...(payload.kb === null ? [] : [["kb.at", payload.kb.at] as const]),
    ...(payload.profileDoc === null ? [] : [["profileDoc.at", payload.profileDoc.at] as const]),
    ...(payload.compData === null ? [] : [["compData.at", payload.compData.at] as const]),
    ...payload.saved.map((entry, i) => [`saved[${i}].addedAt`, entry.addedAt] as const),
    ...payload.artifacts.map((artifact) => [`artifacts[${artifact.id}].at`, artifact.at] as const),
  ];
}
