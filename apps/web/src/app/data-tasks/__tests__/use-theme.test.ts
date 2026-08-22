import { describe, expect, it } from "vitest";

import { THEMES } from "../use-theme";

describe("use-theme tokens", () => {
  it("exposes four themes including a 'soft' low-contrast variant", () => {
    const ids = THEMES.map((t) => t.id);
    expect(ids).toContain("light");
    expect(ids).toContain("dark");
    expect(ids).toContain("deepseek");
    expect(ids).toContain("soft");
  });

  it("soft theme has a warm surface color", () => {
    const soft = THEMES.find((t) => t.id === "soft")!;
    expect(soft.surface).toMatch(/^#f[0-9a-f]+$/i);
  });

  it("every theme has a swatch + surface + description", () => {
    for (const th of THEMES) {
      expect(th.swatch).toMatch(/^#[0-9a-f]{3,6}$/i);
      expect(th.surface).toMatch(/^#[0-9a-f]{3,6}$/i);
      expect(typeof th.description).toBe("string");
    }
  });
});
