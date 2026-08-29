"use client";

import { useEffect, useState } from "react";

/**
 * UOS / 国产 Linux 输入法 shim
 *
 * 痛点：在 UOS 系统上，浏览器/IDE 内的输入法常常无法把组合键传到 webview，
 *       IM 候选框出不来或位置错乱。
 *
 * 解决：根据 UA + platform 推断当前是否在 UOS / 统信 / 麒麟等环境，
 *      然后在聊天输入框上提示"按 ctrl+space 唤起 ime"或给出 export hint。
 *
 * 注意：
 *   - 浏览器只能通过 navigator.userAgent 推断，无法直接读取 OS 标识
 *   - 推荐做法：用户在设置里手动标记"我正在 UOS/麒麟"
 *   - 用户标记后 + 首次进入 chat：弹一次提示，告诉他们按 Ctrl+Space 切到中文
 */

export type LinuxDistroFlavor = "uos" | "kylin" | "deepin" | "other" | "unknown";

const UOS_FLAG_KEY = "agentx-linux-distro-flag";

export interface UseLinuxDistroResult {
  flavor: LinuxDistroFlavor;
  matchedFrom: "ua" | "manual" | "platform" | "none";
  /** 用户手动标记（覆盖检测） */
  override: (f: LinuxDistroFlavor) => void;
  /** 是否应该提示输入法 */
  shouldHintInputMethod: boolean;
  /** 上次提示时间（避免重复弹） */
  markHintShown: () => void;
}

const HINT_COOLDOWN_MS = 1000 * 60 * 60 * 24; // 1 day

function detectFromUA(ua: string): LinuxDistroFlavor {
  const lower = ua.toLowerCase();
  if (lower.includes("ubrowser") || lower.includes("uos")) return "uos";
  if (lower.includes("kylin")) return "kylin";
  if (lower.includes("deepin")) return "deepin";
  return "unknown";
}

function detectFromPlatform(platform: string): LinuxDistroFlavor {
  const p = platform.toLowerCase();
  if (p.includes("linux")) return "other";
  return "unknown";
}

function readManualOverride(): LinuxDistroFlavor | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(UOS_FLAG_KEY);
    if (!value) return null;
    if (value === "uos" || value === "kylin" || value === "deepin" || value === "other") {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

function writeManualOverride(flavor: LinuxDistroFlavor): void {
  if (typeof window === "undefined") return;
  try {
    if (flavor === "unknown") {
      window.localStorage.removeItem(UOS_FLAG_KEY);
    } else {
      window.localStorage.setItem(UOS_FLAG_KEY, flavor);
    }
  } catch {
    // ignore
  }
}

function readLastHintTs(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(`${UOS_FLAG_KEY}-hint-ts`);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function writeLastHintTs(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${UOS_FLAG_KEY}-hint-ts`, String(Date.now()));
  } catch {
    // ignore
  }
}

export function useLinuxDistro(): UseLinuxDistroResult {
  const [flavor, setFlavor] = useState<LinuxDistroFlavor>("unknown");
  const [matchedFrom, setMatchedFrom] = useState<"ua" | "manual" | "platform" | "none">("none");

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const manual = readManualOverride();
    if (manual) {
      setFlavor(manual);
      setMatchedFrom("manual");
      return;
    }
    const ua = detectFromUA(navigator.userAgent);
    if (ua !== "unknown") {
      setFlavor(ua);
      setMatchedFrom("ua");
      return;
    }
    const platform = detectFromPlatform(navigator.platform);
    if (platform !== "unknown") {
      setFlavor(platform);
      setMatchedFrom("platform");
    }
  }, []);

  const override = (f: LinuxDistroFlavor) => {
    writeManualOverride(f);
    setFlavor(f);
    setMatchedFrom("manual");
  };

  const shouldHintInputMethod = flavor === "uos" || flavor === "kylin" || flavor === "deepin";

  const markHintShown = () => {
    writeLastHintTs();
  };

  return {
    flavor,
    matchedFrom,
    override,
    shouldHintInputMethod,
    markHintShown,
  };
}

/**
 * Pure helper for test: 是否应该提示（考虑 cooldown）
 */
export function shouldShowInputHint(flavor: LinuxDistroFlavor, lastHintTs: number): boolean {
  if (!(flavor === "uos" || flavor === "kylin" || flavor === "deepin")) return false;
  if (lastHintTs === 0) return true;
  return Date.now() - lastHintTs > HINT_COOLDOWN_MS;
}

/**
 * 推荐的快捷键 hint：UOS 用 Ctrl+Space 切到中文
 */
export function linuxInputMethodHint(flavor: LinuxDistroFlavor): string {
  switch (flavor) {
    case "uos":
      return "Press Ctrl+Space to toggle Chinese IME under UOS.";
    case "kylin":
      return "Press Ctrl+Space to toggle Chinese IME under Kylin.";
    case "deepin":
      return "Press Ctrl+Space to toggle Chinese IME under Deepin.";
    case "other":
      return "If your Chinese IME doesn't activate, try Ctrl+Space or fcitx config.";
    default:
      return "";
  }
}
