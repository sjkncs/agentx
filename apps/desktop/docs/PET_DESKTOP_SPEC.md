# PET_DESKTOP_SPEC — Smart Desktop Pet (桌宠)

**Status:** Draft v0.1 — awaiting acceptance criteria sign-off.
**Owner:** DataFoundry Enhanced
**Target release:** A32 (following A31 run-persistence)

## 1. Problem

Users interact with DataFoundry Enhanced only inside the Web UI tab. For workflows where DataFoundry should be ambient (always visible, no window juggling, voice-driven), the UX needs a desktop-resident avatar that:

1. Launches via a single click on a custom image (the "pet").
2. Lets the user pick what they want to do (mode picker).
3. Reuses the **full agent-runtime harness** as the backend — not a separate chat engine.
4. Optionally acts as a virtual companion with a persona-driven response style.
5. Lets the user create their own pets by uploading one or more reference images.

## 2. Non-goals (explicit)

These are **out of scope for v0.1** to keep the surface surgical:

- Multiple pets on screen simultaneously (one pet window per process).
- Pet-to-pet interaction.
- Voice-cloning the user's voice for TTS.
- Cross-device sync of pet state (state is per-device `userData/pet-state.json`).
- Onboarding tutorials / animations / idle animations / click-and-drag.
- Persistent pet memory across sessions (persona is fixed at creation; conversation history follows the existing dfd_messages table — see §6.3).
- Bundled preset characters (Vocaloid / anime IPs / copyrighted avatars). See §7.

## 3. Decisions already locked

| Question | Decision |
|---|---|
| Where does the pet window live? | Extend the existing `apps/desktop` Electron app as a separate always-on-top `BrowserWindow`. |
| Voice stack for v0.1? | Web Speech API (SpeechRecognition + SpeechSynthesis). Adapter interface so Whisper/Qwen-TTS can drop in later. |
| Preset characters? | **None.** All personas are user-authored. The codebase must not ship any Vocaloid / anime / celebrity persona. |

## 4. UX

### 4.1 First-run flow
1. User installs / runs `apps/desktop` → main window opens (existing behaviour).
2. User clicks "🐾 Add a pet" in the main window → **Pet Builder** modal opens.
3. User uploads 1–4 reference images, optionally fills `name`, `mood`, `archetype`.
4. If images provided, the app calls VLM (`Qwen-VL` or any configured provider) → returns suggested `persona` JSON.
5. User reviews / edits the JSON, clicks **Save**.
6. A 100×140 PNG-sprite pet appears (frameless, `alwaysOnTop`, transparent).

### 4.2 Daily flow
1. User clicks the pet image → **Pet Window** opens (250×400 frameless, always-on-top, transparent background outside the avatar area).
2. Window contents:
   - Avatar sprite (animated PNG sequence for "idle", "talking", "thinking" — three states).
   - Mode picker: `工作 / Work`, `陪伴 / Companion`, `设置 / Settings`.
   - Text input + mic button (Web Speech STT).
   - Conversation transcript (last 20 messages).
3. User picks mode → first time in `陪伴`, **compliance disclaimer modal** (§7.2) blocks chat until acknowledged.
4. User types or holds the mic → message goes through Web Speech → text → backend run → AG-UI events render responses (text + tool-call cards + artifacts).

### 4.3 Mode semantics

| Mode | System prompt prefix | Toolset |
|---|---|---|
| `work` (default) | None | Full agent-runtime harness (existing). |
| `companion` | `persona.json` flattened to English instructions: name, archetype, mood, voice_tone, response_length, caveats | Read-only harness tools only (`list_data_sources`, `inspect_schema`, `preview_table`, `retrieve_knowledge`). **No** `run_sql_readonly`, `generate_report`, `export_artifact` — companion cannot act on data. |

Mode + persona live in the run's `forwardedProps.pet` field. The runtime injects them via the existing `goal` / `systemPrompt` path. **No agent-runtime code changes required.**

## 5. Architecture

### 5.1 Components

```
apps/desktop/
├── src/
│   ├── main.mjs                       [existing, add pet-window lifecycle]
│   ├── preload.mjs                    [existing, expose pet IPC]
│   ├── pet/
│   │   ├── pet-window.html            [new]
│   │   ├── pet-window.mjs             [new — pet renderer]
│   │   ├── pet-builder.html           [new]
│   │   ├── pet-builder.mjs            [new]
│   │   ├── persona-store.mjs          [new — read/write pet-state.json]
│   │   └── voice-adapter.mjs          [new — wraps Web Speech]
│   └── ipc/
│       └── pet-channels.mjs           [new — IPC handlers]
└── docs/
    └── PET_DESKTOP_SPEC.md            [this file]

packages/agent-runtime/                [untouched]
apps/api/                              [untouched]
apps/web/                              [untouched]
```

