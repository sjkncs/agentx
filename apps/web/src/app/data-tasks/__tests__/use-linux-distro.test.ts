import { describe, it, expect } from "vitest";
import { shouldShowInputHint, linuxInputMethodHint } from "../use-linux-distro";

describe("use-linux-distro helpers", () => {
  it("shouldShowInputHint is false for unknown flavor", () => {
    expect(shouldShowInputHint("unknown", 0)).toBe(false);
    expect(shouldShowInputHint("other", Date.now())).toBe(false);
  });

  it("shouldShowInputHint is true for UOS/Kylin/Deepin when never shown", () => {
    expect(shouldShowInputHint("uos", 0)).toBe(true);
    expect(shouldShowInputHint("kylin", 0)).toBe(true);
    expect(shouldShowInputHint("deepin", 0)).toBe(true);
  });

  it("shouldShowInputHint respects cooldown window", () => {
    const now = Date.now();
    // Just shown → false
    expect(shouldShowInputHint("uos", now)).toBe(false);
    // Shown > 24h ago → true
    expect(shouldShowInputHint("uos", now - 1000 * 60 * 60 * 25)).toBe(true);
  });

  it("linuxInputMethodHint returns platform-specific message", () => {
    expect(linuxInputMethodHint("uos")).toMatch(/Ctrl\+Space/);
    expect(linuxInputMethodHint("uos")).toMatch(/UOS/i);
    expect(linuxInputMethodHint("kylin")).toMatch(/Kylin/i);
    expect(linuxInputMethodHint("deepin")).toMatch(/Deepin/i);
    expect(linuxInputMethodHint("unknown")).toBe("");
  });
});
