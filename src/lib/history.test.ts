import { describe, it, expect } from "vitest";
import {
  historyInit,
  historyPush,
  historyUndo,
  historyRedo,
  canUndo,
  canRedo,
  type History,
} from "./history";

describe("historyInit", () => {
  it("sets present with empty past and future", () => {
    const h = historyInit(1);
    expect(h).toEqual({ past: [], present: 1, future: [] });
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });
});

describe("historyPush", () => {
  it("pushes present onto past, sets next present, clears future", () => {
    let h = historyInit("a");
    h = historyPush(h, "b");
    expect(h).toEqual({ past: ["a"], present: "b", future: [] });
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
  });

  it("clears future on new push after undo", () => {
    let h = historyInit(0);
    h = historyPush(h, 1);
    h = historyPush(h, 2);
    h = historyUndo(h);
    expect(h.present).toBe(1);
    expect(canRedo(h)).toBe(true);

    h = historyPush(h, 99);
    expect(h).toEqual({ past: [0, 1], present: 99, future: [] });
    expect(canRedo(h)).toBe(false);
  });

  it("caps past at max (default 50)", () => {
    let h = historyInit(0);
    for (let i = 1; i <= 55; i++) {
      h = historyPush(h, i);
    }
    expect(h.past).toHaveLength(50);
    expect(h.past[0]).toBe(5); // dropped 0..4
    expect(h.past[49]).toBe(54);
    expect(h.present).toBe(55);
  });

  it("respects custom max", () => {
    let h = historyInit("a");
    h = historyPush(h, "b", 2);
    h = historyPush(h, "c", 2);
    h = historyPush(h, "d", 2);
    expect(h.past).toEqual(["b", "c"]);
    expect(h.present).toBe("d");
  });
});

describe("historyUndo / historyRedo", () => {
  it("undo moves present to future and pops past", () => {
    let h: History<string> = historyInit("a");
    h = historyPush(h, "b");
    h = historyPush(h, "c");
    h = historyUndo(h);
    expect(h).toEqual({ past: ["a"], present: "b", future: ["c"] });
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(true);
  });

  it("redo reverses undo", () => {
    let h = historyInit("a");
    h = historyPush(h, "b");
    h = historyPush(h, "c");
    h = historyUndo(h);
    h = historyUndo(h);
    expect(h.present).toBe("a");
    h = historyRedo(h);
    expect(h).toEqual({ past: ["a"], present: "b", future: ["c"] });
    h = historyRedo(h);
    expect(h).toEqual({ past: ["a", "b"], present: "c", future: [] });
    expect(canRedo(h)).toBe(false);
  });

  it("undo is no-op when past empty", () => {
    const h = historyInit(42);
    expect(historyUndo(h)).toEqual(h);
  });

  it("redo is no-op when future empty", () => {
    const h = historyInit(42);
    expect(historyRedo(h)).toEqual(h);
  });
});
