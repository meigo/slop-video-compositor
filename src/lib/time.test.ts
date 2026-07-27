import { describe, it, expect } from "vitest";
import { formatTimestamp, clamp } from "./time";

describe("formatTimestamp", () => {
  it("formats under an hour as MM:SS", () => {
    expect(formatTimestamp(72)).toBe("01:12");
  });
  it("formats hours", () => {
    expect(formatTimestamp(3661)).toBe("1:01:01");
  });
});

describe("clamp", () => {
  it("clamps to range", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});
