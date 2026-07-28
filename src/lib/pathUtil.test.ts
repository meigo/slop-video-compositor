import { describe, it, expect } from "vitest";
import { basename, truncateMiddle } from "./pathUtil";

describe("basename", () => {
  it("takes last path segment", () => {
    expect(basename("/a/b/c.mp4")).toBe("c.mp4");
    expect(basename(String.raw`C:\clips\x.mp4`)).toBe("x.mp4");
  });
});

describe("truncateMiddle", () => {
  it("leaves short names alone", () => {
    expect(truncateMiddle("short.mp4", 40)).toBe("short.mp4");
  });

  it("keeps head and tail for long names", () => {
    const long =
      "Человек с бульвара Капуцинов (FullHD, комедия, реж. Алла Сурикова, 1987 г.)_05m43s-06m00s.mp4";
    const t = truncateMiddle(long, 40);
    expect(t.length).toBeLessThanOrEqual(40);
    expect(t.startsWith("Человек")).toBe(true);
    expect(t.endsWith(".mp4")).toBe(true);
    expect(t).toContain("…");
  });
});
