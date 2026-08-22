// apps/desktop/src/pet/voice-adapter.mjs
//
// Voice adapter for the pet chat window. Wraps the Web Speech API
// (SpeechRecognition for STT, SpeechSynthesis for TTS) behind a thin
// interface so a Whisper/Qwen-TTS adapter can drop in later without
// touching pet-window.mjs.
//
// Adapter contract (see spec §4.3 'Voice adapter interface'):
//
//   {
//     state: 'idle' | 'listening' | 'speaking',
//     startListening(opts: { lang?: string, onPartial?: (text: string) => void })
//       : Promise<void>,
//     stopListening(): Promise<string>,         // resolves final transcript
//     speak(text: string, opts?: { lang?: string, voice?: string, rate?: number })
//       : Promise<void>,
//     cancelSpeak(): void,
//     available: boolean,                       // STT supported in this env
//   }
//
// Why a separate module:
//   - Lets us unit-test the platform check + lang fallbacks without jsdom.
//   - Future adapters (Whisper STT, Qwen-TTS) ship alongside this file and
//     main.mjs picks the right one at runtime (A32.5).

const PLATFORM_IS_ELECTRON =
  typeof navigator !== "undefined" &&
  /Electron/i.test(navigator.userAgent || "");

/** Map a user-facing BCP-47 tag (e.g. 'zh-CN', 'en-US') to a value the
 *  SpeechRecognition constructor will accept. Falls back to OS locale. */
const resolveLang = (preferred) => {
  if (typeof preferred === "string" && preferred.length > 0) return preferred;
  if (typeof navigator !== "undefined") {
    if (Array.isArray(navigator.languages) && navigator.languages[0]) {
      return navigator.languages[0];
    }
    if (typeof navigator.language === "string" && navigator.language.length > 0) {
      return navigator.language;
    }
  }
  return "en-US";
};

/** Construct the Web Speech recognition object across vendor prefixes. */
const getRecognitionCtor = () => {
  if (typeof window === "undefined") return null;
  const w = /** @type {any} */ (window);
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Construct the Web Speech synthesis object across vendor prefixes. */
const getSynthesis = () => {
  if (typeof window === "undefined") return null;
  const w = /** @type {any} */ (window);
  return w.speechSynthesis ?? null;
};

/** Build a Web Speech adapter. Returns a no-op adapter when the runtime
 *  does not provide SpeechRecognition (e.g. web build without HTTPS,
 *  unit tests without jsdom). The adapter self-reports `available: false`
 *  so the UI can disable the mic button cleanly. */
export const createWebSpeechAdapter = () => {
  const RecognitionCtor = getRecognitionCtor();
  const synthesis = getSynthesis();
  const available =
    Boolean(RecognitionCtor) && (PLATFORM_IS_ELECTRON || typeof window !== "undefined");

  /** @type {null | SpeechRecognition} */
  let recognition = null;
  /** @type {"idle" | "listening" | "speaking"} */
  let state = "idle";
  /** @type {((text: string) => void)|null} */
  let onPartialCb = null;
  /** @type {string} */
  let lastFinal = "";
  /** @type {((text: string) => void)|null} */
  let resolveStop = null;
  /** @type {((err: Error) => void)|null} */
  let rejectStop = null;

  const startListening = async (opts = {}) => {
    if (state !== "idle") {
      throw new Error(`voice: cannot start listening while state=${state}`);
    }
    if (!available) {
      throw new Error("voice: SpeechRecognition not available in this runtime");
    }
    const lang = resolveLang(opts.lang);
    recognition = new RecognitionCtor();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    /** @type {string} */
    let finalText = "";
    /** @type {string} */
    let interimText = "";
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText = result[0].transcript;
        }
      }
      lastFinal = finalText;
      if (typeof onPartialCb === "function") {
        onPartialCb((finalText + interimText).trim());
      }
    };
    recognition.onerror = (event) => {
      const err = new Error(event.error || "speech-recognition-error");
      if (typeof rejectStop === "function") {
        rejectStop(err);
        rejectStop = null;
        resolveStop = null;
      }
      state = "idle";
    };
    recognition.onend = () => {
      const result = (finalText || lastFinal || "").trim();
      state = "idle";
      recognition = null;
      if (typeof resolveStop === "function") {
        resolveStop(result);
        resolveStop = null;
        rejectStop = null;
      }
    };
    onPartialCb = typeof opts.onPartial === "function" ? opts.onPartial : null;
    state = "listening";
    recognition.start();
  };

  const stopListening = () =>
    new Promise((resolve, reject) => {
      if (state !== "listening" || !recognition) {
        resolve((lastFinal || "").trim());
        return;
      }
      resolveStop = resolve;
      rejectStop = reject;
      try {
        recognition.stop();
      } catch (err) {
        if (typeof rejectStop === "function") {
          rejectStop(err instanceof Error ? err : new Error(String(err)));
          resolveStop = null;
          rejectStop = null;
        }
      }
    });

  const speak = async (text, opts = {}) => {
    if (typeof text !== "string" || text.length === 0) return;
    if (!synthesis) {
      // No synthesis — fall back to a no-op so the renderer does not throw.
      // Future adapters will route through Qwen-TTS here.
      return;
    }
    state = "speaking";
    return new Promise((resolve) => {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = resolveLang(opts.lang);
      if (opts.voice) {
        for (const v of synthesis.getVoices()) {
          if (v.name === opts.voice || v.voiceURI === opts.voice) {
            utter.voice = v;
            break;
          }
        }
      }
      if (typeof opts.rate === "number" && Number.isFinite(opts.rate)) {
        utter.rate = Math.min(2, Math.max(0.5, opts.rate));
      }
      utter.onend = () => { state = "idle"; resolve(); };
      utter.onerror = () => { state = "idle"; resolve(); };
      synthesis.speak(utter);
    });
  };

  const cancelSpeak = () => {
    if (synthesis) synthesis.cancel();
    state = "idle";
  };

  return Object.freeze({
    state: () => state,
    startListening,
    stopListening,
    speak,
    cancelSpeak,
    available,
  });
};

/** Default factory used by pet-window.mjs unless main.mjs swaps it. */
export const createDefaultVoiceAdapter = () => createWebSpeechAdapter();