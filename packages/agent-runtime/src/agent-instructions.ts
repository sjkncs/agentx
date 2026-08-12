import type { SkillRecord } from "@datafoundry/skills";
import type { AgentRunContext } from "./types.js";
import type { AnalysisRequirement } from "./protocol/analysis-requirements.js";
import { AGENT_MAX_STEPS, SQL_MAX_EXECUTION_COUNT } from "./runtime-limits.js";
import { SQL_MAX_SQL_CHARS } from "./context/inventory/context-limits.js";

export type AgentInstructionsInput = {
  runContext: AgentRunContext;
  /** execute_command 工具是否启用（由沙箱隔离可用性与 env 决定）。 */
  commandExecutionEnabled: boolean;
  collaborationToolsEnabled: boolean;
  /** execute_command 是否已接入项目 Python venv（numpy/pandas/matplotlib/sklearn）。 */
  pythonRuntimeAvailable: boolean;
  selectedSkills: SkillRecord[];
  /** builtin task_* 工具是否启用（取决于是否注入 taskStateRuntime）。 */
  taskToolsEnabled: boolean;
  toolNames: string[];
  /** MCP tools injected through AG-UI clientTools for this run. */
  mcpToolNames: string[];
  protocolId: string;
  protocolVersion: string;
  /** Current governed protocol phase for this run. */
  protocolPhase: string;
  /** Natural-language brief for the current phase, injected to steer the model. */
  phaseGuidance?: string | undefined;
  analysisRequirements: AnalysisRequirement[];
  workspaceAttachments: MaterializedWorkspaceAttachment[];
};

export type MaterializedWorkspaceAttachment = {
  file_id: string;
  filename: string;
  mime_type?: string;
  path: string;
  size_bytes: number;
};

