import { describe, expect, it } from "vitest";

import { buildFollowUpSuggestions } from "../components/chat/follow-up-suggestions";

describe("buildFollowUpSuggestions", () => {
  it("returns empty when the run is not completed", () => {
    expect(
      buildFollowUpSuggestions({ runStatus: "running", auditsCount: 1, artifactsCount: 1 }),
    ).toEqual([]);
    expect(
      buildFollowUpSuggestions({ runStatus: "idle", auditsCount: 0, artifactsCount: 0 }),
    ).toEqual([]);
  });

  it("includes export suggestion when SQL audits ran", () => {
    const keys = buildFollowUpSuggestions({
      runStatus: "completed",
      auditsCount: 2,
      artifactsCount: 0,
    });
    expect(keys).toContain("suggestionExportResults");
    expect(keys).not.toContain("suggestionSummarizeOutputs");
    expect(keys).toContain("suggestionGoDeeper");
  });

  it("includes summarize suggestion when artifacts exist", () => {
    const keys = buildFollowUpSuggestions({
      runStatus: "completed",
      auditsCount: 0,
      artifactsCount: 3,
    });
    expect(keys).toContain("suggestionSummarizeOutputs");
    expect(keys).not.toContain("suggestionExportResults");
  });

  it("caps suggestions at three and always offers go-deeper", () => {
    const keys = buildFollowUpSuggestions({
      runStatus: "completed",
      auditsCount: 5,
      artifactsCount: 5,
    });
    expect(keys.length).toBeLessThanOrEqual(3);
    expect(keys.at(-1)).toBe("suggestionGoDeeper");
  });
});
