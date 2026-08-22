// apps/desktop/src/pet/ipc.mjs
//
// Wire all `pet.*` IPC handlers used by pet-builder.mjs / pet-window.mjs.
// Imported once from main.mjs after `app.whenReady`.
//
// Channels exposed:
//   pet:list                — listPetProfiles
//   pet:get                 — getPetProfile(id)
//   pet:save                — savePetProfile(input)
//   pet:update              — updatePetProfile(id, patch)
//   pet:delete              — deletePetProfile(id)
//   pet:ackDisclaimer       — ackDisclaimer(petId)
//   pet:describeImages      — POST /api/v1/vlm/describe  (A32.6)
//   pet:startChat           — POST /api/v1/runs            (A32.5)
//   pet:onEvent             — subscribes renderer to AG-UI stream events
//   pet:voiceAdapter        — returns Web Speech adapter factory URL
//   pet:onPetSaved/onPetCancelled — one-shot callback registry (see preload)

import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";

import {
  initPetStore,
  listPetProfiles,
  getPetProfile,
  savePetProfile,
  updatePetProfile,
  deletePetProfile,
  ackDisclaimer as storeAckDisclaimer,
} from "./persona-store.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PET_HTML_DIR = path.join(__dirname);
const PET_BUILDER_HTML = path.join(PET_HTML_DIR, "pet-builder.html");
const PET_WINDOW_HTML = path.join(PET_HTML_DIR, "pet-window.html");

/** Active run emitters, keyed by runId. Each emits AG-UI events from the
 *  main process to the subscribed renderer. */
const runEmitters = new Map();

/** Renderer callbacks for "pet saved" / "cancelled" one-shots. */
const callbacks = new Map();
let callbackIdCounter = 0;

/** Discover the API base URL (port allocated by port-allocator). Falls
 *  back to env or to localhost:8787 when running headless. */
const resolveApiBaseUrl = async () => {
  const envUrl = process.env.DATAFOUNDRY_API_URL;
  if (typeof envUrl === "string" && envUrl.length > 0) return envUrl;
  const filePath = path.join(app.getPath("userData"), "api-base-url");
  try {
    const fs = await import("node:fs/promises");
    const txt = await fs.readFile(filePath, "utf8");
    if (txt.trim().length > 0) return txt.trim();
  } catch {
    /* file may not exist; use default */
  }
  return "http://127.0.0.1:8787";
};

/** Detect whether the API is reachable. We do NOT auto-spawn here —
 *  main.mjs already manages the spawn lifecycle (startApiServer). */
