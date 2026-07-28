import { describe, it, expect } from "vitest";
import { formatTimestamp, clamp, roundTo } from "./time";

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

describe("roundTo", () => {
  it("rounds float noise for display", () => {
    expect(roundTo(6.4953889992537315, 2)).toBe(6.5);
    expect(roundTo(1.2345, 2)).toBe(1.23);
    expect(roundTo(10.4, 0)).toBe(10);
  });
});

