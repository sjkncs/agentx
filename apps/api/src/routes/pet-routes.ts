/**
 * apps/api/src/routes/pet-routes.ts
 *
 * REST API routes for pet profile synchronization.
 * Supports both Supabase-backed storage (cloud) and local fallback.
 *
 * Endpoints:
 *   GET    /api/v1/pets           - List all pets for user
 *   POST   /api/v1/pets           - Create a new pet
 *   GET    /api/v1/pets/:id       - Get a specific pet
 *   PUT    /api/v1/pets/:id       - Update a pet
 *   DELETE /api/v1/pets/:id       - Delete a pet
 *   GET    /api/v1/pets/export    - Export all pets as JSON
 *   POST   /api/v1/pets/import   - Import pets from JSON
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { URL } from "node:url";
import { createSupabaseClient, type PetProfileRow, type WindowBounds } from "../supabase.js";

export interface PetProfile {
  id: string;
  name: string;
  archetype: string;
  mood: string;
  voice_tone: string;
  response_length: string;
  reference_images: string[];
  vlm_suggested: boolean;
  window_bounds: WindowBounds | null;
  created_at: string;
  updated_at: string;
}

export interface PetImportPayload {
  pets: PetProfile[];
  overwrite?: boolean;
}

export function parsePetFromBody(body: Record<string, unknown>): Omit<PetProfile, "id" | "created_at" | "updated_at"> {
  return {
    name: String(body.name ?? ""),
    archetype: String(body.archetype ?? ""),
    mood: String(body.mood ?? "attentive"),
    voice_tone: String(body.voice_tone ?? ""),
    response_length: String(body.response_length ?? "paragraph"),
    reference_images: Array.isArray(body.reference_images) ? body.reference_images.map(String) : [],
    vlm_suggested: Boolean(body.vlm_suggested ?? false),
    window_bounds: body.window_bounds as WindowBounds | null ?? null,
  };
}

export async function handlePetRoutes(
  pathname: string,
  method: string,
  userId: string | undefined,
  body: Record<string, unknown> | undefined,
  _request: IncomingMessage,
  response: ServerResponse
): Promise<boolean> {
  if (!userId) {
    sendJson(response, 401, { error: "Unauthorized" });
    return true;
  }
  const supabase = createSupabaseClient();

  // GET /api/v1/pets/export - Export all pets
  if (method === "GET" && pathname === "/api/v1/pets/export") {
    const pets = await supabase.listPets(userId);
    sendJson(response, 200, {
      pets,
      exported_at: new Date().toISOString(),
      count: pets.length,
    });
    return true;
  }

  // POST /api/v1/pets/import - Import pets from JSON
  if (method === "POST" && pathname === "/api/v1/pets/import") {
    if (!body || !Array.isArray(body.pets)) {
      sendJson(response, 400, { error: "Invalid import payload. Expected { pets: [...] }" });
      return true;
    }
    const importPayload = body as unknown as PetImportPayload;
    let imported = 0;
    let skipped = 0;

    for (const pet of importPayload.pets) {
      if (!pet.name || !pet.id) {
        skipped++;
        continue;
      }
      const row = {
        id: pet.id,
        name: pet.name,
        archetype: pet.archetype ?? "",
        mood: pet.mood ?? "attentive",
        voice_tone: pet.voice_tone ?? "",
        response_length: pet.response_length ?? "paragraph",
        reference_images: pet.reference_images ?? [],
        vlm_suggested: pet.vlm_suggested ?? false,
        window_bounds: pet.window_bounds ?? null,
        created_at: pet.created_at ?? new Date().toISOString(),
        updated_at: pet.updated_at ?? new Date().toISOString(),
        user_id: userId,
      };
      await supabase.upsertPet(row);
      imported++;
    }

    sendJson(response, 200, {
      imported,
      skipped,
      message: `Successfully imported ${imported} pets, skipped ${skipped}.`,
    });
    return true;
  }

  // GET /api/v1/pets - List all pets
  if (method === "GET" && pathname === "/api/v1/pets") {
    const pets = await supabase.listPets(userId);
    sendJson(response, 200, { pets, count: pets.length });
    return true;
  }

  // POST /api/v1/pets - Create a new pet
  if (method === "POST" && pathname === "/api/v1/pets") {
    if (!body) {
      sendJson(response, 400, { error: "Missing request body" });
      return true;
    }
    const petData = parsePetFromBody(body);
    const id = `pet_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    const row = {
      ...petData,
      id,
      created_at: now,
      updated_at: now,
      user_id: userId,
    };
    await supabase.upsertPet(row);
    sendJson(response, 201, { pet: row });
    return true;
  }

  // Parse :id routes
  const petIdMatch = pathname.match(/^\/api\/v1\/pets\/([^/]+)$/);
  if (petIdMatch && petIdMatch[1]) {
    const petId = petIdMatch[1];
    const pets = await supabase.listPets(userId);
    const pet = pets.find((p) => p.id === petId);

    // GET /api/v1/pets/:id
    if (method === "GET") {
      if (!pet) {
        sendJson(response, 404, { error: "Pet not found" });
        return true;
      }
      sendJson(response, 200, { pet });
      return true;
    }

    // PUT /api/v1/pets/:id
    if (method === "PUT") {
      if (!body) {
        sendJson(response, 400, { error: "Missing request body" });
        return true;
      }
      if (!pet) {
        sendJson(response, 404, { error: "Pet not found" });
        return true;
      }
      const updates = parsePetFromBody(body);
      const updated = {
        id: petId,
        name: updates.name,
        archetype: updates.archetype,
        mood: updates.mood,
        voice_tone: updates.voice_tone,
        response_length: updates.response_length,
        reference_images: updates.reference_images,
        vlm_suggested: updates.vlm_suggested,
        window_bounds: updates.window_bounds,
        created_at: pet.created_at,
        updated_at: new Date().toISOString(),
        user_id: userId,
      };
      await supabase.upsertPet(updated);
      sendJson(response, 200, { pet: updated });
      return true;
    }

    // DELETE /api/v1/pets/:id
    if (method === "DELETE") {
      if (!pet || !petId) {
        sendJson(response, 404, { error: "Pet not found" });
        return true;
      }
      await supabase.deletePet(petId);
      sendJson(response, 200, { deleted: true, id: petId });
      return true;
    }
  }

  return false;
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
  });
  response.end(JSON.stringify(data, null, 2));
}
