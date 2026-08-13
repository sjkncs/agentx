import { describe, expect, it } from "vitest";

import type { LiveWebSource } from "../live-run-state";
import { linkifyWebCitations } from "../web-citations";

const sources: LiveWebSource[] = [
  { index: 1, title: "A", url: "https://a.example", snippet: "" },
  { index: 2, title: "B", url: "https://b.example", snippet: "" },
];

describe("linkifyWebCitations", () => {
  it("rewrites [source:n] into markdown links to the traced url", () => {
    const out = linkifyWebCitations("Fact one [source:1] and two [source:2].", sources);
    expect(out).toContain("[【1】](https://a.example)");
    expect(out).toContain("[【2】](https://b.example)");
    expect(out).not.toContain("[source:1]");
  });

  it("tolerates spaces and case in the citation token", () => {
    const out = linkifyWebCitations("x [ source : 2 ] y [SOURCE:1]", sources);
    expect(out).toContain("[【2】](https://b.example)");
    expect(out).toContain("[【1】](https://a.example)");
  });

  it("leaves unknown indices and missing sources untouched", () => {
    expect(linkifyWebCitations("no cite [source:9]", sources)).toBe("no cite [source:9]");
    expect(linkifyWebCitations("plain [source:1]", undefined)).toBe("plain [source:1]");
    expect(linkifyWebCitations("", sources)).toBe("");
  });
});
