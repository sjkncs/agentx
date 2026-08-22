// apps/desktop/src/pet/persona-store.test.mjs
//
// Machine gate for AC-13: Pet state survives app restart. We simulate
// 'restart' by writing the JSON file via the real initPetStore, then
// re-initialising against the same directory and reading back.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  initPetStore,
  listPetProfiles,
  savePetProfile,
  deletePetProfile,
  ackDisclaimer,
  getDisclaimerAck,
  __resetForTests,
} from "./persona-store.mjs";

let stateDir;

beforeEach(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), "pet-store-"));
  __resetForTests();
});

afterEach(async () => {
  __resetForTests();
  if (stateDir) await rm(stateDir, { recursive: true, force: true });
});

describe("persona-store persistence", () => {
  it("initialises an empty state file on first run", async () => {
    await initPetStore(stateDir);
    expect(await listPetProfiles()).toEqual([]);
    const txt = await readFile(path.join(stateDir, "pet-state.json"), "utf8");
    expect(JSON.parse(txt)).toMatchObject({ schemaVersion: 1, profiles: {}, disclaimers: {} });
  });

  it("round-trips save → list → delete via the same directory", async () => {
    await initPetStore(stateDir);
    const saved = await savePetProfile({
      name: "莫莫",
      archetype: "温暖好奇",
      mood: "warm",
      voice_tone: "轻柔",
      response_length: "short",
      reference_images: ["sha256:" + "a".repeat(64)],
      vlm_suggested: false,
    });
    expect(saved.id).toMatch(/^pet_/);
    expect(await listPetProfiles()).toHaveLength(1);
    expect(await deletePetProfile(saved.id)).toBe(true);
    expect(await listPetProfiles()).toEqual([]);
  });

  it("survives a restart (re-init from disk)", async () => {
    await initPetStore(stateDir);
    const saved = await savePetProfile({
      name: "Stubby",
      archetype: "stubborn but kind",
      mood: "warm",
      voice_tone: "deep",
      response_length: "short",
      reference_images: [],
      vlm_suggested: false,
    });

    // Simulate restart by resetting module state and re-initialising.
    __resetForTests();
    await initPetStore(stateDir);
    const all = await listPetProfiles();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(saved.id);
    expect(all[0].name).toBe("Stubby");
  });

  it("blocks unacked companion mode by default and tracks ack", async () => {
    await initPetStore(stateDir);
    const saved = await savePetProfile({
      name: "Echo",
      archetype: "",
      mood: "curious",
      voice_tone: "",
      response_length: "short",
      reference_images: [],
      vlm_suggested: false,
    });
    expect(await getDisclaimerAck(saved.id)).toEqual({ acked: false, ackedAt: null });
    const after = await ackDisclaimer(saved.id);
    expect(after.acked).toBe(true);
    expect(typeof after.ackedAt).toBe("number");
  });

  it("rejects invalid persona input at save time (Zod)", async () => {
    await initPetStore(stateDir);
    await expect(
      savePetProfile({
        name: "", // violates NAME_PATTERN
        archetype: "",
        mood: "warm",
        voice_tone: "",
        response_length: "short",
        reference_images: [],
        vlm_suggested: false,
      }),
    ).rejects.toThrow(/too small|fail|name/i);
  });

  it("rejects unknown mood at save time (Zod)", async () => {
    await initPetStore(stateDir);
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
});