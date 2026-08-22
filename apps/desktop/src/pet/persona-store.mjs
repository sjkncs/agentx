// apps/desktop/src/pet/persona-store.mjs
//
// Persistent store for persona profiles + per-pet disclaimer acknowledgements.
// Backed by a single JSON file under Electron's userData path:
//   <userData>/pet-state.json
//
// Concurrency:
//   - All reads/writes go through one in-memory `_state` shape so renderer
//     and main-process callers never see a torn write.
//   - Writes go through `atomic_write_json` so a crash mid-write cannot
//     corrupt the file (write to .tmp then rename).
//
// Why a single JSON file:
//   - v0.1 stores only a handful of pets per device.
//   - The file is small enough to read in full on startup and write back on
//     every mutation; no migration machinery is needed.
//   - If usage grows we migrate to a SQLite file (the desktop app already
//     uses `node:sqlite` elsewhere) — see spec §11 risks.

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { PersonaSchema, parsePersona } from "./persona.mjs";

const STATE_FILE_BASENAME = "pet-state.json";
const STATE_FILE_TMP_SUFFIX = ".tmp";

/** @typedef {import("./persona.mjs").Persona} Persona */

/**
 * @typedef {Object} DisclaimerState
 * @property {boolean} acked
 * @property {number|null} ackedAt
 */

/**
 * @typedef {Object} PetState
 * @property {number} schemaVersion
 * @property {Record<string, Persona>} profiles    keyed by persona.id
 * @property {Record<string, DisclaimerState>} disclaimers  keyed by persona.id
 */

/** @type {PetState|null} */
let _state = null;

/** Absolute path to the state file. Set by `initPetStore(stateDir)`. */
let _stateFilePath = null;

/** Initialise once on Electron `app.whenReady`. Idempotent. */
export const initPetStore = async (stateDir) => {
  if (_state !== null && _stateFilePath === path.join(stateDir, STATE_FILE_BASENAME)) {
    return;
  }
  await fs.mkdir(stateDir, { recursive: true });
  _stateFilePath = path.join(stateDir, STATE_FILE_BASENAME);
  await _loadOrSeed();
};

/** Build an empty PetState. Exported so tests can fork without touching disk. */
export const emptyPetState = () =>
  /** @type {PetState} */ ({
    schemaVersion: 1,
    profiles: {},
    disclaimers: {},
  });

const _loadOrSeed = async () => {
  if (!_stateFilePath) {
    throw new Error("pet-store: initPetStore(stateDir) was not called");
  }
  try {
    const raw = await fs.readFile(_stateFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("pet-state.json is not an object");
    }
    if (parsed.schemaVersion !== 1) {
      throw new Error(`pet-state.json: unsupported schemaVersion ${parsed.schemaVersion}`);
    }
    const profiles = {};
    for (const [id, persona] of Object.entries(parsed.profiles ?? {})) {
      profiles[id] = parsePersona({ ...persona, id });
    }
    _state = {
      schemaVersion: 1,
      profiles,
      disclaimers: { ...(parsed.disclaimers ?? {}) },
    };
  } catch (error) {
    if (error && /** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      _state = emptyPetState();
      await _flush();
      return;
    }
    // Corrupt file — back it up and start fresh so the user does not get
    // locked out of pet creation. We log loudly so the issue is visible.
    const backupPath = `${_stateFilePath}.corrupt.${Date.now()}`;
    try {
      await fs.rename(_stateFilePath, backupPath);
      console.warn(
        `[pet-store] corrupt pet-state.json moved to ${backupPath}, starting fresh:`,
        String(error),
      );
    } catch {
      // ignore — we'll just overwrite
    }
    _state = emptyPetState();
    await _flush();
  }
};

const _flush = async () => {
  if (!_stateFilePath || !_state) return;
  const tmp = `${_stateFilePath}${STATE_FILE_TMP_SUFFIX}`;
  const body = JSON.stringify(_state, null, 2);
  await fs.writeFile(tmp, body, "utf8");
  await fs.rename(tmp, _stateFilePath);
};

const requireState = () => {
  if (!_state) {
    throw new Error("pet-store: initPetStore(stateDir) was not called");
  }
  return _state;
};

const newPersonaId = () =>
  `pet_${Date.now().toString(36)}${randomUUID().slice(0, 8)}`;

// ============================================================================
// Public read API
// ============================================================================

/** List all personas, newest first. */
export const listPetProfiles = async () => {
  const state = requireState();
  return Object.values(state.profiles).sort(
    (a, b) => b.created_at.localeCompare(a.created_at),
  );
};

/** Look up one persona by id. Returns null if unknown. */
export const getPetProfile = async (id) => requireState().profiles[id] ?? null;

/** Whether the disclaimer has been acknowledged for this pet. */
export const getDisclaimerAck = async (petId) =>
  requireState().disclaimers[petId] ?? { acked: false, ackedAt: null };

// ============================================================================
// Public write API (all persist atomically)
// ============================================================================

/**
 * Persist a new persona. The `id` field of the input is replaced with a
 * freshly-generated id; callers should not rely on it round-tripping.
 */
export const savePetProfile = async (input) => {
  const state = requireState();
  const id = newPersonaId();
  const now = new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
  const persona = PersonaSchema.parse({
    ...input,
    id,
    created_at: now,
    schema_version: 1,
  });
  state.profiles[id] = persona;
  state.disclaimers[id] = { acked: false, ackedAt: null };
  await _flush();
  return persona;
};

/** Update an existing persona (same id, new fields). Image hashes are
 *  preserved unless the caller explicitly replaces `reference_images`. */
export const updatePetProfile = async (id, patch) => {
  const state = requireState();
  const current = state.profiles[id];
  if (!current) throw new Error(`persona not found: ${id}`);
  const merged = { ...current, ...patch, id, schema_version: 1 };
  const persona = PersonaSchema.parse(merged);
  state.profiles[id] = persona;
  await _flush();
  return persona;
};

export const deletePetProfile = async (id) => {
  const state = requireState();
  if (!state.profiles[id]) return false;
  delete state.profiles[id];
  delete state.disclaimers[id];
  await _flush();
  return true;
};

export const ackDisclaimer = async (petId) => {
  const state = requireState();
  if (!state.profiles[petId]) throw new Error(`persona not found: ${petId}`);
  state.disclaimers[petId] = { acked: true, ackedAt: Date.now() };
  await _flush();
  return state.disclaimers[petId];
};

// ============================================================================
// Test seams
// ============================================================================

/** Replace the in-memory state without touching disk. Tests only. */
export const __setStateForTests = (nextState) => {
  _state = nextState ?? emptyPetState();
};

/** Reset the module-level state; tests only. */
export const __resetForTests = () => {
  _state = null;
  _stateFilePath = null;
};

export const __stateFilePathForTests = () => _stateFilePath;
