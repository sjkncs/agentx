// apps/desktop/src/pet/pet-builder.mjs
//
// Renderer for the "Add a Pet" modal. Lives in Electron's renderer process
// for the pet-builder BrowserWindow; talks to the main process via the
// `pet` IPC bridge exposed by preload.mjs. No DOM access outside this file
// is needed for build; everything is class-scoped via querySelectors.

import {
  validatePersonaDraft,
  MOODS,
  RESPONSE_LENGTHS,
} from "./persona.mjs";

const MAX_IMAGES = 4;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

/** @typedef {{id: string, hash: string, name: string, dataUrl: string}} ImageEntry */
/** @type {ImageEntry[]} */
const images = [];

/** @type {Record<string, string>} */
const formState = {
  name: "",
  archetype: "",
  mood: "attentive",
  response_length: "paragraph",
  voice_tone: "",
  vlm_suggested: false,
};

const petIpc = /** @type {Window['pet']|undefined} */ (window).pet;
if (!petIpc) {
  document.body.innerHTML =
    "<p style='color:#ff6f7a;padding:24px'>pet IPC bridge missing — preload misconfigured.</p>";
  throw new Error("pet IPC bridge missing");
}

const $ = (id) => /** @type {any} */ (document.getElementById(id));

/** Hash the uploaded image client-side via SubtleCrypto so the user knows
 *  the reference_images field is computed from the bytes, not a guess. */
const sha256Hex = async (/** @type {ArrayBuffer} */ buf) => {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const renderThumbnails = () => {
  const list = $("thumbnails");
  list.innerHTML = "";
  for (const img of images) {
    const li = document.createElement("li");

    const el = document.createElement("img");
    el.src = img.dataUrl;
    el.alt = img.name;
    li.appendChild(el);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "✕";
    remove.title = "Remove image";
    remove.addEventListener("click", () => {
      const idx = images.findIndex((x) => x.id === img.id);
      if (idx >= 0) images.splice(idx, 1);
      renderThumbnails();
      refreshSaveButton();
    });
    li.appendChild(remove);
    list.appendChild(li);
  }
};

const collectFormState = () => {
  formState.name = $("name").value.trim();
  formState.archetype = $("archetype").value.trim();
  formState.mood = $("mood").value;
  formState.response_length = $("response_length").value;
  formState.voice_tone = $("voice_tone").value.trim();
};

const refreshPreview = () => {
  collectFormState();
  const preview = {
    name: formState.name,
    archetype: formState.archetype,
    mood: formState.mood,
    response_length: formState.response_length,
    voice_tone: formState.voice_tone,
    vlm_suggested: formState.vlm_suggested,
    reference_images: images.map((i) => i.hash),
  };
  $("preview-json").textContent = JSON.stringify(preview, null, 2);
};

const refreshSaveButton = () => {
  collectFormState();
  const errs = validatePersonaDraft({
    name: formState.name,
    archetype: formState.archetype,
    mood: formState.mood,
    response_length: formState.response_length,
    voice_tone: formState.voice_tone,
    reference_images: images.map((i) => `sha256:${i.hash}`),
    vlm_suggested: formState.vlm_suggested,
  });
  const errEl = $("errors");
  errEl.textContent = errs.length > 0 ? errs.join(" · ") : "";
  const ok =
    errs.length === 0 &&
    formState.name.length > 0 &&
    MOODS.includes(formState.mood) &&
    RESPONSE_LENGTHS.includes(formState.response_length);
  const saveBtn = $("save-btn");
  saveBtn.disabled = !ok;
  $("suggest-btn").disabled = images.length === 0;
};

const onFilesChosen = async (/** @type {FileList} */ files) => {
  const status = $("suggest-status");
  for (const file of /** @type {Iterable<any>} */ (files)) {
    if (images.length >= MAX_IMAGES) break;
    if (!ALLOWED_MIME.has(file.type)) continue;
    const buf = await file.arrayBuffer();
    const hash = await sha256Hex(buf);
    const dataUrl = URL.createObjectURL(new Blob([buf], { type: file.type }));
    images.push({
      id: `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      hash: `sha256:${hash}`,
      name: file.name,
      dataUrl,
    });
    void status;
  }
  renderThumbnails();
  refreshSaveButton();
};

const applySuggested = (/** @type {Record<string, any>} */ suggestion) => {
  if (typeof suggestion.name === "string" && suggestion.name.length <= 32) {
    formState.name = formState.name || suggestion.name;
    $("name").value = formState.name;
  }
  if (typeof suggestion.archetype === "string") {
    formState.archetype = suggestion.archetype.slice(0, 200);
    $("archetype").value = formState.archetype;
  }
  if (typeof suggestion.mood === "string" && MOODS.includes(suggestion.mood)) {
    formState.mood = suggestion.mood;
    $("mood").value = formState.mood;
  }
  if (
    typeof suggestion.response_length === "string" &&
    RESPONSE_LENGTHS.includes(suggestion.response_length)
  ) {
    formState.response_length = suggestion.response_length;
    $("response_length").value = formState.response_length;
  }
  if (typeof suggestion.voice_tone === "string") {
    formState.voice_tone = suggestion.voice_tone.slice(0, 200);
    $("voice_tone").value = formState.voice_tone;
  }
  formState.vlm_suggested = true;
  refreshPreview();
  refreshSaveButton();
};

const onSuggestClick = async () => {
  const status = $("suggest-status");
  const btn = $("suggest-btn");
  btn.disabled = true;
  status.textContent = "Calling VLM...";
  try {
    const hashes = images.map((i) => i.hash);
    const suggestion = await petIpc.describeImages({ reference_images: hashes });
    applySuggested(suggestion);
    status.textContent = "Suggested · review and edit before saving";
  } catch (err) {
    status.textContent = `VLM failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    btn.disabled = false;
  }
};

const onSave = async () => {
  collectFormState();
  const btn = $("save-btn");
  btn.disabled = true;
  try {
    const persona = await petIpc.savePersona({
      name: formState.name,
      archetype: formState.archetype,
      mood: formState.mood,
      response_length: formState.response_length,
      voice_tone: formState.voice_tone,
      reference_images: images.map((i) => i.hash),
      vlm_suggested: formState.vlm_suggested,
    });
    $("suggest-status").textContent = `Saved ${persona.name} (${persona.id})`;
    // Tell the parent window / main to open the pet chat window for this pet.
    window.pet.onPetSaved?.({ id: persona.id, name: persona.name });
  } catch (err) {
    $("suggest-status").textContent =
      `Save failed: ${err instanceof Error ? err.message : String(err)}`;
    btn.disabled = false;
  }
};

const onCancel = () => {
  window.pet.onPetCancelled?.({});
};

// ============================================================================
// Wire-up
// ============================================================================

const hookup = () => {
  for (const id of ["name", "archetype", "mood", "response_length", "voice_tone"]) {
    $(id).addEventListener("input", () => {
      refreshPreview();
      refreshSaveButton();
    });
    $(id).addEventListener("change", () => {
      refreshPreview();
      refreshSaveButton();
    });
  }

  $("file-input").addEventListener("change", async (e) => {
    const input = /** @type {HTMLInputElement} */ (e.currentTarget);
    if (input.files) await onFilesChosen(input.files);
    input.value = ""; // allow re-picking the same files
  });

  $("suggest-btn").addEventListener("click", () => void onSuggestClick());
  $("save-btn").addEventListener("click", () => void onSave());
  $("cancel-btn").addEventListener("click", onCancel);

  refreshPreview();
  refreshSaveButton();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", hookup);
} else {
  hookup();
}