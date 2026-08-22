// apps/desktop/src/pet/pet-window.mjs
//
// Renderer for the always-on-top pet chat window. Three tabs (work /
// companion / settings), a streaming chat area fed by AG-UI events from
// the main process, voice input via window.pet.voice (implemented in A32.4),
// and a first-time-per-session disclaimer modal for companion mode (A32.7).
//
// Threading model:
//   - Renderer keeps an in-memory session_id once a chat starts; the main
//     process owns the actual run, so every event arrives through IPC.
//   - We never spawn another BrowserWindow from here; the main process
//     relays events back via the WebSocket-like streaming handled in A32.5.

const petIpc = /** @type {Window['pet']|undefined} */ (window).pet;
if (!petIpc) {
  document.body.innerHTML =
    "<p style='color:#ff6f7a;padding:24px'>pet IPC bridge missing — preload misconfigured.</p>";
  throw new Error("pet IPC bridge missing");
}

const $ = (id) => /** @type {any} */ (document.getElementById(id));

/** @type {"work"|"companion"|"settings"} */
let currentMode = "work";

/** @type {string|null} */
let sessionId = null;

/** @type {string|null} */
let currentRunId = null;

/** Whether the disclaimer has been acknowledged for this window session.
 *  Resets every time the BrowserWindow is opened — see AC-5. */
let sessionCompanionAcked = false;

/** @type {{ id: string, name: string, mode: string, persona: any }|null} */
let pet = null;

const onAgUiEvent = (envelope) => {
  if (!envelope || typeof envelope !== "object") return;
  // envelope = { type, run_id, session_id, seq, ts, event }
  const event = envelope.event ?? envelope;
  const type = typeof event?.type === "string" ? event.type : null;
  if (!type) return;

  switch (type) {
    case "TEXT_MESSAGE_START":
      onMessageStart(event);
      return;
    case "TEXT_MESSAGE_CONTENT":
      onMessageContent(event);
      return;
    case "TEXT_MESSAGE_END":
      onMessageEnd(event);
      return;
    case "TOOL_CALL_START":
      onToolCallStart(event);
      return;
    case "TOOL_CALL_ARGS":
      onToolCallArgs(event);
      return;
    case "TOOL_CALL_END":
      onToolCallEnd(event);
      return;
    case "TOOL_CALL_RESULT":
      onToolCallResult(event);
      return;
    case "RUN_ERROR":
      appendSystem(`Error: ${event.message ?? "unknown"}`);
      return;
    case "RUN_FINISHED":
      currentRunId = null;
      setSending(false);
      return;
    default:
      return;
  }
};

// ============================================================================
// AG-UI → DOM renderer (per-message accumulators keyed by messageId)
// ============================================================================

/** @type {Map<string, {role: string, parts: string[], el: HTMLElement}>} */
const messageNodes = new Map();

const conversationEl = () => /** @type {HTMLElement} */ ($("conversation"));

const ensureMessageEl = (id, role) => {
  const existing = messageNodes.get(id);
  if (existing) return existing;
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.dataset.messageId = id;
  conversationEl().appendChild(div);
  conversationEl().scrollTop = conversationEl().scrollHeight;
  const entry = { role, parts: [""], el: div };
  messageNodes.set(id, entry);
  return entry;
};

const onMessageStart = (event) => {
  const id = typeof event.messageId === "string" ? event.messageId : null;
  const role = typeof event.role === "string" ? event.role : "assistant";
  if (!id) return;
  ensureMessageEl(id, role);
};

const onMessageContent = (event) => {
  const id = typeof event.messageId === "string" ? event.messageId : null;
  if (!id) return;
  const entry = messageNodes.get(id);
  if (!entry) return;
  if (typeof event.delta === "string") entry.parts[0] += event.delta;
  entry.el.textContent = entry.parts[0];
  conversationEl().scrollTop = conversationEl().scrollHeight;
};

const onMessageEnd = (_event) => {
  // text is finalised; nothing else to do.
  conversationEl().scrollTop = conversationEl().scrollHeight;
};

