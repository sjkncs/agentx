"use client";

import { useState, useEffect } from "react";

interface PetProfile {
  id: string;
  name: string;
  archetype: string;
  mood: string;
  voice_tone: string;
  response_length: string;
  reference_images: string[];
  vlm_suggested: boolean;
  window_bounds: { x: number; y: number; width: number; height: number } | null;
  created_at: string;
  updated_at: string;
}

interface PetListResponse {
  pets: PetProfile[];
  count: number;
}

const MOOD_OPTIONS = [
  { value: "attentive", label: "专注 (Attentive)" },
  { value: "playful", label: "活泼 (Playful)" },
  { value: "calm", label: "平静 (Calm)" },
  { value: "energetic", label: "活力 (Energetic)" },
];

const ARCHETYPE_OPTIONS = [
  { value: "assistant", label: "助手 (Assistant)" },
  { value: "mentor", label: "导师 (Mentor)" },
  { value: "companion", label: "伙伴 (Companion)" },
  { value: "creative", label: "创意 (Creative)" },
];

const LENGTH_OPTIONS = [
  { value: "short", label: "简短" },
  { value: "paragraph", label: "段落" },
  { value: "detailed", label: "详细" },
];

export default function PetsPage() {
  const [pets, setPets] = useState<PetProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingPet, setEditingPet] = useState<PetProfile | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    archetype: "assistant",
    mood: "attentive",
    voice_tone: "",
    response_length: "paragraph",
  });

  const fetchPets = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/v1/pets");
      if (!res.ok) throw new Error("Failed to fetch pets");
      const data: PetListResponse = await res.json();
      setPets(data.pets || []);
      setError(null);
    } catch {
      setError("Unable to connect to server. Make sure the API is running.");
      setPets([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPets();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/v1/pets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error("Failed to create pet");
      await fetchPets();
      setIsCreating(false);
      setFormData({ name: "", archetype: "assistant", mood: "attentive", voice_tone: "", response_length: "paragraph" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPet) return;
    try {
      const res = await fetch(`/api/v1/pets/${editingPet.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error("Failed to update pet");
      await fetchPets();
      setEditingPet(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this pet?")) return;
    try {
      const res = await fetch(`/api/v1/pets/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete pet");
      await fetchPets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleExport = async () => {
    try {
      const res = await fetch("/api/v1/pets/export");
      if (!res.ok) throw new Error("Failed to export");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pets-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export");
    }
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const res = await fetch("/api/v1/pets/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("Failed to import");
        await fetchPets();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to import");
      }
    };
    input.click();
  };

  const startEditing = (pet: PetProfile) => {
    setEditingPet(pet);
    setFormData({
      name: pet.name,
      archetype: pet.archetype,
      mood: pet.mood,
      voice_tone: pet.voice_tone,
      response_length: pet.response_length,
    });
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <a href="/" className="text-xl font-bold text-white hover:text-indigo-400 transition">AgentX</a>
            <nav className="flex gap-6 text-sm">
              <a href="/pets" className="text-indigo-400 font-medium">Pet Companions</a>
              <a href="/data-tasks" className="text-gray-400 hover:text-white transition">Data Tasks</a>
              <a href="/notebook" className="text-gray-400 hover:text-white transition">Notebook</a>
              <a href="/admin" className="text-gray-400 hover:text-white transition">Admin</a>
            </nav>
          </div>
        </div>
      </header>

      <main className="p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">Pet Companions</h1>
            <p className="text-gray-400 mt-1">Manage your AI desktop companions</p>
          </div>
          <div className="flex gap-3">
            <button onClick={handleExport} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition">
              Export Backup
            </button>
            <button onClick={handleImport} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition">
              Import
            </button>
            <button onClick={() => setIsCreating(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg transition">
              + Create Pet
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-6 p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-200">
            {error}
          </div>
        )}

        {(isCreating || editingPet) && (
          <div className="mb-8 p-6 bg-gray-900 rounded-xl border border-gray-700">
            <h2 className="text-xl font-semibold mb-4">{editingPet ? "Edit Pet" : "Create New Pet"}</h2>
            <form onSubmit={editingPet ? handleUpdate : handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Archetype</label>
                  <select
                    value={formData.archetype}
                    onChange={(e) => setFormData({ ...formData, archetype: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:outline-none focus:border-indigo-500"
                  >
                    {ARCHETYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Mood</label>
                  <select
                    value={formData.mood}
                    onChange={(e) => setFormData({ ...formData, mood: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:outline-none focus:border-indigo-500"
                  >
                    {MOOD_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Response Length</label>
                  <select
                    value={formData.response_length}
                    onChange={(e) => setFormData({ ...formData, response_length: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:outline-none focus:border-indigo-500"
                  >
                    {LENGTH_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-gray-400 mb-1">Voice / Tone</label>
                  <input
                    type="text"
                    value={formData.voice_tone}
                    onChange={(e) => setFormData({ ...formData, voice_tone: e.target.value })}
                    placeholder="e.g., Warm, Professional, Playful..."
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg transition">
                  {editingPet ? "Save Changes" : "Create Pet"}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingPet(null); setIsCreating(false); }}
                  className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
          </div>
        ) : pets.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-lg mb-4">No pets yet</p>
            <button onClick={() => setIsCreating(true)} className="text-indigo-400 hover:text-indigo-300">
              Create your first companion
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pets.map((pet) => (
              <div key={pet.id} className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden hover:border-gray-600 transition">
                <div className="h-32 bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center">
                  <span className="text-6xl">{pet.vlm_suggested ? "🤖" : "🐾"}</span>
                </div>
                <div className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold text-white">{pet.name}</h3>
                    <span className="px-2 py-1 text-xs bg-gray-700 rounded-full text-gray-300">
                      {pet.archetype}
                    </span>
                  </div>
                  <div className="space-y-1 text-sm text-gray-400 mb-4">
                    <p>Mood: <span className="text-gray-300">{pet.mood}</span></p>
                    <p>Response: <span className="text-gray-300">{pet.response_length}</span></p>
                    {pet.voice_tone && <p>Voice: <span className="text-gray-300">{pet.voice_tone}</span></p>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => startEditing(pet)}
                      className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition text-sm"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(pet.id)}
                      className="px-3 py-2 bg-red-900/50 hover:bg-red-800/50 border border-red-700 rounded-lg transition text-sm text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </main>
    </div>
  );
}
