/**
 * VLM descriptor — POST /api/v1/vlm/describe
 *
 * Spec: apps/desktop/docs/PET_DESKTOP_SPEC.md §6.2.
 *
 * Inputs:
 *   body = { reference_images: string[] }    // sha256:<hex> tokens
 *
 * Output (success):
 *   {
 *     name?: string,
 *     archetype?: string,
 *     mood?: "outgoing"|"shy"|"attentive"|"depressive"|"playful"|"stoic"|"curious"|"warm",
 *     voice_tone?: string,
 *     response_length?: "one_sentence"|"short"|"paragraph"|"long",
 *     fallback: boolean,        // true when no live VLM provider is configured
 *     provider: string|null,    // "qwen-vl" | "openai-vision" | null
 *   }
 *
 * Implementation v0.1:
 *   We DO NOT auto-call a real VLM provider in v0.1 because we have no
 *   configured multimodal model out-of-box. The endpoint instead returns
 *   a deterministic suggestion derived from the image-hash count so the
 *   pet-builder UI can demo end-to-end without paying for VLM. A follow-up
 *   PR wires Qwen-VL when the operator adds a multimodal key.
 *
 *   Behavioural contract:
 *     - No external network call is made by this endpoint.
 *     - The response `fallback` flag is true; the builder UI surfaces this
 *       to the user so they know the suggestion came from us, not a model.
 *     - The deterministic suggestion is **suggestive only** — the user must
 *       review and edit before saving (spec §6.2).
 */

import { createErrorResult, createSuccessResult } from "@agentx/contracts";
import type { IncomingMessage } from "node:http";

import type { ConfigApiContext, ConfigApiResponse } from "./types.js";

const ARCHETYPES_BY_MOOD = {
  outgoing: "An energetic companion that takes the lead in conversation.",
  shy: "A quiet companion that waits for the user to lead before opening up.",
  attentive: "A focused companion that watches closely and asks sharp follow-up questions.",
  depressive: "A melancholic companion that keeps things grounded and sincere.",
  playful: "A mischievous companion that turns small talk into games.",
  stoic: "A calm companion that gives measured, deliberate answers.",
  curious: "An inquisitive companion that always has one more 'why'.",
  warm: "A caring companion that emphasises reassurance and warmth.",
};

const VOICE_TONES_BY_MOOD = {
  outgoing: "Lively, slightly louder than default, with bouncy intonation.",
  shy: "Quiet, gentle, occasionally trailing off at the end of sentences.",
  attentive: "Steady, focused, and direct — asks for clarification often.",
  depressive: "Lower in register, slower pacing, longer pauses.",
  playful: "Bright and slightly exaggerated; uses rhythm changes for emphasis.",
  stoic: "Even-keeled and unhurried, with minimal emotional colouring.",
  curious: "Inflected upward at the end, picking up speed when interest rises.",
  warm: "Soft and enveloping, with the occasional longer pause for emphasis.",
};

/** Tiny non-cryptographic hash so the same image set always returns the
 *  same suggestion across reloads. We use the SHA-256 token the caller
 *  already provides and take its first 2 hex chars as a stable selector. */
const pickMood = (referenceImages: string[]): string => {
  const joined = referenceImages.join("|");
  let acc = 0;
  for (let i = 0; i < joined.length; i += 1) acc = (acc * 31 + joined.charCodeAt(i)) >>> 0;
  const order = [
    "warm", "attentive", "curious", "playful",
    "stoic", "shy", "outgoing", "depressive",
  ];
  const idx = order[acc % order.length] ? acc % order.length : 0;
  return order[idx] ?? "warm";
};

const pickLength = (referenceImages: string[]): "one_sentence" | "short" | "paragraph" | "long" => {
  const count = referenceImages.length;
  if (count <= 1) return "one_sentence";
  if (count === 2) return "short";
  if (count === 3) return "paragraph";
  return "long";
};

const deriveName = (referenceImages: string[]): string => {
  if (referenceImages.length === 0) return "";
  const first = referenceImages[0] ?? "";
  // Take the first 4 hex chars of the sha256, capitalised, prefixed with
  // 'Pet-' so we never accidentally emit a real word or a copyrighted name.
  const slice = first.replace(/^sha256:/, "").slice(0, 4).toUpperCase();
  return slice ? `Pet-${slice}` : "";
};

const isString = (v: unknown): v is string => typeof v === "string";

const parseBody = (raw: string): Record<string, unknown> => {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
};

export const handleVlmDescribeRequest = async (
  request: IncomingMessage,
  _context: ConfigApiContext,
): Promise<ConfigApiResponse> => {
  if (request.method !== "POST") {
    return {
      status: 405,
      body: createErrorResult("BAD_REQUEST", "POST required"),
    };
  }
  const chunks: Buffer[] = [];
  const raw = await new Promise<string>((resolve, reject) => {
    request.on("data", (c: Buffer) => chunks.push(c));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
  const body = parseBody(raw);
  const images = Array.isArray(body.reference_images)
    ? body.reference_images.filter(isString)
    : [];

  const mood = pickMood(images) as keyof typeof ARCHETYPES_BY_MOOD;
  const length = pickLength(images);

  return {
    status: 200,
    body: createSuccessResult({
      name: deriveName(images),
      archetype: ARCHETYPES_BY_MOOD[mood] ?? "",
      mood,
      voice_tone: VOICE_TONES_BY_MOOD[mood] ?? "",
      response_length: length,
      fallback: true,
      provider: null,
    }),
  };
};
