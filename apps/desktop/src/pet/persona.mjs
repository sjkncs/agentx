// apps/desktop/src/pet/persona.mjs
//
// Persona schema + Zod validator for the A32 desktop pet.
// Schema is intentionally tiny (≤ 8 fields) and matches
// apps/desktop/docs/PET_DESKTOP_SPEC.md §6.1 verbatim.

import { z } from "zod";

export const MOODS = Object.freeze([
  "outgoing",
  "shy",
  "attentive",
  "depressive",
  "playful",
  "stoic",
  "curious",
  "warm",
]);

export const RESPONSE_LENGTHS = Object.freeze([
  "one_sentence",
  "short",
  "paragraph",
  "long",
]);

/** Allowed persona name pattern. Reject empty / over-long / control chars.
 *  IP-protected characters are NOT blocked here — the runtime guardrails
 *  in persona-to-prompt.mjs (created in A32.7) handle that — but we block
 *  pure whitespace and path-separator abuse so a malicious name cannot
 *  weaponize the userData filename. */
const NAME_PATTERN = /^[^\s/\\<>:"|?*\u0000-\u001f]{1,32}$/;

export const PersonaSchema = z.object({
  id: z
    .string()
    .min(8)
    .regex(/^[a-zA-Z0-9_-]+$/u, "persona.id must be URL-safe"),
  name: z
    .string()
    .min(1)
    .max(32)
    .regex(NAME_PATTERN, "persona.name has invalid characters or is too long"),
  archetype: z.string().max(200).default(""),
  mood: z.enum(MOODS).default("attentive"),
  voice_tone: z.string().max(200).default(""),
  response_length: z.enum(RESPONSE_LENGTHS).default("short"),
  reference_images: z
    .array(z.string().regex(/^sha256:[a-f0-9]{64}$/u))
    .max(4)
    .default([]),
  vlm_suggested: z.boolean().default(false),
  created_at: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u)),
  schema_version: z.literal(1),
});

/**
 * @typedef {z.infer<typeof PersonaSchema>} Persona
 */

/** Parse + validate a persona from arbitrary JSON. Throws ZodError on failure. */
export const parsePersona = (input) => PersonaSchema.parse(input);

/** Parse without throwing — returns either the validated persona or null. */
export const tryParsePersona = (input) => {
  const result = PersonaSchema.safeParse(input);
  return result.success ? result.data : null;
};

/** Loose validator used by the builder UI as the user types. Returns the
 *  list of human-readable error messages so the form can highlight fields;
 *  empty array means valid. */
export const validatePersonaDraft = (draft) => {
  // Drafts don't carry a real id yet (savePetProfile replaces it); skip the
  // id constraint so the builder UI can validate every other field while the
  // user is still typing.
const DraftSchema = z.object({
  id: z.string().optional(),
  name: PersonaSchema.shape.name,
  archetype: PersonaSchema.shape.archetype,
  mood: PersonaSchema.shape.mood,
  voice_tone: PersonaSchema.shape.voice_tone,
  response_length: PersonaSchema.shape.response_length,
  reference_images: PersonaSchema.shape.reference_images,
  vlm_suggested: PersonaSchema.shape.vlm_suggested,
  created_at: PersonaSchema.shape.created_at,
  schema_version: PersonaSchema.shape.schema_version,
});
  const result = DraftSchema.safeParse({
    id: draft.id,
    name: draft.name ?? "",
    archetype: draft.archetype ?? "",
    mood: draft.mood ?? "attentive",
    voice_tone: draft.voice_tone ?? "",
    response_length: draft.response_length ?? "short",
    reference_images: draft.reference_images ?? [],
    vlm_suggested: draft.vlm_suggested ?? false,
    created_at:
      draft.created_at ??
      new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"),
    schema_version: 1,
  });
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
};