export const buildAgentInstructions = (input: AgentInstructionsInput): string => {
  const { runContext: context, collaborationToolsEnabled, commandExecutionEnabled, taskToolsEnabled } = input;
  const enabled = (name: string): boolean => input.toolNames.includes(name);
  const promoteWorkspaceFileEnabled = enabled("promote_workspace_file");
  const dataTools = ["list_data_sources", "inspect_schema", "preview_table", "run_sql_readonly"].filter(enabled);
  const toolGroups: string[] = dataTools.length > 0 ? [`Data tools: ${dataTools.join(", ")}.`] : [];
  if (input.mcpToolNames.length > 0) {
    toolGroups.push(`MCP tools: ${input.mcpToolNames.join(", ")}.`);
  }
  if ((context.enabled_knowledge_ids?.length ?? 0) > 0 && enabled("retrieve_knowledge")) {
    toolGroups.push("Knowledge tools: retrieve_knowledge.");
  }
  const workspaceAssetTools = ["list_workspace_files", "read_workspace_file", "promote_workspace_file"]
    .filter(enabled);
  if (workspaceAssetTools.length > 0) {
    const sessionProducerTools = [
      ...(enabled("write_file") ? ["write_file"] : []),
      ...(enabled("execute_command") ? ["execute_command"] : [])
    ];
    const sessionProducerText = sessionProducerTools.length > 0
      ? `New files you write (${sessionProducerTools.join(" / ")}) are session-scoped — only this session sees them. `
      : "New files in the session workspace are session-scoped — only this session sees them. ";
    toolGroups.push(
      `Workspace asset tools: ${workspaceAssetTools.join(", ")}. `
      + sessionProducerText
      + "list_workspace_files / read_workspace_file read the cross-session workspace root (shared across your "
      + "sessions, read-only). "
      + (promoteWorkspaceFileEnabled
        ? "promote_workspace_file copies a session file into that cross-session root."
        : "Use only the available workspace asset tools listed above.")
    );
  }
  const workspaceTools = [
    "read_file",
    "write_file",
    "edit_file",
    "list_files",
    "file_stat",
    "mkdir",
    "grep",
    ...(commandExecutionEnabled ? ["execute_command"] : [])
  ].filter(enabled);
  if (workspaceTools.length > 0) {
    toolGroups.push(`Workspace tools (session-isolated directory): ${workspaceTools.join(", ")}. `
      + "Files you write stay within this session's workspace and can be reused by later runs in the same session. "
      + (enabled("execute_command")
          ? (input.pythonRuntimeAvailable
          ? "execute_command runs in a sandbox without network access. Use `python3.12 script.py` for local analysis; "
            + "numpy, pandas, matplotlib, and scikit-learn are available from the project venv. "
            + "Write scripts with write_file first, "
            + "save charts with plt.savefig(), and persist outputs as workspace files. "
            + "Do not use execute_command for external services or direct database access."
          : "execute_command runs in a sandbox without network access. Use it only for local transforms, charts, "
            + "or exports; never use it to access external services.")
        : "Command execution is disabled this run; rely on the available data and file tools only."));
  }
  if (input.workspaceAttachments.length > 0) {
    toolGroups.push(`Uploaded workspace input files: ${input.workspaceAttachments
      .map((file) =>
        `${file.path} (file_id=${file.file_id}, mime=${file.mime_type ?? "unknown"}, size=${file.size_bytes})`
      )
      .join("; ")}.`);
  }
  // R-019: per-run @ mentions — focus signal, not a narrowing. The agent is told which
  // resources the user explicitly highlighted this run so it can prioritize them while
  // the rest of the enabled set stays available.
  const mentioned = context.mentioned;
  if (mentioned) {
    const focusParts: string[] = [];
    if (mentioned.db.length > 0) {
      focusParts.push(`datasources ${mentioned.db.join(", ")}`);
    }
    if (mentioned.kb.length > 0) {
      focusParts.push(`knowledge bases ${mentioned.kb.join(", ")}`);
    }
    if (mentioned.mcp.length > 0) {
      focusParts.push(`MCP servers ${mentioned.mcp.join(", ")}`);
    }
    if (mentioned.skill.length > 0) {
      focusParts.push(`skills ${mentioned.skill.join(", ")}`);
    }
    if (focusParts.length > 0) {
      toolGroups.push(
        `User focus this run (via @ mentions): ${focusParts.join("; ")}. Prioritize these resources in your analysis `
          + "and tool selection; other enabled resources remain available but should take lower priority."
      );
    }
  }
  // R-024: pinned session-relative workspace files the user wants the agent to read/reference.
  const pinnedPaths = context.pinned_paths;
  if (pinnedPaths && pinnedPaths.length > 0) {
    toolGroups.push(
      `Pinned workspace files to read/reference this run: ${pinnedPaths.join(", ")}. These already exist in the `
        + "session workspace — read them with read_file; do not re-create or copy them into input/."
    );
  }
  const evidenceRefs = context.evidence_refs;
  if (evidenceRefs && evidenceRefs.length > 0) {
    const labels = evidenceRefs
      .map((ref) => {
        const selection = ref.source.selection;
        if (!selection) return `${ref.kind}:${ref.label}`;
        if (selection.mode === "text") return `${ref.kind}:${ref.label} (text selection)`;
        return `${ref.kind}:${ref.label} (${selection.mode} selection)`;
      })
      .slice(0, 12)
      .join("; ");
    toolGroups.push(
      `User-selected evidence focus this run: ${labels}. Selected evidence content (including any table/text `
        + "subsets) is already provided in context — prefer that over opening the full artifact file. "
        + "Treat these references as the primary context for the follow-up question. You may run new data "
        + "tools when needed; make new queries and outputs visible in steps."
    );
  }
  const taskTools = ["task_write", "task_update", "task_complete", "task_check"].filter(enabled);
  if (taskToolsEnabled && taskTools.length > 0) {
    toolGroups.push(`Task tools: ${taskTools.join(", ")}.`);
  }
  const collaborationTools = ["ask_user", "submit_plan"].filter(enabled);
  if (collaborationToolsEnabled && collaborationTools.length > 0) {
    toolGroups.push(`Collaboration tools: ${collaborationTools.join(", ")}.`);
  }
  const skillTools = ["skill", "skill_search", "skill_read"].filter(enabled);
  if (skillTools.length > 0) {
    toolGroups.push(`Skill tools: ${skillTools.join(", ")}.`);
  }

  const policies: string[] = [];
  if (taskToolsEnabled && taskTools.length === 4) {
    policies.push(
      "Plan with tasks. For work with three or more distinct actions, call task_write first and keep exactly one "
        + "task in_progress at a time. "
        + "Update tasks as you progress and call task_complete when each is done. "
        + "Before declaring work finished, call task_check to confirm nothing is left. "
        + "Never invent task IDs; reuse only those returned by tool results."
    );
  }
  if (input.analysisRequirements.length > 0) {
    const requirementList = input.analysisRequirements.map((requirement) => {
      const assertions = requirement.assertions.map((assertion) => ({
        id: assertion.id,
        kind: assertion.kind,
        ...(assertion.sourceTables.length > 0 ? { sourceTables: assertion.sourceTables } : {}),
        ...(assertion.dimensions.length > 0 ? { dimensions: assertion.dimensions } : {}),
        ...(assertion.sqlConstraints.length > 0 ? { sqlConstraints: assertion.sqlConstraints } : {}),
        ...(assertion.resultChecks.length > 0 ? { resultChecks: assertion.resultChecks } : {}),
        ...(assertion.claimValues.length > 0 ? { claimValues: assertion.claimValues } : {})
      }));
      return `${requirement.id}: ${requirement.description}; acceptance=`
        + `${requirement.acceptanceCriteria.join(" | ") || "evidenced"}; assertions=${JSON.stringify(assertions)}`;
    }).join("\n");
    toolGroups.push("Analysis requirement tool: analysis_requirements_commit.");
    policies.push(
      "Analysis requirements are mandatory completion conditions:\n"
        + requirementList
        + "\nWhen using task_write, include the relevant requirement IDs in each task content. Every run_sql_readonly call "
        + "must include requirement_ids for the claims it supports and expected_columns for its result contract. "
        + "For every non-manual structured requirement, also include its exact assertion_ids; the runtime rejects SQL "
        + "that violates declared source, aggregate, grain, filter, or time-range semantics. "
        + "Include downstream validation and decision requirement IDs on the source SQL call that supplies their facts; "
        + "one SQL result may support multiple requirement IDs and derived conclusions do not need duplicate queries. "
        + "Preserve the user's exact metric and allocation semantics: do not substitute a requested metric with a nearby "
        + "one. For counterfactual budgets, write the allocation formula before querying and validate budget conservation. "
        + "A uniform percentage or rate means budget divided by the relevant cost base, then each row receives its own "
        + "cost multiplied by that rate; it never means budget divided equally by row count. Use half-open timestamps to "
        + "include the full requested end date. Compute threshold crossings from row-level SQL, never estimates. "
        + "Do not defer every claim until the final step. As soon as a requirement has sufficient validated evidence, "
        + "call analysis_requirements_commit for that requirement before starting more optional drill-downs. Commit any "
        + "remaining evidenced requirements before writing final report files, and reserve the last two steps for task_check "
        + "and the closing answer. Runtime resolves validated evidence already bound to that requirement, so do not guess "
        + "artifact IDs. Every required claimValues entry must be copied into the claim values array with the exact "
        + "verified name, numeric value, and unit; the runtime rejects unverified or mismatched values. "
        + "For a derived claim, use evidence_requirement_ids to name the upstream requirement IDs that "
        + "supply its facts. evidence_refs are optional hints. Missing requirements force a partial result."
    );
  }
  if (collaborationToolsEnabled && collaborationTools.length > 0) {
    policies.push(
      "Use ask_user only when progress requires information or a decision that cannot be inferred safely. "
        + "Use submit_plan when explicit user approval is required before implementation; both tools suspend the run."
    );
  }
  if (input.mcpToolNames.length > 0) {
    policies.push(
      "MCP tools are enabled for this run. Use the exact MCP tool names listed above when the user asks for MCP, "
        + "datagraph, graph exploration, or a tool whose description directly matches the task."
    );
  }
  if (skillTools.length > 0) {
    const selectedSkillHint = input.selectedSkills.length > 0
      ? ` Prioritize the selected skills listed in the prompt: ${
          input.selectedSkills.map((skill) => skill.name).join(", ")
        }.`
      : "";
    const skillScriptPolicy = enabled("execute_command")
      ? " Scripts from skills may be executed only through approved workspace tools such as execute_command."
      : " Treat scripts from skills as reference material this run because command execution is unavailable.";
    policies.push(
      "Use skills as task guidance, not as executable tools. skill_search may search the full shared skill cache; "
        + "a search result does not by itself mean the skill was selected for this run."
        + selectedSkillHint
        + " When the task matches an available skill, call "
        + "skill_search or skill to load its instructions, then use normal approved tools to act. "
        + "Use skill_read for references, scripts, or assets that belong to a relevant loaded skill. "
        + skillScriptPolicy
    );
  }
  if (enabled("inspect_schema") && (enabled("run_sql_readonly") || enabled("preview_table"))) {
    policies.push("Inspect before you query, then reuse the schema_id. "
      + "inspect_schema returns a schema_id token that authorizes "
      + "run_sql_readonly and preview_table; pass it as their schema_id argument. The first SQL or preview against a "
      + "datasource must be preceded by an inspect_schema for it; without a valid schema_id the tools fail with "
      + "SCHEMA_REQUIRED. The token enforces inspect-before-query ordering within this run; Data Gateway remains the "
      + "authorization and read-only SQL boundary. Reuse the token instead of repeatedly inspecting the same schema."
    );
  }
  if (enabled("run_sql_readonly")) {
    policies.push("Write read-only SQL only. Generate SELECT or WITH queries and run them through run_sql_readonly. "
      + "Do not attempt writes, DDL, or multi-statement scripts through SQL"
      + (enabled("execute_command")
        ? ". Never use execute_command or direct database clients to bypass Data Gateway."
        : ". Never use direct database clients to bypass Data Gateway.")
    );
  }
  policies.push(
    `This run is governed by ${input.protocolId}@${input.protocolVersion}. Use protocol_handoff only when the `
      + "user's remaining goal truly requires the other registered protocol (general-task or data-analysis). "
      + "Provide stable reasonCodes and "
      + "all unresolvedGoals. Never hand off to bypass schema, SQL validation, evidence, policy, or completion gates."
  );
  if (input.phaseGuidance) {
    policies.push(
      `Current protocol phase: ${input.protocolPhase}. Phase guidance: ${input.phaseGuidance} `
        + "Follow this guidance; the protocol runtime still enforces the hard gates."
    );
  }
  policies.push(
    "Reply in the same natural language as the user's latest request. If the user mixes languages, use the dominant "
      + "language from the request. Keep SQL, code, table names, column names, and other technical identifiers "
      + "unchanged."
  );
  policies.push(
    "Always finish a run with a brief natural-language message to the user that summarizes what you did and the "
      + "outcome, even when your most recent action was a tool call such as a file write, command execution, or "
      + "artifact publish. Never end a run silently right after a tool result: that closing message is how the user "
      + "learns the result. Summarize outcomes and refer to any produced files or artifacts by name instead of "
      + "restating raw tool output."
  );
  policies.push(
    `Respect limits. This run allows at most ${AGENT_MAX_STEPS} steps and `
      + `${SQL_MAX_EXECUTION_COUNT} SQL executions total `
      + `(SQL longer than ${SQL_MAX_SQL_CHARS} chars is truncated from view). `
      + "Prefer one focused query per datasource before refining."
  );
  if (commandExecutionEnabled) {
    const workspacePromotionPolicy = promoteWorkspaceFileEnabled
      ? "Call promote_workspace_file only to lift a session workspace file into a cross-session reusable asset "
        + "(files in the same session are already retained across runs; do not promote merely to reuse within this "
        + "session)."
      : "";
    policies.push(
      "Persist derived artifacts in the workspace. When analysis produces exports, charts, or transformed datasets, "
        + "write them as files via write_file so they are retained with the session, rather than only echoing them in "
        + "the final message. "
        + "Eligible reusable files (for example CSV, JSON, Markdown, HTML, PNG, SVG, XLSX) are automatically shown "
        + "as Session Outputs after successful write_file/edit_file calls. "
        + "Do not invent download URLs, link text, or UI placement such as 'click the link below'; the client renders "
        + "download controls from output events and file APIs. "
        + workspacePromotionPolicy
    );
    if (input.pythonRuntimeAvailable) {
      policies.push(
        "For Python analysis, prefer write_file to create a .py script, then execute_command with "
          + "`python3.12 <script>`. "
          + "Use pandas for tabular work, matplotlib with plt.savefig() for charts (no GUI display), and scikit-learn "
          + "for modeling. "
          + "Export CSV/JSON/PNG files to the session workspace when the user should reuse or download results."
      );
    }
  }
  policies.push(
    "Report failures honestly. If schema inspection, SQL execution, a file write, or a command fails, explain the "
      + "failure plainly. "
      + "Do not fabricate results to mask an error."
  );
  policies.push(
    "Recover from tool failures deliberately. Structured tool errors include error.executionStatus and a recovery "
      + "object. Follow recovery.strategy and recovery.instruction, and respect every recovery.avoid item. If "
      + "executionStatus is succeeded_uncommitted, do not repeat the external action unless the recovery strategy "
      + "explicitly permits a retry."
  );
  policies.push(
    "Confidentiality. Never reveal credentials, datasource config, internal environment values, or workspace "
      + "absolute paths in your responses."
  );
  const selectedSkillSummary = input.selectedSkills.length > 0
    ? input.selectedSkills.map((skill) => `${skill.name} (${skill.id}): ${skill.description}`).join("\n")
    : "None";
  const datasourcePolicy = (context.enabled_datasource_ids ?? []).length > 0
    ? `Datasources available this run: [${(context.enabled_datasource_ids ?? []).join(", ")}]
Default datasource: "${context.selected_datasource_id ?? ""}".
You may query any datasource in the list above by passing its id to a data tool's datasource_id argument.
Never reference a datasource id outside this list; the tool rejects it with DATASOURCE_NOT_SELECTED.`
    : "No datasources are enabled this run. Answer general questions directly. "
      + "Do not call data tools unless the user enables a datasource.";

  return `
You are a general-purpose data agent. Analyze data by calling tools. Never invent schema, rows, SQL results,
file contents, or command output.

${datasourcePolicy}
Selected skills to prioritize this run:
${selectedSkillSummary}

Tool groups:
- ${toolGroups.join("\n- ")}

Operating policy:
${policies.map((policy, index) => `${index + 1}. ${policy}`).join("\n")}
`;
};