/** @type {Map<string, {name: string, args: string, el: HTMLElement|null, result: string|null}>} */
const toolCalls = new Map();

const onToolCallStart = (event) => {
  const id = typeof event.toolCallId === "string" ? event.toolCallId : null;
  if (!id) return;
  const name = typeof event.toolCallName === "string" ? event.toolCallName : "tool";
  const div = document.createElement("div");
  div.className = "msg tool";
  div.dataset.toolCallId = id;
  div.textContent = `→ ${name}( )`;
  conversationEl().appendChild(div);
  toolCalls.set(id, { name, args: "", el: div, result: null });
  conversationEl().scrollTop = conversationEl().scrollHeight;
};

const onToolCallArgs = (event) => {
  const id = typeof event.toolCallId === "string" ? event.toolCallId : null;
  if (!id) return;
  const tc = toolCalls.get(id);
  if (!tc) return;
  if (typeof event.delta === "string") tc.args += event.delta;
  if (tc.el) tc.el.textContent = `→ ${tc.name}(${tc.args})`;
};

const onToolCallEnd = (_event) => { /* boundary complete */ };

const onToolCallResult = (event) => {
  const id = typeof event.toolCallId === "string" ? event.toolCallId : null;
  if (!id) return;
  const tc = toolCalls.get(id);
  if (!tc) return;
  const content = typeof event.content === "string" ? event.content : "";
  tc.result = content;
  if (tc.el) tc.el.textContent = `→ ${tc.name}(${tc.args}) → ${content.slice(0, 240)}${content.length > 240 ? "…" : ""}`;
  conversationEl().scrollTop = conversationEl().scrollHeight;
};

const appendSystem = (text) => {
  const div = document.createElement("div");
  div.className = "msg system";
  div.textContent = text;
  conversationEl().appendChild(div);
  conversationEl().scrollTop = conversationEl().scrollHeight;
};

// ============================================================================
// Composer / mic / send
// ============================================================================

let sending = false;
const setSending = (val) => {
  sending = val;
  $("send-btn").disabled = val || $("composer-input").value.trim() === "";
  $("mic-btn").disabled = val;
};