const apiIsReachable = async (baseUrl) => {
  try {
    const res = await fetch(`${baseUrl}/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
};

/** Builds an SSE / fetch-style streaming POST to /api/v1/runs and pipes
 *  events into an EventEmitter that the renderer subscribes to via
 *  `pet:onEvent`. Returns the handle the renderer uses to cancel. */
const startChatRun = async ({ baseUrl, petId, mode, message, sessionId }) => {
  const url = `${baseUrl}/api/v1/runs`;
  const body = {
    threadId: sessionId ?? cryptoRandomId(),
    forwardedProps: {
      pet: { id: petId, mode },
      message,
    },
    tools: mode === "companion" ? [] : undefined,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`chat: api responded ${res.status} ${res.statusText}`);
  }
  const runId = cryptoRandomId();
  const emitter = new EventEmitter();
  runEmitters.set(runId, emitter);
  pumpSse(res.body, emitter).catch((err) => {
    emitter.emit("event", { type: "RUN_ERROR", message: err.message });
  }).finally(() => {
    runEmitters.delete(runId);
  });
  return { runId, sessionId: body.threadId };
};

/** Streaming-line pump over an HTTP body ReadableStream. For now we
 *  assume the API responds with chunked JSON events (one AG-UI event per
 *  line) rather than true SSE because /api/v1/runs is not yet SSE-enabled.
 *  When A32.5 reaches production we'll switch to real SSE. */
const pumpSse = async (body, emitter) => {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  // Treat the stream as NDJSON. Bail after a terminal event.
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.length === 0) continue;
      try {
        const event = JSON.parse(line);
        emitter.emit("event", event);
        if (event?.type === "RUN_FINISHED" || event?.type === "RUN_ERROR") {
          emitter.emit("end");
          return;
        }
      } catch {
        // Non-JSON lines (e.g. keep-alive comments) are ignored; we treat
        // the whole stream as JSON eventually.
      }
    }
  }
  emitter.emit("event", { type: "RUN_FINISHED" });
  emitter.emit("end");
};

/** Stable id generator not requiring `crypto.randomUUID` import in the
 *  Electron main process. Uses `randomUUID` when available, else falls
 *  back to a Math.random hex token. */
const cryptoRandomId = () => {
  try {
    // eslint-disable-next-line no-undef
    return crypto.randomUUID();
  } catch {
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

/** Re-export the IPC wiring so main.mjs has a single import. */
export const registerPetIpc = async () => {
  // Initialise persona-store against Electron's userData path. Safe to
  // call multiple times (the store is idempotent).
  await initPetStore(app.getPath("userData"));

  ipcMain.handle("pet:list", async () => listPetProfiles());
  ipcMain.handle("pet:get", async (_e, id) => getPetProfile(id));
  ipcMain.handle("pet:save", async (_e, input) => savePetProfile(input));
  ipcMain.handle("pet:update", async (_e, id, patch) => updatePetProfile(id, patch));
  ipcMain.handle("pet:delete", async (_e, id) => deletePetProfile(id));
  ipcMain.handle(
    "pet:ackDisclaimer",
    async (_e, petId) => storeAckDisclaimer(petId),
  );

  // After-save hook: pet-builder calls this with the freshly-saved id so
  // main can open the chat window for it. We re-use the renderer-side
  // event.sender as the parent so the pet window floats over the builder.
  ipcMain.handle("pet:resolveAfterSave", async (event, payload) => {
    if (payload?.id) {
      const parent = BrowserWindow.fromWebContents(event.sender);
      void openPetWindow({ petId: payload.id, parent: parent ?? undefined });
    }
    return true;
  });

  ipcMain.handle("pet:describeImages", async (_e, { reference_images }) => {
    const baseUrl = await resolveApiBaseUrl();
    if (!(await apiIsReachable(baseUrl))) {
      // No API — return an empty suggestion instead of throwing so the
      // builder UI can still be used offline.
      return {
        name: "",
        archetype: "",
        mood: "attentive",
        response_length: "paragraph",
        voice_tone: "",
        offline: true,
      };
    }
    const res = await fetch(`${baseUrl}/api/v1/vlm/describe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference_images }),
    });
    if (!res.ok) {
      throw new Error(`describe: api responded ${res.status}`);
    }
    return res.json();
  });

  ipcMain.handle(
    "pet:startChat",
    async (_e, { petId, mode, message, sessionId }) => {
      const baseUrl = await resolveApiBaseUrl();
      const reachable = await apiIsReachable(baseUrl);
      if (!reachable) {
        // Standalone mode: emit a synthetic RUN_ERROR so the renderer
        // sees an immediate failure rather than silently doing nothing.
        const runId = cryptoRandomId();
        const emitter = new EventEmitter();
        runEmitters.set(runId, emitter);
        setImmediate(() => {
          emitter.emit("event", {
            type: "RUN_ERROR",
            message:
              "DataFoundry API is not reachable. Start the API server or run in 'connected' mode.",
          });
          runEmitters.delete(runId);
        });
        return { runId, sessionId: sessionId ?? cryptoRandomId() };
      }
      return startChatRun({ baseUrl, petId, mode, message, sessionId });
    },
  );

  ipcMain.handle("pet:onEvent", async (_e, { runId }) => {
    const emitter = runEmitters.get(runId);
    if (!emitter) {
      throw new Error(`pet:onEvent: unknown runId ${runId}`);
    }
    const senderWindow = BrowserWindow.fromWebContents(_e.sender);
    const send = (event) => {
      if (senderWindow && !senderWindow.isDestroyed()) {
        senderWindow.webContents.send("pet:event", { runId, event });
      }
    };
    emitter.on("event", send);
    emitter.once("end", () => emitter.off("event", send));
    return () => emitter.off("event", send);
  });

  ipcMain.handle("pet:voiceAdapter", async () => {
    // The renderer imports voice-adapter.mjs directly when its src/ is
    // served; this handshake simply tells the renderer 'the adapter is
    // local — load it from ./voice-adapter.mjs'.
    return { entry: "./voice-adapter.mjs", factory: "createDefaultVoiceAdapter" };
  });
};

// ============================================================================
// Window factories
// ============================================================================

/** Open the pet-builder modal as a child of the main window if present. */
export const openPetBuilder = ({ parent } = {}) => {
  const win = new BrowserWindow({
    width: 720,
    height: 720,
    parent: parent ?? undefined,
    modal: Boolean(parent),
    title: "Add a Pet",
    backgroundColor: "#16191f",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  void win.loadFile(PET_BUILDER_HTML);
  return win;
};

/** Open the always-on-top pet chat window for one pet. */
export const openPetWindow = async ({ petId, parent } = {}) => {
  const persona = await getPetProfile(petId);
  if (!persona) throw new Error(`pet not found: ${petId}`);
  const win = new BrowserWindow({
    width: 320,
    height: 540,
    parent: parent ?? undefined,
    alwaysOnTop: true,
    frame: false,
    transparent: false,
    backgroundColor: "#16191f00", // transparent; CSS provides the body fill
    title: persona.name,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visible: false });
  // Stamp the BrowserWindow with the pet id so pet:getCurrentPet can
  // resolve the pet for this window without inspecting query params.
  /** @type {any} */ (win).__petId = persona.id;
  void win.loadFile(PET_WINDOW_HTML);
  // Push the resolved pet into the renderer shortly after load.
  win.webContents.once("did-finish-load", () => {
    win.webContents.send("pet:currentPet", {
      id: persona.id,
      name: persona.name,
      persona,
    });
  });
  return win;
};

/** Register one-shot callback handlers used by preload. */
export const registerPetCallbacks = () => {
  ipcMain.handle("pet:registerCallback", (_e, kind) => {
    const id = `cb_${++callbackIdCounter}`;
    callbacks.set(id, { kind, sender: _e.sender });
    return id;
  });
  ipcMain.handle("pet:emitCallback", (_e, { id, payload }) => {
    const c = callbacks.get(id);
    if (!c) return false;
    c.sender.send(`pet:callback:${c.kind}`, payload);
    return true;
  });
};