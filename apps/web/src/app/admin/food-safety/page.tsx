"use client";

import { useState, useEffect } from "react";

interface FoodSafetyEvent {
  id: string;
  source: string;
  raw_content: string;
  author?: string;
  platform?: string;
  received_at: string;
  status: string;
  intent?: string;
  intent_confidence?: number;
  severity?: string;
  root_cause?: string;
  risk_level?: number;
  reply_content?: string;
  reply_status?: string;
  work_order_id?: string;
  case_no?: string;
}

interface Stats {
  total: number;
  pending: number;
  processing: number;
  escalated: number;
  done: number;
  by_severity: { high: number; medium: number; low: number };
  by_intent: { food_safety_risk: number; consultation_complaint: number; irrelevant: number };
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  processing: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  escalated: "bg-red-500/20 text-red-400 border-red-500/30",
  done: "bg-green-500/20 text-green-400 border-green-500/30",
  ignored: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const SEVERITY_COLORS: Record<string, string> = {
  high: "text-red-400 bg-red-500/20",
  medium: "text-yellow-400 bg-yellow-500/20",
  low: "text-green-400 bg-green-500/20",
};

const SOURCE_ICONS: Record<string, string> = {
  qiyu: "💬",
  sentiment: "📱",
  regulatory: "📋",
  internal: "🏭",
  manual: "👤",
  webhook: "🔗",
};

export default function FoodSafetyPage() {
  const [events, setEvents] = useState<FoodSafetyEvent[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<FoodSafetyEvent | null>(null);
  const [filter, setFilter] = useState<{ status?: string; source?: string; severity?: string }>({});
  const [testContent, setTestContent] = useState("");

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/v1/food-safety/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      const data = await res.json();
      if (data.success) {
        setStats(data.data.stats);
        setEvents(data.data.events || []);
      }
      setError(null);
    } catch {
      setError("Unable to connect to server");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleTest = async () => {
    if (!testContent.trim()) return;
    try {
      const res = await fetch("/api/v1/food-safety/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: testContent }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`意图: ${data.data.intent.intent}\n严重程度: ${data.data.diagnosis.severity}\n回复类型: ${data.data.reply.reply_type}`);
      }
    } catch {
      alert("Test failed");
    }
  };

  const filteredEvents = events.filter((e) => {
    if (filter.status && e.status !== filter.status) return false;
    if (filter.source && e.source !== filter.source) return false;
    if (filter.severity && e.severity !== filter.severity) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <span>喜茶食安监控</span>
                <span className="text-2xl">{SOURCE_ICONS.regulatory}</span>
              </h1>
              <p className="text-gray-400 text-sm mt-1">Food Safety Monitoring Dashboard</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={fetchData}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition text-sm"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-200">
            {error}
          </div>
        )}

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
            <StatCard label="Total" value={stats.total} color="gray" />
            <StatCard label="Pending" value={stats.pending} color="yellow" />
            <StatCard label="Escalated" value={stats.escalated} color="red" />
            <StatCard label="High Risk" value={stats.by_severity.high} color="red" />
            <StatCard label="Medium" value={stats.by_severity.medium} color="yellow" />
            <StatCard label="Resolved" value={stats.done} color="green" />
          </div>
        )}

