import { describe, expect, it } from "vitest";
import { defaultExportFileName } from "./exportName";
import { createProject, defaultTransform } from "./project";
import type { Clip, Project } from "./types";

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: "c1",
    sourcePath: "/a.mp4",
    sourceIn: 0,
    sourceOut: 2,
    timelineStart: 0,
    transform: defaultTransform(),
    ...over,
  };
}

/** Fresh project: name "Untitled", duration 10, two empty tracks. */
function proj(over: Partial<Project> = {}): Project {
  return { ...createProject(), ...over };
}

describe("defaultExportFileName", () => {
  it("falls back to a generic label when unsaved and unnamed", () => {
    expect(defaultExportFileName(proj(), null)).toBe("export_10s_0clip.mp4");
  });

  it("uses the project file stem when the name is still the default", () => {
    expect(defaultExportFileName(proj(), "/x/beach-edit.json")).toBe(
      "beach-edit_10s_0clip.mp4",
    );
  });

  it("prefers an explicit project name over the filename", () => {
    expect(defaultExportFileName(proj({ name: "Beach Montage" }), "/x/proj.json")).toBe(
      "Beach_Montage_10s_0clip.mp4",
    );
  });

  it("strips only the last extension", () => {
    expect(defaultExportFileName(proj(), "/x/beach.edit.v2.json")).toBe(
      "beach.edit.v2_10s_0clip.mp4",
    );
  });

  it("handles a path with no extension", () => {
    expect(defaultExportFileName(proj(), "/x/proj")).toBe("proj_10s_0clip.mp4");
  });

  it("handles a Windows-style path", () => {
    expect(defaultExportFileName(proj(), "C:\\x\\beach.json")).toBe(
      "beach_10s_0clip.mp4",
    );
  });

  it("sanitizes characters that are illegal in filenames", () => {
    expect(defaultExportFileName(proj({ name: "a/b:c" }), null)).toBe(
      "a_b_c_10s_0clip.mp4",
    );
  });

  it("caps a long label at 48 characters", () => {
    const long = "x".repeat(60);
    expect(defaultExportFileName(proj({ name: long }), null)).toBe(
      `${"x".repeat(48)}_10s_0clip.mp4`,
    );
  });

  it("uses a decimal tag for sub-second durations", () => {
    expect(defaultExportFileName(proj({ duration: 0.4 }), null)).toBe(
      "export_0.4s_0clip.mp4",
    );
  });

  it("counts clips across all tracks", () => {
    const p = createProject();
    p.tracks[0].clips.push(clip({ id: "a" }));
    p.tracks[1].clips.push(clip({ id: "b" }));
    expect(defaultExportFileName(p, null)).toBe("export_10s_2clip.mp4");
  });
});
