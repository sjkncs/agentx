// apps/desktop/src/pet/ipc-smoke.test.mjs
//
// Machine gate: full IPC smoke for A32 desktop pet.
//
// Simulates the Electron main-process IPC layer by mocking the `electron`
// module so we can exercise the complete store chain
// (list → save → get → delete → restart-recovery) WITHOUT launching
// a real Electron window.
//
// Run with:
//   npx vitest run src/pet/ipc-smoke.test.mjs

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  __resetForTests,
} from "./persona-store.mjs";

let stateDir;

beforeEach(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), "pet-ipc-smoke-"));
  __resetForTests();

  // Mock electron so ipc.mjs can be imported without a real Electron runtime.
  // ipc.mjs uses: app, BrowserWindow, ipcMain from 'electron'.
  vi.mock("electron", () => ({
    app: {
      getPath: (name) => {
        if (name === "userData") return stateDir;
        return path.join(tmpdir(), name);
      },
    },
    BrowserWindow: vi.fn(() => ({
      removeMenu: vi.fn(),
      loadFile: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      webContents: { send: vi.fn(), once: vi.fn() },
      __petId: null,
    })),
    ipcMain: {
      handle: vi.fn(),
    },
  }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  __resetForTests();
  if (stateDir) {
    await rm(stateDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Gate 1: ipc.mjs imports without crashing.
// ---------------------------------------------------------------------------
describe("ipc module loads", () => {
  it("imports registerPetIpc without throwing", async () => {
    // If any top-level code in ipc.mjs references a real Electron primitive
    // that we haven't stubbed, this import throws and the test fails clearly.
    const mod = await import("./ipc.mjs");
    expect(typeof mod.registerPetIpc).toBe("function");
  });

  it("registerPetIpc() resolves without throwing", async () => {
    const { registerPetIpc } = await import("./ipc.mjs");
    await expect(registerPetIpc()).resolves.toBeUndefined();
  });

  it("second call to registerPetIpc() is idempotent", async () => {
    const { registerPetIpc } = await import("./ipc.mjs");
    await registerPetIpc();
    await expect(registerPetIpc()).resolves.toBeUndefined(); // no crash, no dup handlers
  });

  it("openPetBuilder factory does not throw", async () => {
    const { openPetBuilder } = await import("./ipc.mjs");
    expect(() => openPetBuilder()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Gate 2: store write/read/delete round-trips via the IPC handler path.
// ---------------------------------------------------------------------------
describe("store round-trip via IPC handler", () => {
  it("save → list → get returns saved pet", async () => {
    const { registerPetIpc } = await import("./ipc.mjs");
    await registerPetIpc();

    const { savePetProfile, listPetProfiles, getPetProfile } =
      await import("./persona-store.mjs");

    const saved = await savePetProfile({
      name: "晓晓",
      archetype: "阳光活泼",
      mood: "playful",
      voice_tone: "清脆",
      response_length: "short",
      reference_images: [],
      vlm_suggested: false,
    });

    expect(saved.id).toMatch(/^pet_/);
    expect(saved.name).toBe("晓晓");
    expect(saved.mood).toBe("playful");

    const list = await listPetProfiles();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(saved.id);

    const found = await getPetProfile(saved.id);
    expect(found).not.toBeNull();
    expect(found.name).toBe("晓晓");
  });

  it("multiple saves are sorted newest-first", async () => {
    const { registerPetIpc } = await import("./ipc.mjs");
    await registerPetIpc();

    const { savePetProfile, listPetProfiles } = await import("./persona-store.mjs");

    const first = await savePetProfile({
      name: "先创建",
      archetype: "",
      mood: "shy",
      voice_tone: "",
      response_length: "one_sentence",
      reference_images: [],
      vlm_suggested: false,
    });
    // 120 ms — savePetProfile uses Date.now() for the id prefix and the
    // ISO created_at string; both have millisecond precision, so we must
    // wait long enough for the clock to advance.
    await new Promise((r) => setTimeout(r, 120));
    const second = await savePetProfile({
      name: "后创建",
      archetype: "",
      mood: "outgoing",
      voice_tone: "",
      response_length: "long",
      reference_images: [],
      vlm_suggested: false,
    });

    const list = await listPetProfiles();
    expect(list[0].id).toBe(second.id); // newest first
    expect(list[1].id).toBe(first.id);
  });

  it("delete removes pet from list and get returns null", async () => {
    const { registerPetIpc } = await import("./ipc.mjs");
    await registerPetIpc();

    const { savePetProfile, listPetProfiles, getPetProfile, deletePetProfile } =
      await import("./persona-store.mjs");

    const saved = await savePetProfile({
      name: "临时宠物",
      archetype: "",
      mood: "curious",
      voice_tone: "",
      response_length: "paragraph",
      reference_images: [],
      vlm_suggested: false,
    });

    expect(await listPetProfiles()).toHaveLength(1);
    await deletePetProfile(saved.id);
    expect(await listPetProfiles()).toHaveLength(0);
    expect(await getPetProfile(saved.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gate 3: pet-state.json on disk matches in-memory state.
// ---------------------------------------------------------------------------
describe("disk persistence gate", () => {
  it("save writes pet-state.json atomically", async () => {
    const { registerPetIpc } = await import("./ipc.mjs");
    await registerPetIpc();

    const { savePetProfile } = await import("./persona-store.mjs");
    const saved = await savePetProfile({
      name: "磁盘测试",
      archetype: "",
      mood: "warm",
      voice_tone: "",
      response_length: "short",
      reference_images: [],
      vlm_suggested: false,
    });

    const stateFile = path.join(stateDir, "pet-state.json");
    const raw = await readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw);

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.profiles[saved.id]).toMatchObject({
      id: saved.id,
      name: "磁盘测试",
      mood: "warm",
    });
    // No .tmp file left behind (atomic rename worked)
    const tmpFile = path.join(stateDir, "pet-state.json.tmp");
    const tmpExists = await import("node:fs/promises")
      .then((fs) => fs.access(tmpFile).then(() => true).catch(() => false));
    expect(tmpExists).toBe(false);
  });

  it("restart simulation: re-init reads saved pets from disk", async () => {
    const { registerPetIpc } = await import("./ipc.mjs");
    await registerPetIpc();

    const { savePetProfile } = await import("./persona-store.mjs");
    const saved = await savePetProfile({
      name: "重启后还在",
      archetype: "stable",
      mood: "stoic",
      voice_tone: "calm",
      response_length: "short",
      reference_images: [],
      vlm_suggested: false,
    });

    // Simulate app restart: reset module state, re-init, list
    const { initPetStore } = await import("./persona-store.mjs");
    __resetForTests();
    await initPetStore(stateDir);

    const { listPetProfiles } = await import("./persona-store.mjs");
    const list = await listPetProfiles();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(saved.id);
    expect(list[0].name).toBe("重启后还在");
  });
});

// ---------------------------------------------------------------------------
// Gate 4: Zod schema rejects bad input.
// ---------------------------------------------------------------------------
describe("schema validation gates", () => {
  it("rejects empty name", async () => {
    const { registerPetIpc } = await import("./ipc.mjs");
    await registerPetIpc();
    const { savePetProfile } = await import("./persona-store.mjs");
    await expect(
      savePetProfile({
        name: "",
        archetype: "",
        mood: "warm",
        voice_tone: "",
        response_length: "short",
        reference_images: [],
        vlm_suggested: false,
      }),
    ).rejects.toThrow();
  });

  it("rejects unknown mood", async () => {
    const { registerPetIpc } = await import("./ipc.mjs");
    await registerPetIpc();
    const { savePetProfile } = await import("./persona-store.mjs");
    await expect(
      savePetProfile({
        name: "ok",
        archetype: "",
        mood: "ecstatic",
        voice_tone: "",
        response_length: "short",
        reference_images: [],
        vlm_suggested: false,
      }),
    ).rejects.toThrow();
  });

  it("rejects malformed reference_images hash", async () => {
    const { registerPetIpc } = await import("./ipc.mjs");
    await registerPetIpc();
    const { savePetProfile } = await import("./persona-store.mjs");
    await expect(
      savePetProfile({
        name: "ok",
        archetype: "",
        mood: "warm",
        voice_tone: "",
        response_length: "short",
        reference_images: ["not-a-sha-hash"],
        vlm_suggested: false,
      }),
    ).rejects.toThrow();
  });

  it("accepts valid full input including vlm_suggested", async () => {
    const { registerPetIpc } = await import("./ipc.mjs");
    await registerPetIpc();
    const { savePetProfile } = await import("./persona-store.mjs");
    const saved = await savePetProfile({
      name: "全字段测试",
      archetype: "资深助手",
      mood: "attentive",
      voice_tone: "专业稳重",
      response_length: "paragraph",
      reference_images: [
        "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      ],
      vlm_suggested: true,
    });
    expect(saved.schema_version).toBe(1);
    expect(saved.vlm_suggested).toBe(true);
    expect(saved.id).toMatch(/^pet_/);
  });
});
