import { describe, expect, it } from "vitest";
import { injectDraftAuthFixture, injectVisibilityAuthFixture } from "./geo-chain-harness.ts";

const push = (text: string) => `<script>self.__next_f.push(${JSON.stringify([1, text])})</script>`;
const moduleRow = 'd:I[111,["local-chunk.js"],"AiVisibilityCheck"]\n';
const elementRow = 'e:["$","$Ld",null,{"authentication":"unavailable","locale":"en"}]\n';

describe("explicitly isolated Visibility SSR authentication fixture", () => {
  it("changes only the identified client component once, leaving other auth props unchanged", () => {
    const untouched = '["$","$Lf",null,{"authentication":"unavailable","locale":"en"}]';
    const input = `<main>Original page</main>${push(moduleRow)}${push(elementRow + untouched)}`;
    const output = injectVisibilityAuthFixture(input);
    expect(output).toContain("<main>Original page</main>");
    const streams = [...output.matchAll(/self\.__next_f\.push\((\[[\s\S]*?)\)<\/script>/g)].map(match => (JSON.parse(match[1]!) as [number, string])[1]).join("");
    expect(streams).toContain(elementRow.replace('"unavailable"', '"authenticated"'));
    expect(streams).toContain(untouched);
  });
  it.each([push(elementRow), push(moduleRow + elementRow + elementRow), push(moduleRow + elementRow.replace("$Ld", "$Lf"))])("refuses missing or ambiguous local component identity", html => {
    expect(() => injectVisibilityAuthFixture(html)).toThrow();
  });
});

describe("explicitly isolated Draft SSR authentication fixture", () => {
  const module = 'f:I[112,["draft-chunk.js"],"ContentDraftTool"]\n';
  const element = 'g:["$","$Lf",null,{"locale":"zh","authenticated":false}]\n';
  it("changes only the unique Draft client prop, not another component's authentication", () => {
    const other = '["$","$Ld",null,{"locale":"zh","authenticated":false}]';
    const output = injectDraftAuthFixture(push(module) + push(element + other));
    const decoded = [...output.matchAll(/self\.__next_f\.push\((\[[\s\S]*?)\)<\/script>/g)].map(match => (JSON.parse(match[1]!) as [number, string])[1]).join("");
    expect(decoded).toContain(element.replace('"authenticated":false', '"authenticated":true'));
    expect(decoded).toContain(other);
  });
  it.each([push(element), push(module + element + element), push(module + element.replace("$Lf", "$Ld"))])("refuses missing or ambiguous Draft identity", html => {
    expect(() => injectDraftAuthFixture(html)).toThrow();
  });
});
