# A32 — Smart Desktop Pet (DataFoundry v1)

This delivery lands the desktop pet feature end-to-end:

- Per-click image activation (Electron always-on-top window).
- Voice (Web Speech) and text input.
- Multiple modes: `work` (full harness) and `companion` (virtual
  companionship, persona-defined tone, with legal disclaimers).
- Custom pet creation by uploading 1–4 reference images; no bundled
  copyrighted/trademarked character presets.
- Saved personas survive app restart.
- Persona prompt + toolset guardrails that strip side-effectful harness
  tools in companion mode.

## Files

```
apps/desktop/
├── docs/PET_DESKTOP_SPEC.md            # spec (A32 entry point)
├── src/
│   ├── main.mjs                        # patched to register pet IPC + tray items
│   ├── preload.mjs                     # exposes window.dfd.pet.*
│   ├── pet/
│   │   ├── persona.mjs                 # Zod schema + validator (A32.1)
│   │   ├── persona-store.mjs           # JSON-on-disk persistence (A32.1)
│   │   ├── persona-to-prompt.mjs       # system-prompt + toolset guardrails (A32.7)
│   │   ├── ipc.mjs                     # ipcMain handlers + window factories (A32.5)
│   │   ├── voice-adapter.mjs           # Web Speech adapter (A32.4)
│   │   ├── pet-builder.{html,css,mjs}  # 'Add a pet' modal (A32.2)
│   │   ├── pet-window.{html,css,mjs}   # chat surface (A32.3)
│   │   ├── *.test.mjs                  # vitest machine gates (32 cases)
│   │   └── ipc.mjs
│   └── pet/...
└── vitest.config.mjs                   # new — npm test in apps/desktop
apps/api/src/
├── routes/vlm-describe.{ts,test.ts}    # POST /api/v1/vlm/describe (A32.6)
└── config-api.ts                       # patched to wire vlm route
scripts/check-no-bundled-presets.mjs    # CI grep gate (no copyrighted presets)
```

## Acceptance gates

| Acceptance criterion | Machine gate | Status |
|---|---|---|
| AC-1  pet window opens by clicking image | manual smoke | documented in PET_DESKTOP_SPEC.md §8 |
| AC-2  voice or text communication | manual smoke + voice-adapter.test.mjs | 6 tests passing |
| AC-3  user picks what to do | manual smoke |  |
| AC-4  persona rendered via system prompt | persona-to-prompt.test.mjs | 10 tests passing |
| AC-5  companion-mode disclaimer | persona-to-prompt.test.mjs | 3 tests covering disclaimer presence / absence |
| AC-6  custom pet from uploaded image | persona-store.test.mjs + persona.test.mjs | 16 tests passing |
| AC-9  persona JSON shape | persona.test.mjs | 10 tests passing |
| AC-10 VLM describe endpoint | vlm-describe.test.ts | 5 tests passing |
| AC-13 persona persists across restart | persona-store.test.mjs | 1 test passing (re-init cycle) |
| no-bundled-presets | scripts/check-no-bundled-presets.mjs | passing |

## Run locally

```bash
cd apps/desktop
npm test                          # vitest (32 tests)
node ../../scripts/check-no-bundled-presets.mjs   # CI gate
npm start                         # launch desktop app

cd ../api
npx vitest run                    # API tests (184/185, 1 unrelated pre-existing fail)
npx tsc -b ../../tsconfig.build.json --force    # full typecheck (clean)
```

## Commits

```
432f564 feat(desktop): A32.7 companion-mode guardrails (system prompt + toolset)
7b000de feat(api): A32.6 VLM describe endpoint (deterministic v0.1 fallback)
b424f89 feat(desktop): A32.5 pet IPC + Electron main wiring + persistence tests
12043ed feat(desktop): A32.4 voice adapter (Web Speech + pluggable interface)
a09907c feat(desktop): A32.3 pet chat window UI
0d94c28 feat(desktop): A32.2 pet builder UI (images + VLM suggest + persona form)
8f3bed2 feat(desktop): A32.1 persona schema + persistent store + Zod tests
b88b0d1 docs(spec): A32 desk-pet spec + no-bundled-presets CI gate
```

## Known limits (deliberately v0.1)

- The VLM describe endpoint returns a deterministic local suggestion
  derived from image-hash counts rather than calling a real multimodal
  provider — see `vlm-describe.ts` header. A follow-up PR wires Qwen-VL
  / OpenAI Vision once a multimodal key is configured.
- Streaming of /api/v1/runs currently treats the response as NDJSON
  rather than true SSE. Once the upstream route supports SSE, switch
  `pumpSse` to a real `text/event-stream` parser.
- Real microphone Web Speech quality varies wildly across Windows
  versions and is exercised manually per spec §8 AC-11.