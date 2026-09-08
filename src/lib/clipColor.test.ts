import { describe, it, expect } from "vitest";
import { colorToSolid, colorToVars, hashString, normalizePathKey } from "./clipColor";

describe("helpers", () => {
  it("hashString is deterministic", () => {
    expect(hashString("foo")).toBe(hashString("foo"));
    expect(hashString("foo")).not.toBe(hashString("bar"));
  });

  it("normalizePathKey unifies separators", () => {
    expect(normalizePathKey(String.raw`a\b\c`)).toBe("a/b/c");
  });

  it("colorToVars renders an already-assigned color as custom properties", () => {
    expect(colorToVars({ h: 200, s: 65, l: 52 })).toBe("--clip-h:200;--clip-s:65;--clip-l:52");
  });

  it("colorToSolid renders an already-assigned color as an hsl string", () => {
    expect(colorToSolid({ h: 200, s: 65, l: 52 })).toBe("hsl(200 65% 52%)");
  });
});