### 5.2 IPC contract

```ts
// src/preload.mjs — exposed via contextBridge
window.pet = {
  list(): Promise<PetSummary[]>;
  create(input: PetCreateInput): Promise<PetProfile>;
  get(id: string): Promise<PetProfile>;
  delete(id: string): Promise<void>;
  startChat(input: { petId: string; mode: "work" | "companion"; message: string }): Promise<RunHandle>;
  cancelChat(handle: RunHandle): Promise<void>;
  onEvent(handle: RunHandle, cb: (event: AgUiEvent) => void): () => void; // unsubscribe
  voice: {
    startListening(): Promise<void>;
    stopListening(): Promise<string>; // returns transcript
    speak(text: string, voice: string): Promise<void>;
  };
};
```

### 5.3 Persistence

| Data | Where | Format |
|---|---|---|
| Pet profiles (image hash, persona JSON, name, mode) | `userData/pet-state.json` | JSON array |
| Conversation history | Supabase `dfd_messages` (existing A31) | rows |
| Pet → session link | Supabase `dfd_sessions.metadata.pet_id` | string |

### 5.4 Connection modes

Because the Electron app cannot run the API server locally (FTS5 — see `apps/desktop/docs/ARCHITECTURE.md`), the pet runs in two modes:

| Mode | Trigger | Behaviour |
|---|---|---|
| `connected` | `DATAFOUNDRY_API_URL` env or remote API reachable on startup | All pet chats POST to `POST /api/v1/runs`. Full harness. |
| `standalone` | No API reachable | Direct package import of `@datafoundry/agent-runtime` (the path already used for CDL panel). Read-only harness subset; no Supabase persistence. |

The Pet Builder / Persona / voice adapter are identical in both modes.

## 6. Persona specification

A persona is a JSON document that maps directly to the system-prompt prefix. It is what makes "the same harness" respond differently per pet.

### 6.1 Schema (v0.1)

```jsonc
{
  "name": "string (1-32 chars, no preset names allowed)",
  "archetype": "string (free text, max 200 chars)",
  "mood": "outgoing | shy | attentive | depressive | playful | stoic | curious | warm",
  "voice_tone": "string (free text, max 200 chars)",
  "response_length": "one_sentence | short | paragraph | long",
  "reference_images": ["sha256:..."],   // hashes of uploaded images
  "vlm_suggested": false,               // true if generated by VLM, false if user-authored
  "created_at": "ISO-8601",
  "schema_version": 1
}
```

### 6.2 Generation

- If the user uploaded images, call `POST /api/v1/vlm/describe` (a new thin endpoint that wraps the configured VLM provider) → returns a suggested `archetype`, `mood`, `voice_tone`. User can edit every field.
- The persona is **always previewed in plain text** to the user before save. VLM is a suggestion engine, not an authority.

### 6.3 Why persona lives in `forwardedProps.pet` not in `dfd_pets`

Putting the persona into the run's `forwardedProps` (existing field — already used for `goal`, `command`, etc.) means:

- No new schema table needed for v0.1.
- Persona is automatically attached to `dfd_messages` via the existing A31 memory-bank sink (which reads from `forwardedProps.pet` to derive the system-prompt prefix and labels each row with `pet_id`).
- If we need persona as a first-class artifact later (sharing, marketplace), we can add a `dfd_pets` table without breaking this v0.1.

## 7. Compliance & legal safety net

### 7.1 No bundled presets (decision locked)

The codebase MUST NOT contain persona presets for Vocaloid / anime / celebrity characters. A CI grep gate enforces this:

```bash
# scripts/check-no-bundled-presets.sh
grep -ri -E "洛天依|vocaloid|hatsune|miku|初音|鏡音|len|rin|kagamine|anya|re:zero|any\(c\)elebrity" \
    apps/desktop/src/pet apps/web/src/data-tasks \
    --include='*.{ts,mjs,tsx,json,md}' \
    --exclude-dir=node_modules --exclude=README*.md \
    && exit 1 || exit 0
```

This runs in `npm run lint:compliance` and as a CI step.

### 7.2 Disclaimer UI

When the user picks `陪伴` mode for the first time per session, a modal appears:

