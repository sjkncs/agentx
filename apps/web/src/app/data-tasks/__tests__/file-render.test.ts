import { describe, expect, it } from "vitest";

import { detectRenderKind, parseCsv } from "../file-render";

describe("detectRenderKind", () => {
  it("detects markdown by ext and mime", () => {
    expect(detectRenderKind("notes.md")).toBe("markdown");
    expect(detectRenderKind("README", "text/markdown")).toBe("markdown");
  });
  it("detects csv/tsv/json/image/code/text", () => {
    expect(detectRenderKind("data.csv")).toBe("csv");
    expect(detectRenderKind("data.tsv")).toBe("csv");
    expect(detectRenderKind("config.json")).toBe("json");
    expect(detectRenderKind("pic.png", "image/png")).toBe("image");
    expect(detectRenderKind("app.ts")).toBe("code");
    expect(detectRenderKind("run.sql")).toBe("code");
    expect(detectRenderKind("log.txt")).toBe("text");
  });
});

describe("parseCsv", () => {
  it("splits csv rows and cells, trimming and capping", () => {
    const rows = parseCsv("a, b\n1,2\n\n3,4", "x.csv");
    expect(rows).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });
  it("uses tab delimiter for tsv", () => {
    expect(parseCsv("a\tb\n1\t2", "x.tsv")).toEqual([["a", "b"], ["1", "2"]]);
  });
});