        {/* Test Section */}
        <div className="mb-8 p-6 bg-gray-900 rounded-xl border border-gray-700">
          <h2 className="text-lg font-semibold mb-4">快速测试 / Quick Test</h2>
          <div className="flex gap-3">
            <input
              type="text"
              value={testContent}
              onChange={(e) => setTestContent(e.target.value)}
              placeholder="输入测试内容，例如：在奶茶里喝到了头发"
              className="flex-1 px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={handleTest}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg transition"
            >
              Test
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6 flex gap-4">
          <select
            value={filter.status || ""}
            onChange={(e) => setFilter({ ...filter, status: e.target.value || undefined })}
            className="px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:outline-none focus:border-indigo-500"
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="escalated">Escalated</option>
            <option value="done">Done</option>
          </select>
          <select
            value={filter.source || ""}
            onChange={(e) => setFilter({ ...filter, source: e.target.value || undefined })}
            className="px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:outline-none focus:border-indigo-500"
          >
            <option value="">All Sources</option>
            <option value="qiyu">Qiyu (七鱼)</option>
            <option value="sentiment">Sentiment (舆情)</option>
            <option value="regulatory">Regulatory (监管)</option>
            <option value="internal">Internal (内部)</option>
            <option value="manual">Manual (手动)</option>
          </select>
          <select
            value={filter.severity || ""}
            onChange={(e) => setFilter({ ...filter, severity: e.target.value || undefined })}
            className="px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:outline-none focus:border-indigo-500"
          >
            <option value="">All Severity</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        {/* Events Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-lg">No events found</p>
            <p className="text-sm mt-2">Events will appear here when received</p>
          </div>
        ) : (
          <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Source</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Content</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Intent</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Severity</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Status</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filteredEvents.map((event) => (
                  <tr
                    key={event.id}
                    onClick={() => setSelectedEvent(event)}
                    className="hover:bg-gray-800/50 cursor-pointer transition"
                  >
                    <td className="px-4 py-3">
                      <span className="text-lg">{SOURCE_ICONS[event.source] || "📝"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-300 truncate max-w-xs">
                        {event.raw_content.slice(0, 60)}
                        {event.raw_content.length > 60 ? "..." : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 text-xs rounded-full bg-gray-700 text-gray-300">
                        {event.intent || "pending"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {event.severity && (
                        <span className={`px-2 py-1 text-xs rounded-full ${SEVERITY_COLORS[event.severity]}`}>
                          {event.severity.toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded-full border ${STATUS_COLORS[event.status] || ""}`}>
                        {event.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(event.received_at).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Event Detail Modal */}
        {selectedEvent && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-2xl max-h-[80vh] overflow-auto">
              <div className="p-6 border-b border-gray-700">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Event Detail</h2>
                  <button
                    onClick={() => setSelectedEvent(null)}
                    className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-sm text-gray-400">Source</label>
                  <p className="text-white">
                    {SOURCE_ICONS[selectedEvent.source]} {selectedEvent.source}
                    {selectedEvent.platform && ` / ${selectedEvent.platform}`}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-400">Content</label>
                  <p className="text-white whitespace-pre-wrap">{selectedEvent.raw_content}</p>
                </div>
                {selectedEvent.author && (
                  <div>
                    <label className="text-sm text-gray-400">Author</label>
                    <p className="text-white">{selectedEvent.author}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-400">Intent</label>
                    <p className="text-white">{selectedEvent.intent || "pending"}</p>
                  </div>
                  <div>
                    <label className="text-sm text-gray-400">Severity</label>
                    <p className={`font-medium ${selectedEvent.severity === "high" ? "text-red-400" : selectedEvent.severity === "medium" ? "text-yellow-400" : "text-green-400"}`}>
                      {selectedEvent.severity?.toUpperCase() || "pending"}
                    </p>
                  </div>
                </div>
                {selectedEvent.root_cause && (
                  <div>
                    <label className="text-sm text-gray-400">Root Cause</label>
                    <p className="text-white">{selectedEvent.root_cause}</p>
                  </div>
                )}
                {selectedEvent.reply_content && (
                  <div>
                    <label className="text-sm text-gray-400">Reply Content</label>
                    <div className="p-3 bg-gray-800 rounded-lg text-sm text-gray-300 whitespace-pre-wrap">
                      {selectedEvent.reply_content}
                    </div>
                  </div>
                )}
                {selectedEvent.case_no && (
                  <div>
                    <label className="text-sm text-gray-400">Case No</label>
                    <p className="text-indigo-400 font-mono">{selectedEvent.case_no}</p>
                  </div>
                )}
                <div>
                  <label className="text-sm text-gray-400">Received At</label>
                  <p className="text-white">{new Date(selectedEvent.received_at).toLocaleString("zh-CN")}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorClasses: Record<string, string> = {
    gray: "bg-gray-800 border-gray-700 text-white",
    yellow: "bg-yellow-900/30 border-yellow-700/50 text-yellow-400",
    red: "bg-red-900/30 border-red-700/50 text-red-400",
    green: "bg-green-900/30 border-green-700/50 text-green-400",
    blue: "bg-blue-900/30 border-blue-700/50 text-blue-400",
  };

  return (
    <div className={`rounded-xl border p-4 ${colorClasses[color]}`}>
      <p className="text-sm text-gray-400">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}
