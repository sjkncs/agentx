import { PERSONA_STORAGE_KEY, type PersonaId } from "./components/guide/quick-start-guide-state";

/**
 * Lightweight persona preset: when a user picks a persona, the workspace
 * applies these defaults (left panel initial tab, right panel state, default
 * task console view). The user can override any of these later — persona is a
 * starting point, not a lock.
 */
export type PersonaPreset = {
  defaultLeftPanelTab:
    | "db"
    | "knowledge"
    | "mcp"
    | "skills"
    | "llm"
    | "assets";
  openRightPanel: "console" | "documents" | null;
  welcomeMessage: string;
  exampleQuery: string | null;
  showTraceDag: boolean;
  showKnowledgePanel: boolean;
};

export const PERSONA_PRESETS: Record<PersonaId, PersonaPreset> = {
  "data-scientist": {
    defaultLeftPanelTab: "db",
    openRightPanel: "console",
    welcomeMessage:
      "Welcome back. Your datasources are on the left. Run a query and the trace will populate the console.",
    exampleQuery: "Show the top 10 customers by total orders in the last 30 days.",
    showTraceDag: true,
    showKnowledgePanel: false,
  },
  business: {
    defaultLeftPanelTab: "assets",
    openRightPanel: null,
    welcomeMessage:
      "Hi. Ask a question in plain English; DataFoundry will surface the answer as a chart or table.",
    exampleQuery: "How many new customers signed up this month vs last month?",
    showTraceDag: false,
    showKnowledgePanel: false,
  },
  developer: {
    defaultLeftPanelTab: "mcp",
    openRightPanel: "console",
    welcomeMessage:
      "Hey. Tools, MCP servers, and Skills are wired up on the left. Use the CLI to script repetitive runs.",
    exampleQuery: "Run the ETL pipeline against the staging datasource.",
    showTraceDag: true,
    showKnowledgePanel: false,
  },
  "ai-engineer": {
    defaultLeftPanelTab: "llm",
    openRightPanel: "console",
    welcomeMessage:
      "Model profiles and prompt tools are pre-selected. The trace DAG shows tool calls and reasoning.",
    exampleQuery: "Compare the answer from gpt-4o vs qwen-max on the medical records question.",
    showTraceDag: true,
    showKnowledgePanel: true,
  },
  admin: {
    defaultLeftPanelTab: "skills",
    openRightPanel: null,
    welcomeMessage:
      "Audit log is enabled. User, role, and quota panels live on the left under 'Skills'. Use the CLI for bulk ops.",
    exampleQuery: null,
    showTraceDag: false,
    showKnowledgePanel: false,
  },
  researcher: {
    defaultLeftPanelTab: "knowledge",
    openRightPanel: "documents",
    welcomeMessage:
      "Document corpus is loaded. Experiments are snapshotted automatically for reproducibility.",
    exampleQuery: "Summarize the methodology section of all uploaded papers.",
    showTraceDag: false,
    showKnowledgePanel: true,
  },
};

export { PERSONA_STORAGE_KEY };

export function loadPersonaPreset(): PersonaPreset | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PERSONA_STORAGE_KEY);
    if (!raw) return null;
    return PERSONA_PRESETS[raw as PersonaId] ?? null;
  } catch {
    return null;
  }
}

export function getPersonaId(): PersonaId | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PERSONA_STORAGE_KEY);
    return (raw as PersonaId) ?? null;
  } catch {
    return null;
  }
}
