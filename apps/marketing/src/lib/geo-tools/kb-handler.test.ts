import { describe, expect, it, vi } from "vitest";

import {
  handleGeoKbFreeze,
  handleGeoKbImport,
  handleGeoKbLoad,
  handleGeoKbSaveDraft,
  type GeoKbHandlerDependencies,
} from "./kb-handler.ts";
import { emptyGeoKbPayload, type GeoKbPayload } from "./kb-contract.ts";
import { buildGeoSnapshotContext } from "./snapshot-context.ts";

const READY: GeoKbPayload = {
  ...emptyGeoKbPayload("https://acme-kb-example.com/"),
  officialName: "Acme",
  aliases: ["Acme Analytics"],
  categoryTerms: ["project management"],
  roles: [
    {
      id: "r1",
      label: "agency owners",
      segment: "5 to 20 person agencies",
      painPoints: ["missed deadlines"],
      decisionCriteria: ["price"],
      vocabulary: ["client work"],
    },
  ],
  competitors: [{ domain: "linear.app", brandName: "Linear", confirmed: true }],
};

function post(url: string, body: unknown): Request {
  return new Request(`https://gengrowth.ai${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://gengrowth.ai",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function deps(
  overrides: Partial<GeoKbHandlerDependencies> = {},
): GeoKbHandlerDependencies {
  return {
    authenticate: async () => ({ ok: true, userId: "user-1" }),
    loadKnowledgeBase: async () => ({
      kind: "ok",
      value: {
        kbId: "kb-1",
        origin: "https://acme-kb-example.com",
        host: "acme-kb-example.com",
        draftVersion: 2,
        payload: READY,
        frozen: null,
        importAvailable: true,
      },
    }),
    saveDraft: async () => ({
      kind: "ok",
      value: { draftVersion: 3, updatedAt: "2026-08-29T10:00:00.000Z" },
    }),
    freeze: async () => ({
      kind: "ok",
      value: {
        snapshotId: "snap-1",
        revision: 1,
        frozenAt: "2026-08-29T10:00:00.000Z",
        contentHash: "a".repeat(64),
        questionCount: 15,
        retrievalCount: 13,
        reusedExisting: false,
      },
    }),
    readDraftPayload: async () => ({
      kind: "ok",
      value: { payload: READY, draftVersion: 2 },
    }),
    importFromProfile: async () => ({ kind: "ok", value: READY }),
    ...overrides,
  };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("authentication", () => {
  it("refuses every endpoint before reading the body", async () => {
    const loadKnowledgeBase = vi.fn();
    const unauthenticated: Partial<GeoKbHandlerDependencies> = {
      authenticate: async () => ({
        ok: false,
        response: Response.json({ error: { code: "auth_required" } }, { status: 401 }),
      }),
      loadKnowledgeBase,
    };
    const response = await handleGeoKbLoad(
      post("/api/tools/geo-knowledge-base/load", { url: "https://x.test/" }),
      deps(unauthenticated),
    );
    expect(response.status).toBe(401);
    expect(loadKnowledgeBase).not.toHaveBeenCalled();
  });
});

describe("load", () => {
  it("refuses a request with an extra field", async () => {
    const response = await handleGeoKbLoad(
      post("/api/tools/geo-knowledge-base/load", {
        url: "https://acme-kb-example.com/",
        kbId: "kb-1",
      }),
      deps(),
    );
    expect(response.status).toBe(400);
  });

  it("refuses a URL this tool cannot use", async () => {
    const response = await handleGeoKbLoad(
      post("/api/tools/geo-knowledge-base/load", { url: "not a url" }),
      deps(),
    );
    expect(response.status).toBe(400);
    expect((await body(response)).error).toEqual({ code: "invalid_url" });
  });

  it("returns the knowledge base for this account", async () => {
    const response = await handleGeoKbLoad(
      post("/api/tools/geo-knowledge-base/load", {
        url: "https://acme-kb-example.com/",
      }),
      deps(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const data = (await body(response)).data as { kbId: string };
    expect(data.kbId).toBe("kb-1");
  });

  it("never forwards the store's own words about why it failed", async () => {
    const response = await handleGeoKbLoad(
      post("/api/tools/geo-knowledge-base/load", {
        url: "https://acme-kb-example.com/",
      }),
      deps({
        loadKnowledgeBase: async () => ({
          kind: "unavailable",
          reason: "relation public.marketing_geo_kb_drafts does not exist",
        }),
      }),
    );
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain("store_unavailable");
    expect(text).not.toContain("marketing_geo_kb_drafts");
  });
});

describe("save draft", () => {
  it("names the field that made the payload unusable", async () => {
    const response = await handleGeoKbSaveDraft(
      post("/api/tools/geo-knowledge-base/draft", {
        kbId: "kb-1",
        payload: { ...READY, market: { country: "USA", language: "en" } },
        baseVersion: 2,
      }),
      deps(),
    );
    expect(response.status).toBe(400);
    const parsed = await body(response);
    expect(parsed.error).toEqual({ code: "invalid_payload" });
    expect(parsed.reason).toBe("market");
  });

  it("returns the version the store now holds when another tab saved first", async () => {
    const response = await handleGeoKbSaveDraft(
      post("/api/tools/geo-knowledge-base/draft", {
        kbId: "kb-1",
        payload: READY,
        baseVersion: 2,
      }),
      deps({
        saveDraft: async () => ({ kind: "conflict", draftVersion: 7 }),
      }),
    );
    expect(response.status).toBe(409);
    const parsed = await body(response);
    expect(parsed.error).toEqual({ code: "conflict" });
    expect(parsed.draftVersion).toBe(7);
  });

  it("returns what still blocks a freeze alongside the save", async () => {
    const response = await handleGeoKbSaveDraft(
      post("/api/tools/geo-knowledge-base/draft", {
        kbId: "kb-1",
        payload: { ...READY, competitors: [] },
        baseVersion: 2,
      }),
      deps(),
    );
    expect(response.status).toBe(200);
    const data = (await body(response)).data as { blockers: string[] };
    expect(data.blockers).toContain("no_confirmed_competitor");
  });
});

describe("freeze", () => {
  it("uses source-conditioned frozen questions and returns their role/entities", async () => {
    const kbId = "11111111-1111-4111-8111-111111111113";
    const payload = { ...READY, roles: [] };
    const generated = buildGeoSnapshotContext({ kbId, targetHost: "acme-kb-example.com", payload, profile: null, receipt: null });
    const dependencies = deps({ readDraftPayload: async () => ({ kind: "ok", value: { payload, draftVersion: 2, ...generated } }) });
    const freeze = vi.fn(dependencies.freeze);
    const response = await handleGeoKbFreeze(post("/api/tools/geo-knowledge-base/freeze", { kbId, baseVersion: 2, contextHash: generated.context.contentHash }), { ...dependencies, freeze });
    expect(response.status).toBe(200);
    expect(freeze).toHaveBeenCalledWith(expect.objectContaining(generated));
    const data = (await response.json()).data;
    expect(data.questions).toEqual(generated.questionSet.questions);
  });

  it("refuses an unseen source-context change rather than freezing different Profile facts", async () => {
    const kbId = "11111111-1111-4111-8111-111111111113";
    const generated = buildGeoSnapshotContext({ kbId, targetHost: "acme-kb-example.com", payload: READY, profile: null, receipt: null });
    const freeze = vi.fn(deps().freeze);
    const response = await handleGeoKbFreeze(post("/api/tools/geo-knowledge-base/freeze", { kbId, baseVersion: 2 }), deps({ freeze, readDraftPayload: async () => ({ kind: "ok", value: { payload: READY, draftVersion: 2, ...generated } }) }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("context_stale");
    expect(freeze).not.toHaveBeenCalled();
  });

  it("refuses while a blocker stands, and does not call the store", async () => {
    const freeze = vi.fn();
    const response = await handleGeoKbFreeze(
      post("/api/tools/geo-knowledge-base/freeze", {
        kbId: "kb-1",
        baseVersion: 2,
      }),
      deps({
        freeze,
        readDraftPayload: async () => ({
          kind: "ok",
          value: { payload: { ...READY, roles: [] }, draftVersion: 2 },
        }),
      }),
    );
    expect(response.status).toBe(422);
    const parsed = await body(response);
    expect(parsed.blockers).toContain("role_missing");
    expect(freeze).not.toHaveBeenCalled();
  });

  it("refuses when the caller is freezing a version it has not seen", async () => {
    const freeze = vi.fn();
    const response = await handleGeoKbFreeze(
      post("/api/tools/geo-knowledge-base/freeze", {
        kbId: "kb-1",
        baseVersion: 1,
      }),
      deps({ freeze }),
    );
    expect(response.status).toBe(409);
    expect(freeze).not.toHaveBeenCalled();
  });

  it("derives the question set here rather than taking one from the client", async () => {
    const freeze = vi.fn(async () => ({
      kind: "ok" as const,
      value: {
        snapshotId: "snap-1",
        revision: 1,
        frozenAt: "2026-08-29T10:00:00.000Z",
        contentHash: "a".repeat(64),
        questionCount: 15,
        retrievalCount: 13,
        reusedExisting: false,
      },
    }));
    const response = await handleGeoKbFreeze(
      post("/api/tools/geo-knowledge-base/freeze", {
        kbId: "kb-1",
        baseVersion: 2,
      }),
      deps({ freeze }),
    );
    expect(response.status).toBe(200);
    const call = (freeze.mock.calls as readonly unknown[][])[0]?.[0] as {
      questionSet: { questions: readonly { text: string }[] };
    };
    expect(call.questionSet.questions.length).toBeGreaterThan(5);
    // A question set that named an unconfirmed competitor would mean the run
    // asked about a brand nobody confirmed the spelling of.
    expect(
      call.questionSet.questions.every(
        (question) => !question.text.includes("undefined"),
      ),
    ).toBe(true);

    const data = (await body(response)).data as {
      questions: readonly { calibrated: boolean }[];
    };
    expect(data.questions.some((question) => !question.calibrated)).toBe(true);
  });
});

describe("import", () => {
  it("returns a prefill without saving it", async () => {
    const saveDraft = vi.fn();
    const response = await handleGeoKbImport(
      post("/api/tools/geo-knowledge-base/import", { kbId: "kb-1" }),
      deps({ saveDraft }),
    );
    expect(response.status).toBe(200);
    const data = (await body(response)).data as { payload: GeoKbPayload };
    expect(data.payload.officialName).toBe("Acme");
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("reports a missing knowledge base as missing", async () => {
    const response = await handleGeoKbImport(
      post("/api/tools/geo-knowledge-base/import", { kbId: "kb-9" }),
      deps({ importFromProfile: async () => ({ kind: "not_found" }) }),
    );
    expect(response.status).toBe(404);
  });
});