> **虚拟陪伴模式提示 / Virtual Companion Disclaimer**
>
> - 该角色为用户自定义的人格配置，不会替代专业心理咨询、医疗或法律建议。
> - 不应将对话视为真实社交关系的替代。长期过度依赖可能影响您的心理健康与现实人际关系。
> - 您与角色之间生成的所有内容仅存储于您的本地设备与您授权的云端账户；DataFoundry 不会用于训练第三方模型。
> - 不得使用本模式冒充真实人物、传播违法或侵权内容，包括但不限于：未授权使用他人姓名、肖像、声音或受版权保护的角色。
>
> [I understand / 我已知晓]

The acknowledgement is recorded in `userData/pet-state.json` per pet and resets on app restart.

### 7.3 Runtime guardrails

In `companion` mode, the system-prompt prefix includes:

```
You are a virtual companion configured by the user. You MUST:
- Decline any request to impersonate a real, named public figure or a
  trademarked fictional character unless the user has uploaded a persona
  explicitly marked `vlm_suggested: false` AND the user owns that
  character IP.
- Refuse to provide professional medical, legal, or financial advice;
  recommend a qualified professional instead.
- Never claim to have feelings, consciousness, or to be a real person.
- If the user expresses self-harm ideation, respond with crisis-line
  resources and do not continue the role-play.

You MUST NOT generate sexual content involving minors.
```

The existing agent-runtime's HITL approval flow already gives the operator a kill switch; companion runs go through the same pipeline.

## 8. Acceptance criteria & machine gates

| # | Acceptance criterion | Gate |
|---|---|---|
| AC-1 | Click pet image → pet window opens, focus moves to it | Manual smoke + Electron e2e (Playwright) |
| AC-2 | Mode picker (工作 / 陪伴 / 设置) renders | vitest `PetModeSelect.test.ts` |
| AC-3 | `work` mode calls `POST /api/v1/runs` with the existing toolset (verified by inspecting `forwardedProps.pet`) | vitest e2e replaying recorded request |
| AC-4 | `companion` mode strips `run_sql_readonly` / `generate_report` / `export_artifact` from the toolset (asserted via agent-runtime tool registry) | vitest |
| AC-5 | Disclaimer modal blocks `companion` mode once per session; ack is persisted | vitest + Electron storage assertion |
| AC-6 | Pet Builder upload → VLM call → suggested persona → user edits → save round-trips | vitest + manual |
| AC-7 | Custom pet → fully harness-capable in `work` mode | Manual smoke |
| AC-8 | A31 sinks still work for pet runs (dfd_messages rows, dfd_token_usage rows) | tsc + supabase verify |
| AC-9 | Persona JSON shape validated against §6.1 (Zod) | unit test |
| AC-10 | CI grep gate flags bundled preset names | `scripts/check-no-bundled-presets.sh` exit 1 on match |
| AC-11 | Voice input → text → backend run round-trip works in zh-CN and en-US | Manual smoke |
| AC-12 | Standalone mode (no API) still allows typing + read-only harness subset | vitest |
| AC-13 | Pet state survives app restart (`userData/pet-state.json`) | vitest |
| AC-14 | No regression in existing `apps/desktop` main window (status panel, single-instance lock, window-state persistence) | Manual smoke + existing tests |

## 9. Out-of-scope explicit (repeated for reviewer)

Animation polish, multiple pets, pet-to-pet, voice cloning, cross-device sync, persona marketplace, onboarding tutorials, idle animations.

## 10. Open questions for v0.2

1. Should the pet speak the responses out loud by default in `companion` mode? (TTS toggle in settings — defer to v0.2.)
2. Should `companion` mode use a separate model (cheaper) from `work` mode? (Likely yes — defer.)
3. Should pets be shareable as exported JSON files? (Yes, deferred until we have a safety review process.)

## 11. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Voice quality for zh-CN inconsistent in Web Speech | High | Adapter interface; user can disable voice and use text. |
| VLM cost on pet creation | Medium | One-shot at creation, not per-message. Quota: 50 creations/user/day default, configurable. |
| User creates persona that violates §7.1 (e.g. names pet "Miku" + tries to make it sing) | High | Runtime guardrails §7.3 + operator kill switch via HITL panel. |
| Electron FTS5 limitation prevents API server | Already known | `connected` vs `standalone` modes §5.4. |
| Persona prompt-injection: user types persona JSON into the message and tries to override the system prompt | Medium | The persona is concatenated into the `goal` field by `createDataFoundryRunContext` which already lives in the trusted boundary; the message body goes through the normal model pipeline. |

---

**Sign-off needed before code**: confirm §8 acceptance list, §7.3 runtime guardrails wording, §5.4 connected/standalone split.