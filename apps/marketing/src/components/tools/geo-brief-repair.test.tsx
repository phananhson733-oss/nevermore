// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GeoBriefSharedTool } from "./geo-brief-shared-tool.tsx";
import { consumeGeoKnowledgeRepair, writeGeoBriefReturn } from "../../lib/geo-tools/brief-knowledge-handoff.ts";
vi.mock("next-intl", () => ({ useLocale: () => "zh", useTranslations: () => (key: string) => key }));
const kbId = "11111111-1111-4111-8111-111111111111";
const snapshotId = "22222222-2222-4222-8222-222222222222";
const choice = { kbId, snapshotId, revision: 2, host: "example.com", frozenAt: "2026-08-31T00:00:00Z",
  market: {country:"US",language:"en"}, properNames:[],
  evidenceSummary:{snapshotFacts:1,contextFacts:1,usableFacts:1,missingFacts:0,profileAttached:false,contextAttached:true},
  questions:[{id:"q1",text:"Which astrology tools help beginners?",layer:"discovery",roleId:null,role:null,qualityIssues:[]}] };
let root: Root; let host: HTMLDivElement;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; window.sessionStorage.clear(); window.history.replaceState(null,"","/zh/tools/geo-brief"); host=document.createElement("div");document.body.append(host);root=createRoot(host); });
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function mount(){await act(async()=>root.render(<GeoBriefSharedTool/>));}
function mockLoad(value=choice){const fetch=vi.fn(async(_url: RequestInfo | URL, _init?: RequestInit)=>Response.json({data:{choices:[value],runsPerDay:20,providerConfigured:true}}));vi.stubGlobal("fetch",fetch);return fetch;}
it("returns to the exact new knowledge version and question without generating",async()=>{
  window.history.replaceState(null,"","/zh/tools/geo-brief?resume=knowledge");
  writeGeoBriefReturn(window.sessionStorage,{kbId,snapshotId,questionId:"q1"});const fetch=mockLoad();await mount();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({schema:"gengrowth.content_brief/v1.1",kbId,snapshotId});
  expect(host.querySelector<HTMLSelectElement>("#geo-brief-question")?.value).toBe("q1");
  expect(host.textContent).toContain("quality.returnReady");
  expect(host.querySelector<HTMLButtonElement>("[data-run-geo-brief]")?.disabled).toBe(false);
});
it("preserves a manually typed question across knowledge repair",async()=>{
  window.history.replaceState(null,"","/zh/tools/geo-brief?resume=knowledge");
  writeGeoBriefReturn(window.sessionStorage,{kbId,snapshotId,questionId:null,manualQuestion:"How can beginners compare astrology tools?"});mockLoad();await mount();
  expect(host.querySelector<HTMLTextAreaElement>("#geo-brief-manual")?.value).toBe("How can beginners compare astrology tools?");
});
it("reports missing return context instead of silently loading a different version",async()=>{
  window.history.replaceState(null,"","/zh/tools/geo-brief?resume=knowledge");const fetch=mockLoad();await mount();
  expect(fetch).not.toHaveBeenCalled();expect(host.textContent).toContain("errors.knowledge_return_invalid");
});
it("keeps correction of a manually typed language error on the current form",async()=>{
  window.history.replaceState(null,"","/zh/tools/geo-brief?resume=knowledge");
  writeGeoBriefReturn(window.sessionStorage,{kbId,snapshotId,questionId:null,manualQuestion:"How do 占星工具 compare?"});mockLoad();await mount();
  expect(host.querySelector('[data-geo-knowledge-repair="question"]')).toBeNull();
  const edit=host.querySelector<HTMLButtonElement>('[data-edit-geo-question]');expect(edit).not.toBeNull();
  await act(async()=>edit!.click());expect(document.activeElement).toBe(host.querySelector('#geo-brief-manual'));
});
it("stages the currently selected version when opening knowledge repair",async()=>{
  mockLoad();await mount();await act(async()=>host.querySelector<HTMLElement>("[data-load-geo-brief]")!.click());
  const link=host.querySelector<HTMLAnchorElement>('[data-geo-knowledge-repair="facts"]');expect(link).not.toBeNull();
  expect(link?.getAttribute("href")).toBe("/zh/tools/geo-knowledge-base?repair=brief");
  link!.addEventListener("click",event=>event.preventDefault());await act(async()=>link!.click());
  expect(consumeGeoKnowledgeRepair(window.sessionStorage)).toEqual({kbId,snapshotId,questionId:"q1",manualQuestion:null,reason:"facts"});
});
it.each(["contextmenu", "auxclick"])("stages repair before native %s navigation",async(kind)=>{
  mockLoad();await mount();await act(async()=>host.querySelector<HTMLElement>("[data-load-geo-brief]")!.click());
  const link=host.querySelector<HTMLAnchorElement>('[data-geo-knowledge-repair="facts"]')!;
  await act(async()=>{link.dispatchEvent(new MouseEvent(kind,{bubbles:true,cancelable:true,button:kind==='auxclick'?1:2}));});
  expect(consumeGeoKnowledgeRepair(window.sessionStorage)?.kbId).toBe(kbId);
});