const startChat = async (text) => {
  if (!pet) return;
  if (currentMode === "companion" && !sessionCompanionAcked) {
    showDisclaimerModal();
    $("composer-input").value = text;
    return;
  }
  setSending(true);
  try {
    const handle = await petIpc.startChat({
      petId: pet.id,
      mode: currentMode,
      message: text,
      sessionId,
    });
    sessionId = handle.sessionId;
    currentRunId = handle.runId;
    appendUserMessage(text);
    subscribeToRun(handle);
  } catch (err) {
    setSending(false);
    appendSystem(`Send failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

const appendUserMessage = (text) => {
  const id = `user_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const entry = ensureMessageEl(id, "user");
  entry.parts[0] = text;
  entry.el.textContent = text;
};

const subscribeToRun = async (handle) => {
  const unsubscribe = await petIpc.onEvent(handle, (event) => onAgUiEvent(event));
  // unsubscribe is stored on the handle; not currently used since the same
  // handle completes naturally with RUN_FINISHED, but it's the contract
  // A32.5 will implement.
  if (handle && typeof handle === "object") handle.unsubscribe = unsubscribe;
};

const send = async (ev) => {
  ev?.preventDefault?.();
  if (sending) return;
  const text = $("composer-input").value.trim();
  if (!text) return;
  $("composer-input").value = "";
  await startChat(text);
};

// ============================================================================
// Mode switch + companion disclaimer
// ============================================================================

const showDisclaimerModal = () => {
  $("disclaimer-modal").classList.remove("hidden");
  $("disclaimer-ack").checked = false;
  $("disclaimer-confirm").disabled = true;
};

const hideDisclaimerModal = () => {
  $("disclaimer-modal").classList.add("hidden");
};

const ackDisclaimer = async () => {
  if (!pet) return;
  await petIpc.ackDisclaimer(pet.id);
  sessionCompanionAcked = true;
  hideDisclaimerModal();
  setCurrentMode("companion");
  const queued = $("composer-input").value.trim();
  $("composer-input").value = "";
  if (queued) await startChat(queued);
};

const cancelDisclaimer = () => {
  hideDisclaimerModal();
  setCurrentMode("work");
  $("composer-input").value = "";
};

const setCurrentMode = (mode) => {
  currentMode = mode;
  for (const btn of document.querySelectorAll(".mode-switch button")) {
    /** @type {HTMLElement} */ (btn).classList.toggle("active", btn.dataset.mode === mode);
    btn.setAttribute("aria-selected", String(btn.dataset.mode === mode));
  }
  $("settings-panel").classList.toggle("hidden", mode !== "settings");
  $("conversation").classList.toggle("hidden", mode === "settings");
  $("composer").classList.toggle("hidden", mode === "settings");
  $("settings-current-mode").textContent = mode;
};

const onModeClick = async (ev) => {
  const btn = /** @type {HTMLElement} */ (ev.currentTarget);
  const mode = btn.dataset.mode;
  if (!mode || mode === currentMode) return;
  if (mode === "companion") {
    showDisclaimerModal();
    return;
  }
  setCurrentMode(mode);
};

// ============================================================================
// Mic — voice adapter is injected here in A32.4. For now we ship a single
// no-op stub that disables the button when no voice adapter is wired so the
// rest of the UI keeps working.
// ============================================================================

let voiceAdapter = null;

const initVoice = async () => {
  try {
    voiceAdapter = await petIpc.voiceAdapter?.();
  } catch {
    voiceAdapter = null;
  }
  $("mic-btn").disabled = !voiceAdapter;
};

const onMicClick = async () => {
  if (!voiceAdapter) return;
  if (voiceAdapter.state === "listening") {
    const transcript = await voiceAdapter.stopListening();
    if (transcript) {
      $("composer-input").value = transcript;
      setSending(false);
      await send();
    }
    return;
  }
  await voiceAdapter.startListening({
    onPartial: (t) => { $("composer-input").value = t; },
    lang: navigator.language || "zh-CN",
  });
  $("mic-btn").classList.add("recording");
};

const onMicEnd = async () => {
  $("mic-btn").classList.remove("recording");
};

// ============================================================================
// Boot
// ============================================================================

const boot = async () => {
  pet = await petIpc.getCurrentPet?.();
  if (!pet) {
    appendSystem("No pet selected. Use '+ Add a pet' in the main window.");
    return;
  }

  $("pet-name").textContent = pet.name;
  $("pet-subtitle").textContent = pet.persona?.archetype ?? "";
  $("settings-id").textContent = pet.id;
  $("settings-created").textContent = pet.persona?.created_at ?? "";
  $("settings-images").textContent = (pet.persona?.reference_images ?? []).join("\n") || "(none)";
  $("settings-persona-json").textContent = JSON.stringify(pet.persona, null, 2);
  setCurrentMode("work");

  for (const id of ["name", "archetype", "mood", "response_length", "voice_tone"]) {
    void id;
  }

  document.querySelectorAll(".mode-switch button").forEach((b) => {
    b.addEventListener("click", onModeClick);
  });

  $("composer").addEventListener("submit", send);

  $("mic-btn").addEventListener("click", async (ev) => {
    if (voiceAdapter && voiceAdapter.state === "listening") {
      await onMicClick();
      await onMicEnd();
    } else {
      await onMicClick();
    }
  });

  $("disclaimer-ack").addEventListener("change", (e) => {
    $("disclaimer-confirm").disabled = !/** @type {HTMLInputElement} */ (e.currentTarget).checked;
  });
  $("disclaimer-confirm").addEventListener("click", () => void ackDisclaimer());
  $("disclaimer-cancel").addEventListener("click", cancelDisclaimer);

  $("settings-delete").addEventListener("click", async () => {
    if (!pet) return;
    if (!confirm(`Delete "${pet.name}"? This cannot be undone.`)) return;
    await petIpc.deletePet(pet.id);
    window.close();
  });

  $("composer-input").addEventListener("input", () => {
    setSending(sending);
  });

  await initVoice();
  setSending(false);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void boot());
} else {
  void boot();
}